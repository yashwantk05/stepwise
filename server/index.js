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
  uploadAssignmentPdfToBlob,
} from "./blobStorage.js";
import {
  deleteUserData,
  findAssignmentById,
  getAssignmentPdfByAssignmentId,
  getScene,
  initDb,
  insertAssignment,
  listAssignmentPdfsForUser,
  listAssignmentsForUser,
  removeAssignmentPdf,
  removeAssignment,
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

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "stepwise-api" });
});

app.use(express.json({ limit: "2mb" }));

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
  if (!title) {
    response.status(400).json({ message: "Title is required." });
    return;
  }

  await upsertUser(request.user);
  const assignment = await insertAssignment(request.user.id, title);
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
  await removeAssignment(request.user.id, request.params.id);
  response.status(204).send();
});

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
  "/api/assignments/:id/problems/:problemIndex/scene",
  requireDb,
  requireAuth,
  async (request, response) => {
    const scene = await getScene(
      request.user.id,
      request.params.id,
      Number(request.params.problemIndex),
    );
    response.json(scene);
  },
);

app.put(
  "/api/assignments/:id/problems/:problemIndex/scene",
  requireDb,
  requireAuth,
  async (request, response) => {
    const record = await upsertScene(
      request.user.id,
      request.params.id,
      Number(request.params.problemIndex),
      request.body?.scene || null,
    );
    response.json(record);
  },
);

app.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ message: "PDF exceeds the 20MB upload limit." });
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
