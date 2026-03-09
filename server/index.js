import express from "express";
import multer from "multer";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReadSasUrl,
  deleteBlobIfExists,
  downloadAssignmentPdfFromBlob,
  downloadProblemImageFromBlob,
  downloadProblemSceneFromBlob,
  uploadAssignmentPdfToBlob,
  uploadProblemImageToBlob,
  uploadProblemSceneToBlob,
} from "./blobStorage.js";
import {
  deleteUserData,
  findAssignmentById,
  getAssignmentPdfByAssignmentId,
  getProblemImage,
  getScene,
  initDb,
  insertAssignment,
  listAssignmentPdfsForUser,
  listProblemImageBlobNamesForAssignment,
  listProblemImageBlobNamesForUser,
  listAssignmentsForUser,
  listSceneBlobNamesForAssignment,
  removeProblemImage,
  removeScene,
  removeAssignmentPdf,
  removeAssignment,
  setAssignmentProblemCount,
  upsertProblemImage,
  upsertAssignmentPdf,
  upsertScene,
  upsertUser,
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(globalThis.process?.env?.PORT) || 8080;
const distDir = path.resolve(__dirname, "..", "dist");
const indexFile = path.join(distDir, "index.html");
let dbReady = false;
let dbInitError = null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});
const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");
const readEnv = (name) => String(globalThis.process?.env?.[name] || "").trim();

const analyzeDrawingWithAzure = async (buffer) => {
  const endpoint = trimTrailingSlash(readEnv("AZURE_OPENAI_ENDPOINT"));
  const apiKey = readEnv("AZURE_OPENAI_API_KEY");
  const apiVersion = readEnv("AZURE_OPENAI_API_VERSION") || "2024-02-01";
  const deployment =
    readEnv("AZURE_OPENAI_MODEL") ||
    readEnv("AZURE_OPENAI_DEPLOYMENT") ||
    readEnv("AZURE_OPENAI_DEPLOYMENT_NAME");

  const missing = [];
  if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
  if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
  if (!deployment) missing.push("AZURE_OPENAI_MODEL (or AZURE_OPENAI_DEPLOYMENT)");

  if (missing.length > 0) {
    throw new Error(`Azure OpenAI is not configured. Missing: ${missing.join(", ")}`);
  }

  const response = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `
You are a strict math tutor checking a student's handwritten algebra solution.

Look carefully at the image and determine the student's steps.

Steps:
1. Identify the equations written by the student.
2. Verify whether the transformation between steps is mathematically valid.
3. If incorrect, explain the mistake.
4. Provide the correct next step.

Rules:
- Always verify the algebra.
- Never assume the student is correct.
- Explanations must be short (max 2 sentences).
- ALL mathematical expressions MUST be written in LaTeX using $...$.

Example format:

Hint:
The subtraction step is correct, but the next equation is wrong.

Correct next line:
$n = \\frac{5}{5} = 1$
                `.trim(),
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${buffer.toString("base64")}`,
                },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Azure OpenAI request failed (${response.status}). ${detail}`.trim());
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content?.trim() || "No hint available yet.";
};

const getOrigin = (request) => {
  const protocol = request.headers["x-forwarded-proto"] || request.protocol || "https";
  return `${protocol}://${request.get("host")}`;
};

const getSafeReturnUrl = (request, requestedUrl, fallbackPath = "/") => {
  const origin = getOrigin(request);
  const fallback = new URL(fallbackPath, origin);
  if (!requestedUrl) return fallback.toString();

  try {
    const parsed = new URL(requestedUrl, origin);
    if (parsed.origin !== origin) return fallback.toString();
    return parsed.toString();
  } catch {
    return fallback.toString();
  }
};

const parsePrincipalHeader = (headerValue) => {
  if (!headerValue) return null;
  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    const principal = JSON.parse(decoded);
    return principal;
  } catch {
    return null;
  }
};

const readClaim = (claims = [], ...types) =>
  claims.find((claim) => types.includes(claim.typ))?.val || "";

const principalToUser = (principal) => {
  if (!principal?.userId) return null;
  const claims = Array.isArray(principal.claims) ? principal.claims : [];
  return {
    id: principal.userId,
    name:
      readClaim(claims, "name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
      principal.userDetails ||
      "User",
    email:
      readClaim(
        claims,
        "email",
        "emails",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      ) || "",
    provider: principal.identityProvider || "",
  };
};

const headersToUser = (request) => {
  const proxiedUserId = request.headers["x-stepwise-user-id"];
  if (proxiedUserId) {
    return {
      id: String(proxiedUserId),
      name: String(request.headers["x-stepwise-user-name"] || "User"),
      email: String(request.headers["x-stepwise-user-email"] || ""),
      provider: String(request.headers["x-stepwise-user-provider"] || "easy-auth"),
    };
  }

  const userId = request.headers["x-ms-client-principal-id"];
  if (!userId) return null;

  const name = request.headers["x-ms-client-principal-name"] || "User";
  const provider = request.headers["x-ms-client-principal-idp"] || "";
  return {
    id: String(userId),
    name: String(name),
    email: String(name),
    provider: String(provider),
  };
};

const getAuthenticatedUser = async (request) => {
  const userFromSimpleHeaders = headersToUser(request);
  if (userFromSimpleHeaders) return userFromSimpleHeaders;

  const headerPrincipal = parsePrincipalHeader(request.headers["x-ms-client-principal"]);
  const userFromHeader = principalToUser(headerPrincipal);
  if (userFromHeader) return userFromHeader;

  try {
    const origin = getOrigin(request);
    const authResponse = await fetch(`${origin}/.auth/me`, {
      headers: {
        cookie: request.headers.cookie || "",
      },
    });

    if (!authResponse.ok) return null;
    const payload = await authResponse.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    return principalToUser(first?.clientPrincipal || first);
  } catch {
    return null;
  }
};

const requireAuth = async (request, response, next) => {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    response.status(401).json({ message: "Not authenticated." });
    return;
  }
  request.user = user;
  next();
};

const requireDb = (_request, response, next) => {
  if (dbReady) {
    next();
    return;
  }
  const detail = dbInitError ? ` ${dbInitError.message}` : "";
  response.status(503).json({ message: `Database is not ready.${detail}`.trim() });
};

const parseProblemCount = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_PROBLEM_COUNT || parsed > MAX_PROBLEM_COUNT) return null;
  return parsed;
};

const parseProblemIndex = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_PROBLEM_COUNT) return null;
  return parsed;
};

const getAssignmentAndProblemIndex = async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return null;
  }

  const problemIndex = parseProblemIndex(request.params.problemIndex);
  if (!problemIndex) {
    response.status(400).json({ message: "Problem index must be a positive integer." });
    return null;
  }
  if (problemIndex > assignment.problemCount) {
    response.status(404).json({ message: "Problem index is out of range for this assignment." });
    return null;
  }

  return { assignment, problemIndex };
};

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "stepwise-api" });
});

app.use(express.json({ limit: "2mb" }));

app.post("/api/ai/analyze", requireAuth, upload.single("file"), async (request, response) => {
  const file = request.file;
  if (!file) {
    response.status(400).json({ message: "Drawing image is required." });
    return;
  }

  try {
    const result = await analyzeDrawingWithAzure(file.buffer);
    response.json({ result });
  } catch (error) {
    console.error("AI analyze failed:", error.message);
    response.status(503).json({ result: "AI tutor temporarily unavailable." });
  }
});

app.get("/api/auth/google/login", (request, response) => {
  const returnTo = getSafeReturnUrl(request, request.query.returnTo, "/assignments");
  const loginUrl = `/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
  response.redirect(loginUrl);
});

app.get("/api/auth/me", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ message: "Not authenticated." });
      return;
    }
    response.json(user);
  } catch {
    response.status(500).json({ message: "Unable to read authentication state." });
  }
});

app.post("/api/auth/logout", (request, response) => {
  const returnTo = getSafeReturnUrl(request, request.query.returnTo, "/login");
  const logoutUrl = `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
  response.json({ logoutUrl });
});

app.delete("/api/account", requireDb, requireAuth, async (request, response) => {
  const uploadedPdfs = await listAssignmentPdfsForUser(request.user.id);
  await Promise.all(uploadedPdfs.map((record) => deleteBlobIfExists(record.blobName)));
  const problemImageBlobNames = await listProblemImageBlobNamesForUser(request.user.id);
  await Promise.all(problemImageBlobNames.map((blobName) => deleteBlobIfExists(blobName)));
  await deleteUserData(request.user.id);
  response.status(202).json({ message: "Account deletion request accepted." });
});

app.get("/api/assignments", requireDb, requireAuth, async (request, response) => {
  await upsertUser(request.user);
  const records = await listAssignmentsForUser(request.user.id);
  response.json(records);
});

app.post("/api/assignments", requireDb, requireAuth, async (request, response) => {
  const title = String(request.body?.title || "").trim();
  const problemCount = parseProblemCount(request.body?.problemCount);
  if (!title) {
    response.status(400).json({ message: "Title is required." });
    return;
  }
  if (!problemCount) {
    response
      .status(400)
      .json({ message: `Problem count must be an integer between ${MIN_PROBLEM_COUNT} and ${MAX_PROBLEM_COUNT}.` });
    return;
  }

  await upsertUser(request.user);
  const assignment = await insertAssignment(request.user.id, title, problemCount);
  response.status(201).json(assignment);
});

app.get("/api/assignments/:id", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }
  response.json(assignment);
});

app.delete("/api/assignments/:id", requireDb, requireAuth, async (request, response) => {
  const existingPdf = await getAssignmentPdfByAssignmentId(request.user.id, request.params.id);
  if (existingPdf) {
    await deleteBlobIfExists(existingPdf.blobName);
    await removeAssignmentPdf(request.user.id, request.params.id);
  }

  const sceneBlobNames = await listSceneBlobNamesForAssignment(request.user.id, request.params.id);
  if (sceneBlobNames.length > 0) {
    await Promise.all(sceneBlobNames.map((blobName) => deleteBlobIfExists(blobName)));
  }

  const problemImageBlobNames = await listProblemImageBlobNamesForAssignment(
    request.user.id,
    request.params.id,
  );
  if (problemImageBlobNames.length > 0) {
    await Promise.all(problemImageBlobNames.map((blobName) => deleteBlobIfExists(blobName)));
  }

  await removeAssignment(request.user.id, request.params.id);
  response.status(204).send();
});

app.post("/api/assignments/:id/problems/add", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }
  if (assignment.problemCount >= MAX_PROBLEM_COUNT) {
    response
      .status(400)
      .json({ message: `Assignments support at most ${MAX_PROBLEM_COUNT} problems.` });
    return;
  }

  const updated = await setAssignmentProblemCount(
    request.user.id,
    request.params.id,
    assignment.problemCount + 1,
  );
  response.json(updated);
});

app.delete(
  "/api/assignments/:id/problems/last",
  requireDb,
  requireAuth,
  async (request, response) => {
    const assignment = await findAssignmentById(request.user.id, request.params.id);
    if (!assignment) {
      response.status(404).json({ message: "Assignment not found." });
      return;
    }
    if (assignment.problemCount <= MIN_PROBLEM_COUNT) {
      response
        .status(400)
        .json({ message: `Assignments must have at least ${MIN_PROBLEM_COUNT} problem.` });
      return;
    }

    const removedProblemIndex = assignment.problemCount;
    const [removedScene, removedImage] = await Promise.all([
      removeScene(request.user.id, request.params.id, removedProblemIndex),
      removeProblemImage(request.user.id, request.params.id, removedProblemIndex),
    ]);
    if (removedScene?.blobName) {
      await deleteBlobIfExists(removedScene.blobName);
    }
    if (removedImage?.blobName) {
      await deleteBlobIfExists(removedImage.blobName);
    }

    const updated = await setAssignmentProblemCount(
      request.user.id,
      request.params.id,
      assignment.problemCount - 1,
    );

    response.json({
      assignment: updated,
      removedProblemIndex,
      removedArtifacts: Boolean(removedScene || removedImage),
    });
  },
);

app.get("/api/assignments/:id/pdf", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const record = await getAssignmentPdfByAssignmentId(request.user.id, request.params.id);
  if (!record) {
    response.json(null);
    return;
  }

  response.json({
    assignmentId: record.assignmentId,
    fileName: record.fileName,
    contentType: record.contentType,
    size: record.size,
    uploadedAt: record.uploadedAt,
    updatedAt: record.updatedAt,
  });
});

app.post(
  "/api/assignments/:id/pdf",
  requireDb,
  requireAuth,
  upload.single("file"),
  async (request, response) => {
    const assignment = await findAssignmentById(request.user.id, request.params.id);
    if (!assignment) {
      response.status(404).json({ message: "Assignment not found." });
      return;
    }

    const file = request.file;
    if (!file) {
      response.status(400).json({ message: "PDF file is required." });
      return;
    }

    if (file.mimetype !== "application/pdf") {
      response.status(400).json({ message: "Only PDF uploads are supported." });
      return;
    }

    const existingRecord = await getAssignmentPdfByAssignmentId(request.user.id, request.params.id);
    const blobName = await uploadAssignmentPdfToBlob({
      userId: request.user.id,
      assignmentId: request.params.id,
      fileName: file.originalname || "problem-sheet.pdf",
      contentType: file.mimetype,
      buffer: file.buffer,
    });

    let record = null;
    try {
      record = await upsertAssignmentPdf({
        assignmentId: request.params.id,
        userId: request.user.id,
        blobName,
        fileName: file.originalname || "problem-sheet.pdf",
        contentType: file.mimetype,
        size: file.size,
      });
    } catch (error) {
      await deleteBlobIfExists(blobName);
      throw error;
    }

    if (existingRecord && existingRecord.blobName !== blobName) {
      await deleteBlobIfExists(existingRecord.blobName);
    }

    response.status(201).json({
      assignmentId: record.assignmentId,
      fileName: record.fileName,
      contentType: record.contentType,
      size: record.size,
      uploadedAt: record.uploadedAt,
      updatedAt: record.updatedAt,
    });
  },
);

app.delete("/api/assignments/:id/pdf", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const record = await removeAssignmentPdf(request.user.id, request.params.id);
  if (record) {
    await deleteBlobIfExists(record.blobName);
  }
  response.status(204).send();
});

app.get("/api/assignments/:id/pdf/download-url", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const record = await getAssignmentPdfByAssignmentId(request.user.id, request.params.id);
  if (!record) {
    response.status(404).json({ message: "No PDF uploaded yet." });
    return;
  }

  const url = await createReadSasUrl(record.blobName);
  if (!url) {
    response.status(404).json({ message: "Direct download URL is unavailable." });
    return;
  }
  response.json({ url });
});

app.get("/api/assignments/:id/pdf/download", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const record = await getAssignmentPdfByAssignmentId(request.user.id, request.params.id);
  if (!record) {
    response.status(404).json({ message: "No PDF uploaded yet." });
    return;
  }

  const blob = await downloadAssignmentPdfFromBlob(record.blobName);
  if (!blob?.stream) {
    response.status(404).json({ message: "PDF file is missing from storage." });
    return;
  }

  response.setHeader("Content-Type", record.contentType || "application/pdf");
  response.setHeader("Content-Length", String(blob.contentLength || record.size));
  response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.fileName)}"`);
  blob.stream.pipe(response);
});

app.get(
  "/api/assignments/:id/problems/:problemIndex/image",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const record = await getProblemImage(request.user.id, request.params.id, problemIndex);
    if (!record) {
      response.json(null);
      return;
    }

    const directUrl = await createReadSasUrl(record.blobName);
    response.json({
      assignmentId: record.assignmentId,
      problemIndex: record.problemIndex,
      fileName: record.fileName,
      contentType: record.contentType,
      size: record.size,
      updatedAt: record.updatedAt,
      downloadUrl:
        directUrl ||
        `/api/assignments/${encodeURIComponent(record.assignmentId)}/problems/${record.problemIndex}/image/download`,
    });
  },
);

app.get(
  "/api/assignments/:id/problems/:problemIndex/image/download",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const record = await getProblemImage(request.user.id, request.params.id, problemIndex);
    if (!record) {
      response.status(404).json({ message: "No problem image saved yet." });
      return;
    }

    const blob = await downloadProblemImageFromBlob(record.blobName);
    if (!blob?.stream) {
      response.status(404).json({ message: "Problem image is missing from storage." });
      return;
    }

    response.setHeader("Content-Type", record.contentType || "image/png");
    response.setHeader("Content-Length", String(blob.contentLength || record.size));
    response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.fileName)}"`);
    blob.stream.pipe(response);
  },
);

app.put(
  "/api/assignments/:id/problems/:problemIndex/image",
  requireDb,
  requireAuth,
  imageUpload.single("file"),
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const file = request.file;
    if (!file) {
      response.status(400).json({ message: "Problem image file is required." });
      return;
    }

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedTypes.has(file.mimetype)) {
      response.status(400).json({ message: "Only PNG, JPEG, and WEBP uploads are supported." });
      return;
    }

    const existingRecord = await getProblemImage(request.user.id, request.params.id, problemIndex);

    const blob = await uploadProblemImageToBlob({
      userId: request.user.id,
      assignmentId: request.params.id,
      problemIndex,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    const record = await upsertProblemImage(
      request.user.id,
      request.params.id,
      problemIndex,
      blob,
    );

    if (existingRecord && existingRecord.blobName !== blob.blobName) {
      await deleteBlobIfExists(existingRecord.blobName);
    }

    response.json({
      assignmentId: record.assignmentId,
      problemIndex: record.problemIndex,
      fileName: record.fileName,
      contentType: record.contentType,
      size: record.size,
      updatedAt: record.updatedAt,
    });
  },
);

app.delete(
  "/api/assignments/:id/problems/:problemIndex/image",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const record = await removeProblemImage(request.user.id, request.params.id, problemIndex);
    if (record) {
      await deleteBlobIfExists(record.blobName);
    }

    response.status(204).send();
  },
);

app.get(
  "/api/assignments/:id/problems/:problemIndex/scene",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const record = await getScene(request.user.id, request.params.id, problemIndex);

    if (!record) {
      response.json(null);
      return;
    }

    let resolvedScene = record.scene;
    if (record.blobName) {
      try {
        const sceneFromBlob = await downloadProblemSceneFromBlob(record.blobName);
        if (sceneFromBlob != null) {
          resolvedScene = sceneFromBlob;
        }
      } catch {
        // Fall back to DB JSON if blob retrieval/parsing fails.
      }
    }

    response.json({
      ...record,
      scene: resolvedScene,
    });
  },
);

app.put(
  "/api/assignments/:id/problems/:problemIndex/scene",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const scene = request.body?.scene || null;
    const blob = await uploadProblemSceneToBlob({
      userId: request.user.id,
      assignmentId: request.params.id,
      problemIndex,
      scene,
    });

    const record = await upsertScene(
      request.user.id,
      request.params.id,
      problemIndex,
      scene,
      blob,
    );
    response.json(record);
  },
);

app.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ message: "Uploaded file exceeds size limit." });
    return;
  }
  next(error);
});

if (fs.existsSync(indexFile)) {
  app.use(express.static(distDir));
  app.get(/.*/, (request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ message: "API route not found." });
      return;
    }
    response.sendFile(indexFile);
  });
} else {
  app.get(/.*/, (_request, response) => {
    response.status(503).send("Frontend bundle not found. Run `npm run build` first.");
  });
}

const startServer = async () => {
  console.log("STEPWISE_DEPLOY_MARKER_2026_03_08_BLOB_DB");
  console.log("Azure OpenAI env check:", {
    hasEndpoint: Boolean(readEnv("AZURE_OPENAI_ENDPOINT")),
    hasApiKey: Boolean(readEnv("AZURE_OPENAI_API_KEY")),
    hasDeployment:
      Boolean(readEnv("AZURE_OPENAI_MODEL")) ||
      Boolean(readEnv("AZURE_OPENAI_DEPLOYMENT")) ||
      Boolean(readEnv("AZURE_OPENAI_DEPLOYMENT_NAME")),
    apiVersion: readEnv("AZURE_OPENAI_API_VERSION") || "2024-02-01",
  });
  try {
    await initDb();
    dbReady = true;
    console.log("Database initialized.");
  } catch (error) {
    dbReady = false;
    dbInitError = error;
    console.error("Database initialization failed:", error.message);
  }

  app.listen(port, () => {
    console.log(`StepWise server listening on port ${port}`);
  });
};

startServer();
