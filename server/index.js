import express from "express";
import multer from "multer";
import { Buffer } from "node:buffer";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
  listProblemTitles,
  removeProblemImage,
  removeProblemContext,
  removeProblemTitle,
  removeScene,
  removeAssignmentPdf,
  removeAssignment,
  setAssignmentProblemCount,
  setProblemTitle,
  shiftProblemIndexesAfter,
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
const SESSION_COOKIE_NAME = "stepwise_session";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");
const readEnv = (name) => String(globalThis.process?.env?.[name] || "").trim();
const toBase64Url = (value) =>
  Buffer.from(String(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const fromBase64Url = (value) => {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding ? `${normalized}${"=".repeat(4 - padding)}` : normalized;
  return Buffer.from(padded, "base64").toString("utf-8");
};

const parseCookieHeader = (cookieHeader) =>
  String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separator = entry.indexOf("=");
      if (separator < 0) return cookies;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!key) return cookies;
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});

const getSessionSecret = () => readEnv("AUTH_SESSION_SECRET") || "stepwise-local-auth-dev-secret";
const signTokenPayload = (payload) => {
  const secret = getSessionSecret();
  const payloadJson = JSON.stringify(payload);
  const encoded = toBase64Url(payloadJson);
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
};

const parseSignedToken = (token) => {
  const [encodedPayload = "", signature = ""] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");

  if (expectedSignature.length !== signature.length) return null;
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(signature);
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) return null;

  const payload = safeJsonParse(fromBase64Url(encodedPayload));
  if (!payload || typeof payload !== "object") return null;
  const expiryMs = Number(payload.exp || 0) * 1000;
  if (!Number.isFinite(expiryMs) || Date.now() > expiryMs) return null;
  return payload;
};

const buildCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
};

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
- Use observed_step="Unreadable" only when no meaningful math symbols or structure can be recognized.
- If partially readable, include recognizable math in observed_step and set confidence="low"
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
  previousHints = [],
}) => {
  const analysis =
    studentAnalysis && typeof studentAnalysis === "object"
      ? studentAnalysis
      : safeJsonParse(studentAnalysis) || {};
  const observedStep = String(analysis.observed_step || "");
  const correctness = String(analysis.correctness || "unclear").toLowerCase();
  const confidence = String(analysis.confidence || "").toLowerCase();

  const previousHintsSection = previousHints.length > 0
    ? `\nPrevious hints already given (do not repeat these):\n${previousHints.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
    : "";

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
${previousHintsSection}

Hint rules:

Level 1 -> conceptual nudge
Level 2 -> strategy hint
Level 3 -> next step guidance
Level 4 -> near solution

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

const calculateSelectionWithAzure = async ({
  drawingBuffer,
  drawingMimeType = "image/png",
  problemContext = "",
}) => {
  const raw = await requestAzureChatCompletion({
    temperature: 0,
    maxTokens: 220,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
Read the selected handwritten math expression in this image and calculate it.

Problem context:
${problemContext || "None"}

Return JSON only with these fields:
- expression: the expression you read from the image as a string
- value: the computed result as a string
- confidence: high, medium, or low
- readable: true or false

Rules:
- Only calculate what is visibly present inside the selected crop.
- If the crop is unreadable, incomplete, or ambiguous, set readable=false and value="".
- Do not guess missing symbols, numbers, or operators.
- Simplify exact arithmetic when possible.
- No explanation outside the JSON.
            `.trim(),
          },
          createImageUrlPart(drawingBuffer, drawingMimeType),
        ],
      },
    ],
  });

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      expression: String(parsed?.expression || "").trim(),
      value: String(parsed?.value || "").trim(),
      confidence: String(parsed?.confidence || "").trim().toLowerCase(),
      readable: Boolean(parsed?.readable),
    };
  } catch {
    return {
      expression: "",
      value: "",
      confidence: "low",
      readable: false,
    };
  }
};

const getOrigin = (request) => {
  const protocol = request.headers["x-forwarded-proto"] || request.protocol || "https";
  return `${protocol}://${request.get("host")}`;
};

const isLoopbackHost = (hostname) => {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

const getGoogleOAuthConfig = () => {
  const clientId = readEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
};

const canUseLocalGoogleAuth = (request) => {
  const config = getGoogleOAuthConfig();
  if (!config) return false;
  try {
    const requestUrl = new URL(getOrigin(request));
    return isLoopbackHost(requestUrl.hostname);
  } catch {
    return false;
  }
};

const getLocalGoogleRedirectUri = (request) => {
  const configured = readEnv("GOOGLE_OAUTH_REDIRECT_URI");
  if (configured) return configured;
  return `${getOrigin(request)}/api/auth/google/callback`;
};

const getSessionCookieSecureFlag = (request) => {
  const protocol = String(request.headers["x-forwarded-proto"] || request.protocol || "").toLowerCase();
  return protocol === "https";
};

const getUserFromSessionCookie = (request) => {
  const cookies = parseCookieHeader(request.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const payload = parseSignedToken(token);
  if (!payload?.user || typeof payload.user !== "object") return null;
  const user = payload.user;
  if (!user.id) return null;
  return {
    id: String(user.id),
    name: String(user.name || "User"),
    email: String(user.email || ""),
    provider: String(user.provider || "google-local"),
    avatarUrl: String(user.avatarUrl || ""),
  };
};

const buildSessionCookieValue = (user) =>
  signTokenPayload({
    user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });

const buildOAuthStateValue = (request, returnTo) =>
  signTokenPayload({
    nonce: randomBytes(12).toString("hex"),
    returnTo: getSafeReturnUrl(request, returnTo, "/assignments"),
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  });

const readOAuthStateValue = (request, rawState) => {
  const payload = parseSignedToken(rawState);
  if (!payload) return getSafeReturnUrl(request, null, "/login");
  return getSafeReturnUrl(request, payload.returnTo, "/login");
};

const isAllowedLocalDevReturnUrl = (requestUrl, parsedUrl) =>
  requestUrl.protocol === parsedUrl.protocol &&
  isLoopbackHost(requestUrl.hostname) &&
  isLoopbackHost(parsedUrl.hostname);

const getSafeReturnUrl = (request, requestedUrl, fallbackPath = "/") => {
  const origin = getOrigin(request);
  const fallback = new URL(fallbackPath, origin);
  if (!requestedUrl) return fallback.toString();

  try {
    const parsed = new URL(requestedUrl, origin);
    const requestUrl = new URL(origin);
    if (parsed.origin !== origin && !isAllowedLocalDevReturnUrl(requestUrl, parsed)) {
      return fallback.toString();
    }
    return parsed.toString();
  } catch {
    return fallback.toString();
  }
};

const withQueryParam = (targetUrl, key, value) => {
  try {
    const parsed = new URL(targetUrl);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    return targetUrl;
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
    avatarUrl:
      readClaim(
        claims,
        "picture",
        "urn:google:picture",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/picture",
        "avatar_url",
        "profile",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/uri",
      ) || "",
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
      avatarUrl: String(request.headers["x-stepwise-user-avatar"] || ""),
    };
  }

  const userId = request.headers["x-ms-client-principal-id"];
  if (!userId) return null;

  const decodedPrincipal = parsePrincipalHeader(request.headers["x-ms-client-principal"]);
  const userFromPrincipal = principalToUser(decodedPrincipal);
  const name = request.headers["x-ms-client-principal-name"] || "User";
  const provider = request.headers["x-ms-client-principal-idp"] || "";
  return {
    id: String(userId),
    name: String(userFromPrincipal?.name || name),
    email: String(userFromPrincipal?.email || name),
    provider: String(provider),
    avatarUrl: String(userFromPrincipal?.avatarUrl || ""),
  };
};

const getAuthenticatedUser = async (request) => {
  const userFromSimpleHeaders = headersToUser(request);
  if (userFromSimpleHeaders) return userFromSimpleHeaders;

  const userFromSessionCookie = getUserFromSessionCookie(request);
  if (userFromSessionCookie) return userFromSessionCookie;

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

const exchangeGoogleCodeForToken = async ({ code, redirectUri, clientId, clientSecret }) => {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text().catch(() => "");
    throw new Error(`Google token exchange failed (${tokenResponse.status}). ${detail}`.trim());
  }

  return tokenResponse.json();
};

const fetchGoogleUserInfo = async (accessToken) => {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google userinfo request failed (${response.status}). ${detail}`.trim());
  }

  return response.json();
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

app.post("/api/ai/analyze", requireAuth, upload.single("file"), async (request, response) => {
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
      answerKey = contextRecord?.answerKey || "";

      if (imageRecord?.blobName) {
        const blob = await downloadProblemImageBufferFromBlob(imageRecord.blobName);
        if (blob?.buffer) {
          problemBuffer = blob.buffer;
          problemMimeType = imageRecord.contentType || problemMimeType;
        }
      }
    }
    const mode = String(request.body?.mode || "hint").trim().toLowerCase();

    if (mode === "calculate") {
      const formattedContext = formatProblemContextForHint(problemContext);
      const calculated = await calculateSelectionWithAzure({
        drawingBuffer: file.buffer,
        drawingMimeType: file.mimetype || "image/png",
        problemContext: formattedContext,
      });

      return response.json({
        expression: calculated.expression,
        value: calculated.value,
        confidence: calculated.confidence || "low",
        readable: calculated.readable,
        message: calculated.readable
          ? ""
          : "I could not reliably read the selected expression. Select a tighter area or write it more clearly.",
      });
    }

    if (mode === "explain") {
      const formattedContext = formatProblemContextForHint(problemContext);
      const raw = await requestAzureChatCompletion({
        temperature: 0.3,
        maxTokens: 200,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Explain what the math expression or step in this image means.\n\nProblem context:\n${formattedContext || "None"}\n\nOne short paragraph. Use LaTeX for equations.`,
            },
            createImageUrlPart(file.buffer, file.mimetype || "image/png"),
          ],
        }],
      });
      return response.json({ explanation: raw });
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
    const isUnreadableStep = !observedStep || observedStep.toLowerCase() === "unreadable";

    const hintLevel = Math.min(4, Math.max(1, Number(request.body?.hintLevel) || 1));
    const previousHints = Array.isArray(safeJsonParse(request.body?.previousHints))
      ? safeJsonParse(request.body.previousHints).slice(0, 5).map(String)
      : [];
    const hint = isUnreadableStep
      ? buildUnreadableHint(problemContext)
      : await generateHintWithAzure({
          problemContext: formattedContext,
          studentAnalysis: analysis,
          hintLevel,
          previousHints
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
  if (canUseLocalGoogleAuth(request)) {
    const config = getGoogleOAuthConfig();
    if (!config) {
      response.status(503).json({ message: "Google OAuth is not configured for localhost." });
      return;
    }

    const returnTo = getSafeReturnUrl(request, request.query.returnTo, "/assignments");
    const redirectUri = getLocalGoogleRedirectUri(request);
    const state = buildOAuthStateValue(request, returnTo);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
      state,
    });
    response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    return;
  }

  const returnTo = getSafeReturnUrl(request, request.query.returnTo, "/assignments");
  const loginUrl = `/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
  response.redirect(loginUrl);
});

app.get("/api/auth/google/callback", async (request, response) => {
  if (!canUseLocalGoogleAuth(request)) {
    response.status(404).json({ message: "Local Google callback is not enabled." });
    return;
  }

  const config = getGoogleOAuthConfig();
  if (!config) {
    response.status(503).json({ message: "Google OAuth is not configured for localhost." });
    return;
  }

  const authCode = String(request.query.code || "").trim();
  const state = String(request.query.state || "").trim();
  const returnTo = readOAuthStateValue(request, state);

  if (!authCode || !state) {
    response.redirect(withQueryParam(getSafeReturnUrl(request, returnTo, "/login"), "authError", "google_auth_failed"));
    return;
  }

  try {
    const redirectUri = getLocalGoogleRedirectUri(request);
    const tokenPayload = await exchangeGoogleCodeForToken({
      code: authCode,
      redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const accessToken = String(tokenPayload?.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Google token payload did not include an access token.");
    }

    const profile = await fetchGoogleUserInfo(accessToken);
    const userId = String(profile?.sub || "").trim();
    if (!userId) {
      throw new Error("Google user profile did not include sub.");
    }

    const user = {
      id: userId,
      name: String(profile?.name || profile?.given_name || "User"),
      email: String(profile?.email || ""),
      provider: "google-local",
      avatarUrl: String(profile?.picture || ""),
    };

    response.append(
      "Set-Cookie",
      buildCookie(SESSION_COOKIE_NAME, buildSessionCookieValue(user), {
        maxAge: SESSION_TTL_SECONDS,
        secure: getSessionCookieSecureFlag(request),
        sameSite: "Lax",
      }),
    );
    response.redirect(returnTo);
  } catch (error) {
    console.error("Local Google auth callback failed:", error.message);
    response.redirect(withQueryParam(getSafeReturnUrl(request, returnTo, "/login"), "authError", "google_auth_failed"));
  }
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
  const sessionUser = getUserFromSessionCookie(request);
  if (sessionUser) {
    response.append(
      "Set-Cookie",
      buildCookie(SESSION_COOKIE_NAME, "", {
        maxAge: 0,
        secure: getSessionCookieSecureFlag(request),
        sameSite: "Lax",
      }),
    );
    response.json({ logoutUrl: null });
    return;
  }

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

app.get("/api/assignments/:id/problems", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const records = await listProblemTitles(request.user.id, request.params.id);
  const titleByIndex = new Map(records.map((record) => [record.problemIndex, record.title]));
  const problems = Array.from({ length: assignment.problemCount }, (_value, index) => {
    const problemIndex = index + 1;
    return {
      problemIndex,
      title: titleByIndex.get(problemIndex) || `Problem ${problemIndex}`,
    };
  });
  response.json(problems);
});

app.patch("/api/assignments/:id/problems/:problemIndex", requireDb, requireAuth, async (request, response) => {
  const target = await getAssignmentAndProblemIndex(request, response);
  if (!target) return;
  const { problemIndex } = target;

  const nextTitle = String(request.body?.title || "").trim();
  if (!nextTitle) {
    response.status(400).json({ message: "Problem title is required." });
    return;
  }

  const record = await setProblemTitle(request.user.id, request.params.id, problemIndex, nextTitle);
  response.json({
    problemIndex,
    title: record?.title || `Problem ${problemIndex}`,
  });
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
    await removeProblemTitle(request.user.id, request.params.id, removedProblemIndex);
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

app.delete(
  "/api/assignments/:id/problems/:problemIndex",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;

    const { assignment, problemIndex } = target;
    if (assignment.problemCount <= MIN_PROBLEM_COUNT) {
      response
        .status(400)
        .json({ message: `Assignments must have at least ${MIN_PROBLEM_COUNT} problem.` });
      return;
    }

    const [removedScene, removedImage] = await Promise.all([
      removeScene(request.user.id, request.params.id, problemIndex),
      removeProblemImage(request.user.id, request.params.id, problemIndex),
    ]);
    await removeProblemContext(request.user.id, request.params.id, problemIndex);
    await removeProblemTitle(request.user.id, request.params.id, problemIndex);

    if (removedScene?.blobName) {
      await deleteBlobIfExists(removedScene.blobName);
    }
    if (removedImage?.blobName) {
      await deleteBlobIfExists(removedImage.blobName);
    }

    await shiftProblemIndexesAfter(request.user.id, request.params.id, problemIndex);
    const updated = await setAssignmentProblemCount(
      request.user.id,
      request.params.id,
      assignment.problemCount - 1,
    );

    response.json({
      assignment: updated,
      removedProblemIndex: problemIndex,
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
