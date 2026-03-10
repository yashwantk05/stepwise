import express from "express";
import multer from "multer";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReadSasUrl,
  deleteBlobIfExists,
  downloadAssignmentPdfFromBlob,
  downloadProblemImageBufferFromBlob,
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
  getProblemContext,
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
  removeProblemContext,
  removeScene,
  removeAssignmentPdf,
  removeAssignment,
  setAssignmentProblemCount,
  setProblemAnswerKey,
  upsertProblemContext,
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

const getAzureConfig = () => {
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

  return {
    endpoint,
    apiKey,
    apiVersion,
    deployment,
  };
};

const createImageUrlPart = (buffer, mimeType = "image/png") => ({
  type: "image_url",
  image_url: {
    url: `data:${mimeType};base64,${buffer.toString("base64")}`,
  },
});

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const readPngDimensions = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(pngSignature)) return null;
  try {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return null;
  }
};
const safeJsonParse = (value) => {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sanitizeHint = (hint) => {
  const text = String(hint || "").trim();

  if (!text) {
    return "Try rewriting your latest step clearly.";
  }

  if (text.length > 300) {
    return text.slice(0, 300);
  }

  return text;
};

const formatProblemContextForHint = (rawContext) => {
  const parsed =
    rawContext && typeof rawContext === "object" && !Array.isArray(rawContext)
      ? rawContext
      : safeJsonParse(rawContext);

  if (!parsed) {
    return rawContext ? String(rawContext).trim() : "";
  }

  const lines = [];
  if (parsed.summary) lines.push(`Summary: ${parsed.summary}`);
  if (parsed.goal) lines.push(`Goal: ${parsed.goal}`);
  if (parsed.concepts) {
    const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [parsed.concepts];
    lines.push(`Concepts: ${concepts.filter(Boolean).join("; ")}`);
  }
  if (parsed.canonical_steps) {
    const steps = Array.isArray(parsed.canonical_steps)
      ? parsed.canonical_steps
      : [parsed.canonical_steps];
    lines.push(`Canonical steps: ${steps.filter(Boolean).join(" | ")}`);
  }
  if (parsed.common_mistakes) {
    const mistakes = Array.isArray(parsed.common_mistakes)
      ? parsed.common_mistakes
      : [parsed.common_mistakes];
    lines.push(`Common mistakes: ${mistakes.filter(Boolean).join(" | ")}`);
  }
  if (parsed.final_answer) lines.push(`Final answer: ${parsed.final_answer}`);

  return lines.join("\n");
};

const buildUnreadableHint = (rawContext) => {
  const parsed =
    rawContext && typeof rawContext === "object" && !Array.isArray(rawContext)
      ? rawContext
      : safeJsonParse(rawContext);
  const goal = parsed?.goal ? String(parsed.goal).trim() : "";
  if (goal) {
    return `I couldn't read the step. Please rewrite it clearly and show how it moves toward: ${goal}.`;
  }
  return "I couldn't read the step. Please rewrite it clearly and show the full equation or expression.";
};

const requestAzureChatCompletion = async ({ messages, maxTokens = 200, temperature = 0.3 }) => {
  const { endpoint, apiKey, apiVersion, deployment } = getAzureConfig();
  const response = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        temperature,
        max_tokens: maxTokens,
        messages,
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

const analyzeProblemContextWithAzure = async (
  buffer,
  mimeType = "image/png",
  answerKey = "",
) =>
  requestAzureChatCompletion({
    maxTokens: 500,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
Analyze this math problem and return structured tutoring metadata.

Answer key (may be incorrect):
${answerKey || "None"}

Return JSON only with fields:

summary
goal
concepts
final_answer
canonical_steps
common_mistakes

Rules:
- Be concise.
- Do not include explanations.
- Do not include tutoring instructions.
            `.trim(),
          },
          createImageUrlPart(buffer, mimeType),
        ],
      },
    ],
  });
  
const interpretStudentStepWithAzure = async ({
  drawingBuffer,
  drawingMimeType = "image/png",
  problemContext = "",
}) => {
  return requestAzureChatCompletion({
    temperature: 0.2,
    maxTokens: 200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
You are reading a student's handwritten math step.

Problem context:
${problemContext}

Return JSON with fields:

observed_step
stage
correctness
confidence

Rules:
- correctness = correct / incorrect / unclear
- confidence = low / medium / high
- If unreadable set observed_step="Unreadable"
            `.trim(),
          },
          createImageUrlPart(drawingBuffer, drawingMimeType),
        ],
      },
    ],
  });
};

const generateHintWithAzure = async ({
  problemContext,
  studentAnalysis,
  hintLevel = 1,
}) => {
  const analysis =
    studentAnalysis && typeof studentAnalysis === "object"
      ? studentAnalysis
      : safeJsonParse(studentAnalysis) || {};
  const observedStep = String(analysis.observed_step || "");
  const correctness = String(analysis.correctness || "unclear").toLowerCase();
  const confidence = String(analysis.confidence || "").toLowerCase();

  return requestAzureChatCompletion({
    temperature: 0.4,
    maxTokens: 200,
    messages: [
      {
        role: "user",
        content: `
You are a math tutor giving subtle hints.

Problem context:
${problemContext}

Student analysis:
Observed step: ${observedStep || "Unknown"}
Correctness: ${correctness || "unclear"}
Confidence: ${confidence || "unknown"}

Hint level: ${hintLevel}

Hint rules:

Level 1 → conceptual nudge
Level 2 → strategy hint
Level 3 → next step guidance
Level 4 → near solution

Behavior:
- If correctness=correct, give the most likely next step using the context.
- If correctness=incorrect, point out the likely error and give a targeted hint to fix it.
- If correctness=unclear or observed_step is "Unreadable", ask for a clearer rewrite and give one specific thing to clarify.
- Avoid generic advice if context is available.
Never reveal the final answer unless hint level is 4.
Maximum 2 sentences. Use LaTeX for equations.
        `,
      },
    ],
  });
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

const isDebugRoutesEnabled = () => {
  const flag = readEnv("STEPWISE_DEBUG_ROUTES").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
};

app.post("/api/debug/echo-image", requireAuth, upload.single("file"), (request, response) => {
  if (!isDebugRoutesEnabled()) {
    response.status(404).json({ message: "Not found." });
    return;
  }

  const file = request.file;
  if (!file) {
    response.status(400).json({ message: "Image file is required." });
    return;
  }

  const label = String(request.query?.label || "debug")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .slice(0, 48);
  const mimeType = file.mimetype || "application/octet-stream";
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "bin";

  response.setHeader("Content-Type", mimeType);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Disposition", `inline; filename="${label}.${extension}"`);
  response.send(file.buffer);
});

app.use(express.json({ limit: "2mb" }));

app.post("/api/ai/analyze", requireDb, requireAuth, upload.single("file"), async (request, response) => {
  const file = request.file;
  if (!file) {
    response.status(400).json({ message: "Drawing image is required." });
    return;
  }

  try {
    const assignmentId = String(request.body?.assignmentId || "").trim();
    const rawProblemIndex = Number(request.body?.problemIndex);
    const problemIndex = Number.isInteger(rawProblemIndex) ? rawProblemIndex : null;

    let problemBuffer = null;
    let problemMimeType = "image/png";
    let problemContext = "";
    let answerKey = "";

    if (assignmentId && problemIndex != null) {
      const [contextRecord, imageRecord] = await Promise.all([
        getProblemContext(request.user.id, assignmentId, problemIndex),
        getProblemImage(request.user.id, assignmentId, problemIndex),
      ]);
      problemContext = contextRecord?.content || "";
      console.log("problemContext:", JSON.stringify(problemContext));
      answerKey = contextRecord?.answerKey || "";

      if (imageRecord?.blobName) {
        const blob = await downloadProblemImageBufferFromBlob(imageRecord.blobName);
        if (blob?.buffer) {
          problemBuffer = blob.buffer;
          problemMimeType = imageRecord.contentType || problemMimeType;
        }
      }
    }

    const analysisRaw = await interpretStudentStepWithAzure({
      drawingBuffer: file.buffer,
      drawingMimeType: file.mimetype || "image/png",
      problemContext,
    });

    let analysis;
    try {
      const cleaned = analysisRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = { observed_step: "Unreadable" };
    }
    const observedStep = String(analysis?.observed_step || "");
    const normalizedCorrectness = String(analysis?.correctness || "").toLowerCase();
    const normalizedConfidence = String(analysis?.confidence || "").toLowerCase();
    if (!normalizedCorrectness) {
      analysis.correctness = observedStep.toLowerCase() === "unreadable" ? "unclear" : "unclear";
    }
    if (!normalizedConfidence) {
      analysis.confidence = "low";
    }

    const formattedContext = formatProblemContextForHint(problemContext);
    const hint =
      observedStep.toLowerCase() === "unreadable" || analysis.correctness === "unclear"
        ? buildUnreadableHint(problemContext)
        : await generateHintWithAzure({
            problemContext: formattedContext,
            studentAnalysis: analysis,
            hintLevel: 1,
          });

    response.json({
      analysis,
      hint: sanitizeHint(hint),
      debug: {
        drawingImage: {
          bytes: file.buffer.length,
          sha256: sha256(file.buffer),
          mimeType: file.mimetype || "image/png",
          dimensions: readPngDimensions(file.buffer),
        },
        problemImage: problemBuffer
          ? {
              bytes: problemBuffer.length,
              sha256: sha256(problemBuffer),
              mimeType: problemMimeType,
              dimensions: readPngDimensions(problemBuffer),
            }
          : null,
        problemContextChars: problemContext.length,
        answerKeyChars: answerKey.length,
      },
    });
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
    await removeProblemContext(request.user.id, request.params.id, removedProblemIndex);
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
  "/api/assignments/:id/problems/:problemIndex/context",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const record = await getProblemContext(request.user.id, request.params.id, problemIndex);
    response.json(
      record
        ? {
            assignmentId: record.assignmentId,
            problemIndex: record.problemIndex,
            content: record.content,
            answerKey: record.answerKey,
            updatedAt: record.updatedAt,
          }
        : null,
    );
  },
);

app.put(
  "/api/assignments/:id/problems/:problemIndex/context",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const answerKey = String(request.body?.answerKey || "");
    const record = await setProblemAnswerKey(
      request.user.id,
      request.params.id,
      problemIndex,
      answerKey,
    );
    response.json({
      assignmentId: record.assignmentId,
      problemIndex: record.problemIndex,
      content: record.content,
      answerKey: record.answerKey,
      updatedAt: record.updatedAt,
    });
  },
);

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

    const [existingRecord, existingContextRecord] = await Promise.all([
      getProblemImage(request.user.id, request.params.id, problemIndex),
      getProblemContext(request.user.id, request.params.id, problemIndex),
    ]);

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

    try {
      const raw = await analyzeProblemContextWithAzure(
        file.buffer,
        file.mimetype || "image/png",
        existingContextRecord?.answerKey || "",
      );

      let parsed;
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { summary: "Failed to parse context" };
      }

      await upsertProblemContext(
        request.user.id,
        request.params.id,
        problemIndex,
        JSON.stringify(parsed),
        existingContextRecord?.answerKey || null,
      );
    } catch (error) {
      console.error("Problem context generation failed:", error.message);
    }

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
    await removeProblemContext(request.user.id, request.params.id, problemIndex);
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
