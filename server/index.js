import express from "express";
import multer from "multer";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfParseModule = require("pdf-parse");
const legacyPdfParse = typeof pdfParseModule === "function"
  ? pdfParseModule
  : (typeof pdfParseModule?.default === "function" ? pdfParseModule.default : null);
const PdfParseCtor = typeof pdfParseModule?.PDFParse === "function" ? pdfParseModule.PDFParse : null;
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
  downloadNoteFileFromBlob,
  downloadNoteFileBufferFromBlob,
  uploadAssignmentPdfToBlob,
  uploadProblemImageToBlob,
  uploadProblemSceneToBlob,
  uploadNoteFileToBlob,
} from "./blobStorage.js";
import {
  createProblemErrorAttempt,
  deleteUserData,
  findAssignmentById,
  getNotebookQuizSession,
  getProblemProgress,
  getAssignmentPdfByAssignmentId,
  getProblemContext,
  getProblemImage,
  getScene,
  initDb,
  insertAssignment,
  listNotebookQuizSessions,
  listProblemProgressForAssignment,
  listAssignmentPdfsForUser,
  listProblemErrorAttempts,
  listProblemErrorSummary,
  listProblemImageBlobNamesForAssignment,
  listProblemImageBlobNamesForUser,
  listAssignmentsForUser,
  listSceneBlobNamesForAssignment,
  listProblemTitles,
  removeProblemImage,
  removeProblemErrors,
  removeProblemContext,
  removeProblemTitle,
  removeScene,
  upsertNotebookQuizSession,
  upsertProblemProgress,
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
  listNotebookSubjects,
  getNotebookSubject,
  insertNotebookSubject,
  removeNotebookSubject,
  listNotebookNotes,
  getNotebookNote,
  insertNotebookNote,
  updateNotebookNote,
  removeNotebookNote,
  listAllNotebookNotesForUser,
} from "./db.js";
import {
  initSearchIndex,
  indexNoteChunks,
  deleteNoteFromIndex,
  deleteNotebookFromIndex,
  searchNotes,
} from "./searchService.js";

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

const extractTextFromPdfBuffer = async (buffer) => {
  if (legacyPdfParse) {
    const parsed = await legacyPdfParse(buffer);
    return String(parsed?.text || "").trim();
  }

  if (PdfParseCtor) {
    const parser = new PdfParseCtor({ data: buffer });
    try {
      const parsed = await parser.getText();
      return String(parsed?.text || "").trim();
    } finally {
      if (typeof parser.destroy === "function") {
        await Promise.resolve(parser.destroy()).catch(() => {});
      }
    }
  }

  throw new Error("No compatible pdf-parse API found.");
};
const MAX_PDF_IMAGES_PER_BLOB = 1;
const MAX_RETRIEVED_SOURCE_IMAGES = 3;
const MAX_RETRIEVED_SOURCE_BLOBS = 2;
const VISUAL_QUERY_HINT_REGEX =
  /\b(image|photo|diagram|graph|figure|chart|table|draw|drawing|shown|see|visual|look at|looks like)\b/i;
const QR_OR_BARCODE_HINT_REGEX =
  /\b(qr|barcode|scan code|scan this|upi|paytm|gpay|whatsapp web|scan to pay)\b/i;
const containsQrLikeHints = (value) => QR_OR_BARCODE_HINT_REGEX.test(String(value || ""));
const shouldUseRetrievedSourceImages = (query, userImages) =>
  userImages.length === 0 && VISUAL_QUERY_HINT_REGEX.test(String(query || ""));
const extractImagesFromPdfBuffer = async (buffer) => {
  if (!PdfParseCtor || !buffer) return [];

  const parser = new PdfParseCtor({ data: buffer });
  try {
    // Prefer embedded image extraction first.
    const extracted = await parser.getImage({
      first: 4,
      imageThreshold: 0,
      imageDataUrl: false,
      imageBuffer: true,
    });

    const images = [];
    const pages = Array.isArray(extracted?.pages) ? extracted.pages : [];
    for (const page of pages) {
      const pageNumber = Number(page?.page || page?.pageNumber || 0) || null;
      const pageImages = Array.isArray(page?.images) ? page.images : [];
      for (const img of pageImages) {
        const data = img?.data;
        if (!data) continue;
        const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const mimeType = String(img?.type || img?.mimeType || "image/png");
        images.push({ buffer: bufferData, mimeType, pageNumber });
        if (images.length >= MAX_PDF_IMAGES_PER_BLOB) return images;
      }
    }

    if (images.length > 0) return images;

    // Fallback: render first page screenshot if no embedded images were found.
    const screenshot = await parser.getScreenshot({
      first: 1,
      imageDataUrl: false,
      imageBuffer: true,
    });
    const shotPage = Array.isArray(screenshot?.pages) ? screenshot.pages[0] : null;
    if (shotPage?.data) {
      const bufferData = Buffer.isBuffer(shotPage.data) ? shotPage.data : Buffer.from(shotPage.data);
      return [{ buffer: bufferData, mimeType: "image/png", pageNumber: 1 }];
    }

    return [];
  } finally {
    if (typeof parser.destroy === "function") {
      await Promise.resolve(parser.destroy()).catch(() => {});
    }
  }
};
const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;
const MAX_ERROR_MISTAKES = 10;
const MAX_TOPICS_PER_MISTAKE = 5;
const MAX_CONCEPTS_PER_MISTAKE = 8;
const MAX_OBSERVED_STEP_LENGTH = 220;
const MAX_STAGE_LENGTH = 80;
const MAX_ERROR_TYPE_LENGTH = 40;
const MAX_MISTAKE_SUMMARY_LENGTH = 180;
const MAX_WHY_WRONG_LENGTH = 260;
const MAX_SUGGESTED_FIX_LENGTH = 260;
const SESSION_COOKIE_NAME = "stepwise_session";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const loadNotebookSubjectOrRespond = async (request, response) => {
  const subjectId = String(request.params?.subjectId || "").trim();
  if (!subjectId) {
    response.status(400).json({ message: "Notebook subject id is required." });
    return null;
  }
  const subject = await getNotebookSubject(request.user.id, subjectId);
  if (!subject) {
    response.status(404).json({ message: "Notebook not found." });
    return null;
  }
  return subject;
};

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

const ERROR_SIGNAL_PATTERN =
  /\b(error|incorrect|wrong|mistake|mistaken|substituted incorrectly|recheck|recalculate|fix|correction)\b/i;

const classifyHintAsError = (hint) => ERROR_SIGNAL_PATTERN.test(String(hint || "").trim());

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
        max_completion_tokens: maxTokens,
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

const generateErrorFeedbackWithAzure = async ({
  problemContext,
  drawingBuffer,
  drawingMimeType = "image/png",
}) => {
  const raw = await requestAzureChatCompletion({
    temperature: 0,
    maxTokens: 160,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
Check whether the student's selected handwritten math work contains an error.

Problem context:
${problemContext || "None"}

Return exactly one of these two formats only:
1. No
2. Yes: <short error description>

Rules:
- Only answer "Yes" if there is a clear mathematical error in the written step.
- Do not provide hints, corrections, next steps, or the final answer.
- Keep the error description short and specific.
- Do not return JSON.
            `.trim(),
          },
          createImageUrlPart(drawingBuffer, drawingMimeType),
        ],
      },
    ],
  });

  const cleaned = String(raw || "").trim();
  if (/^no\b/i.test(cleaned)) {
    return { hasError: false, error: "" };
  }

  const yesMatch = cleaned.match(/^yes\s*:\s*(.+)$/i);
  if (yesMatch?.[1]) {
    return {
      hasError: true,
      error: normalizeBoundedText(yesMatch[1], MAX_WHY_WRONG_LENGTH) || "There is an error in this step.",
    };
  }

  return {
    hasError: false,
    error: "",
  };
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

const cleanJsonBlock = (value) =>
  String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

const parseJsonObject = (value, fallback) => {
  try {
    const parsed = JSON.parse(cleanJsonBlock(value));
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // Ignore parse failures and fall back below.
  }
  return fallback;
};

const buildStudyToolPrompt = ({ tool, subject, notesText }) => {
  const commonRules = `
You are an expert educator creating comprehensive, high-quality study material based on a student's detailed notes.

Subject: ${subject}

Source Notes:
${notesText}

Rules:
- Deeply analyze the provided notes to extract core concepts, detailed facts, formulas, and nuanced ideas.
- Do not just ask superficial questions about the titles. Drill down into the actual material.
- If the notes contain detailed explanations, definitions, or step-by-step processes, make sure your study items test a thorough understanding of them.
- Make the questions challenging but fair, aiming to genuinely test comprehension of the source material.
- Rely ONLY on the provided notes text.
- Return valid JSON only.
- Do not wrap the JSON in markdown fences.
  `.trim();

  if (tool === "flashcards") {
    return `
${commonRules}

Return this JSON shape:
{
  "title": "string",
  "cards": [
    {
      "question": "string",
      "answer": "string",
      "difficulty": "easy|medium|hard",
      "tag": "string"
    }
  ]
}

Generate 6 to 10 flashcards. Keep each answer concise but useful.
    `.trim();
  }

  if (tool === "quiz") {
    return `
${commonRules}

Return this JSON shape:
{
  "title": "string",
  "questions": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctIndex": 0,
      "explanation": "string",
      "hint": "string",
      "difficulty": "easy|medium|hard"
    }
  ]
}

Generate 5 to 8 multiple-choice questions with exactly 4 options each.
Only one option should be correct.
    `.trim();
  }

  if (tool === "revision-sheet") {
    return `
${commonRules}

Return this JSON shape:
{
  "title": "string",
  "summary": "string",
  "keyPoints": ["string"],
  "formulas": ["string"],
  "commonMistakes": ["string"],
  "quickChecks": ["string"],
  "examTips": ["string"]
}

Make it concise and revision-ready.
    `.trim();
  }

  return `
${commonRules}

Return this JSON shape:
{
  "title": "string",
  "centralTopic": "string",
  "branches": [
    {
      "title": "string",
      "points": ["string"]
    }
  ]
}

Generate 4 to 6 branches for a clean mind map.
  `.trim();
};

const generateStudyToolWithAzure = async ({ tool, subject, notesText }) => {
  const raw = await requestAzureChatCompletion({
    temperature: 0.3,
    maxTokens: 1800,
    messages: [
      {
        role: "user",
        content: buildStudyToolPrompt({ tool, subject, notesText }),
      },
    ],
  });

  if (tool === "flashcards") {
    const parsed = parseJsonObject(raw, { title: `${subject} Flashcards`, cards: [] });
    return {
      title: String(parsed.title || `${subject} Flashcards`),
      cards: Array.isArray(parsed.cards)
        ? parsed.cards.map((card) => ({
            question: String(card?.question || "").trim(),
            answer: String(card?.answer || "").trim(),
            difficulty: String(card?.difficulty || "medium").trim().toLowerCase(),
            tag: String(card?.tag || subject).trim(),
          })).filter((card) => card.question && card.answer)
        : [],
    };
  }

  if (tool === "quiz") {
    const parsed = parseJsonObject(raw, { title: `${subject} Quiz`, questions: [] });
    return {
      title: String(parsed.title || `${subject} Quiz`),
      questions: Array.isArray(parsed.questions)
        ? parsed.questions.map((question) => ({
            question: String(question?.question || "").trim(),
            options: Array.isArray(question?.options)
              ? question.options.map((option) => String(option || "").trim()).slice(0, 4)
              : [],
            correctIndex: Number.isInteger(question?.correctIndex) ? question.correctIndex : 0,
            explanation: String(question?.explanation || "").trim(),
            hint: String(question?.hint || "").trim(),
            difficulty: String(question?.difficulty || "medium").trim().toLowerCase(),
          })).filter((question) => question.question && question.options.length === 4)
        : [],
    };
  }

  if (tool === "revision-sheet") {
    const parsed = parseJsonObject(raw, {
      title: `${subject} Revision Sheet`,
      summary: "",
      keyPoints: [],
      formulas: [],
      commonMistakes: [],
      quickChecks: [],
      examTips: [],
    });

    return {
      title: String(parsed.title || `${subject} Revision Sheet`),
      summary: String(parsed.summary || "").trim(),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((item) => String(item || "").trim()).filter(Boolean) : [],
      formulas: Array.isArray(parsed.formulas) ? parsed.formulas.map((item) => String(item || "").trim()).filter(Boolean) : [],
      commonMistakes: Array.isArray(parsed.commonMistakes) ? parsed.commonMistakes.map((item) => String(item || "").trim()).filter(Boolean) : [],
      quickChecks: Array.isArray(parsed.quickChecks) ? parsed.quickChecks.map((item) => String(item || "").trim()).filter(Boolean) : [],
      examTips: Array.isArray(parsed.examTips) ? parsed.examTips.map((item) => String(item || "").trim()).filter(Boolean) : [],
    };
  }

  const parsed = parseJsonObject(raw, {
    title: `${subject} Mind Map`,
    centralTopic: subject,
    branches: [],
  });

  return {
    title: String(parsed.title || `${subject} Mind Map`),
    centralTopic: String(parsed.centralTopic || subject).trim(),
    branches: Array.isArray(parsed.branches)
      ? parsed.branches.map((branch) => ({
          title: String(branch?.title || "").trim(),
          points: Array.isArray(branch?.points)
            ? branch.points.map((point) => String(point || "").trim()).filter(Boolean)
            : [],
        })).filter((branch) => branch.title && branch.points.length > 0)
      : [],
  };
};

const buildNoteInsightPrompt = ({ mode, subject, title, content }) => {
  const common = `
You are analyzing one student note and extracting structured study help.

Subject: ${subject}
Note title: ${title}
Note content:
${content}

Rules:
- Use only the note content provided.
- Return valid JSON only.
- Do not wrap the JSON in markdown fences.
  `.trim();

  if (mode === "summary") {
    return `
${common}

Return:
{
  "summary": "string",
  "keyPoints": ["string"],
  "revisionChecklist": ["string"]
}
    `.trim();
  }

  if (mode === "formulas") {
    return `
${common}

Return:
{
  "formulas": [
    {
      "name": "string",
      "expression": "string",
      "meaning": "string"
    }
  ]
}

If the note contains no formulas, return an empty formulas array.
    `.trim();
  }

  return `
${common}

Return:
{
  "mistakes": [
    {
      "mistake": "string",
      "fix": "string"
    }
  ]
}

Infer likely mistakes only from the concepts present in the notes.
  `.trim();
};

const generateNoteInsightWithAzure = async ({ mode, subject, title, content }) => {
  const raw = await requestAzureChatCompletion({
    temperature: 0.3,
    maxTokens: 1200,
    messages: [
      {
        role: "user",
        content: buildNoteInsightPrompt({ mode, subject, title, content }),
      },
    ],
  });

  if (mode === "summary") {
    const parsed = parseJsonObject(raw, {
      summary: "",
      keyPoints: [],
      revisionChecklist: [],
    });

    return {
      summary: String(parsed.summary || "").trim(),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((item) => String(item || "").trim()).filter(Boolean) : [],
      revisionChecklist: Array.isArray(parsed.revisionChecklist)
        ? parsed.revisionChecklist.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
    };
  }

  if (mode === "formulas") {
    const parsed = parseJsonObject(raw, { formulas: [] });
    return {
      formulas: Array.isArray(parsed.formulas)
        ? parsed.formulas.map((formula) => ({
            name: String(formula?.name || "").trim(),
            expression: String(formula?.expression || "").trim(),
            meaning: String(formula?.meaning || "").trim(),
          })).filter((formula) => formula.name || formula.expression || formula.meaning)
        : [],
    };
  }

  const parsed = parseJsonObject(raw, { mistakes: [] });
  return {
    mistakes: Array.isArray(parsed.mistakes)
      ? parsed.mistakes.map((mistake) => ({
          mistake: String(mistake?.mistake || "").trim(),
          fix: String(mistake?.fix || "").trim(),
        })).filter((mistake) => mistake.mistake || mistake.fix)
      : [],
  };
};

const generateDashboardInsightsWithAzure = async ({ studentName, notebooks }) => {
  const raw = await requestAzureChatCompletion({
    temperature: 0.35,
    maxTokens: 1800,
    messages: [
      {
        role: "user",
        content: `
You are generating a student dashboard for StepWise AI.

Student name: ${studentName || "Student"}

Notebook progress data:
${JSON.stringify(notebooks, null, 2)}

Return valid JSON only in this exact shape:
{
  "learningPlan": [
    { "label": "string", "detail": "string", "value": "string" }
  ],
  "recommendations": [
    { "title": "string", "reason": "string", "action": "string" }
  ],
  "mastery": [
    { "topic": "string", "score": 0, "status": "strong|medium|weak", "focus": "string" }
  ],
  "summary": "string"
}

Rules:
- Base everything only on the notebook data provided.
- learningPlan should contain exactly 3 items.
- recommendations should contain exactly 3 items.
- mastery should contain one item per notebook.
- score must be an integer from 0 to 100.
- Keep all text concise and student-friendly.
        `.trim(),
      },
    ],
  });

  const parsed = parseJsonObject(raw, {
    learningPlan: [],
    recommendations: [],
    mastery: [],
    summary: "",
  });

  return {
    learningPlan: Array.isArray(parsed.learningPlan)
      ? parsed.learningPlan.map((item) => ({
          label: String(item?.label || "").trim(),
          detail: String(item?.detail || "").trim(),
          value: String(item?.value || "").trim(),
        })).filter((item) => item.label)
      : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((item) => ({
          title: String(item?.title || "").trim(),
          reason: String(item?.reason || "").trim(),
          action: String(item?.action || "").trim(),
        })).filter((item) => item.title)
      : [],
    mastery: Array.isArray(parsed.mastery)
      ? parsed.mastery.map((item) => ({
          topic: String(item?.topic || "").trim(),
          score: Math.max(0, Math.min(100, Number(item?.score || 0))),
          status: String(item?.status || "medium").trim().toLowerCase(),
          focus: String(item?.focus || "").trim(),
        })).filter((item) => item.topic)
      : [],
    summary: String(parsed.summary || "").trim(),
  };
};

const extractImageTextWithAzureOpenAI = async (buffer, mimeType = "image/png") => {
  const raw = await requestAzureChatCompletion({
    temperature: 0.1,
    maxTokens: 1800,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
You are reading a student's notebook page or study notes from an image.

Transcribe the visible notes faithfully into clean plain text.

Rules:
- Preserve formulas, bullets, headings, and line breaks when possible.
- Do not summarize.
- Do not add explanations.
- If some text is unclear, keep the readable parts and omit only the unreadable fragments.
- Return plain text only.
            `.trim(),
          },
          createImageUrlPart(buffer, mimeType),
        ],
      },
    ],
  });

  return String(raw || "").trim();
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

const clampLimit = (value, fallback = 20, max = 100) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const parseNonNegativeSeconds = (value) => {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const normalizeBoundedText = (value, maxLength) => String(value || "").trim().slice(0, maxLength);

const normalizeTagList = (value, maxItems = 5, maxLength = 64) => {
  if (!Array.isArray(value)) return [];
  const deduped = [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizeBoundedText(entry, maxLength).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= maxItems) break;
  }
  return deduped;
};

const normalizeErrorPayload = (body) => {
  const allowedCorrectness = new Set(["correct", "incorrect", "unclear"]);
  const allowedConfidence = new Set(["low", "medium", "high"]);
  const allowedSeverity = new Set(["low", "medium", "high"]);
  const allowedSource = new Set(["error_analysis"]);

  const sourceRaw = normalizeBoundedText(body?.source || "error_analysis", 40).toLowerCase();
  if (!allowedSource.has(sourceRaw)) {
    return { error: "source must be one of: error_analysis." };
  }

  const correctness = normalizeBoundedText(body?.correctness, 20).toLowerCase();
  if (!allowedCorrectness.has(correctness)) {
    return { error: "correctness must be one of: correct, incorrect, unclear." };
  }

  const confidence = normalizeBoundedText(body?.confidence, 20).toLowerCase();
  if (!allowedConfidence.has(confidence)) {
    return { error: "confidence must be one of: low, medium, high." };
  }

  const hintLevelRaw = body?.hintLevel;
  const hintLevel =
    hintLevelRaw == null || hintLevelRaw === ""
      ? null
      : Math.max(1, Math.min(4, Number(hintLevelRaw) || 1));

  const observedStep = normalizeBoundedText(body?.observedStep, MAX_OBSERVED_STEP_LENGTH);
  const stage = normalizeBoundedText(body?.stage, MAX_STAGE_LENGTH);
  const rawAnalysis =
    body?.rawAnalysis && typeof body.rawAnalysis === "object" && !Array.isArray(body.rawAnalysis)
      ? body.rawAnalysis
      : null;

  const mistakesRaw = Array.isArray(body?.mistakes) ? body.mistakes : [];
  if (mistakesRaw.length > MAX_ERROR_MISTAKES) {
    return { error: `mistakes must include at most ${MAX_ERROR_MISTAKES} entries.` };
  }

  const mistakes = mistakesRaw.map((entry) => {
    const severity = normalizeBoundedText(entry?.severity || "medium", 20).toLowerCase();
    if (!allowedSeverity.has(severity)) {
      return { error: "mistake severity must be one of: low, medium, high." };
    }

    const mistakeSummary = normalizeBoundedText(entry?.mistakeSummary, MAX_MISTAKE_SUMMARY_LENGTH);
    if (!mistakeSummary) {
      return { error: "mistakeSummary is required for each mistake." };
    }

    return {
      errorType: normalizeBoundedText(entry?.errorType, MAX_ERROR_TYPE_LENGTH).toLowerCase(),
      mistakeSummary,
      whyWrong: normalizeBoundedText(entry?.whyWrong, MAX_WHY_WRONG_LENGTH),
      suggestedFix: normalizeBoundedText(entry?.suggestedFix, MAX_SUGGESTED_FIX_LENGTH),
      severity,
      topics: normalizeTagList(entry?.topics, MAX_TOPICS_PER_MISTAKE),
      concepts: normalizeTagList(entry?.concepts, MAX_CONCEPTS_PER_MISTAKE),
    };
  });

  const invalidMistake = mistakes.find((entry) => entry?.error);
  if (invalidMistake?.error) {
    return { error: invalidMistake.error };
  }

  if (correctness === "incorrect" && mistakes.length === 0) {
    return { error: "mistakes must include at least one item when correctness is incorrect." };
  }

  return {
    payload: {
      source: sourceRaw,
      observedStep,
      stage,
      correctness,
      confidence,
      hintLevel: Number.isInteger(hintLevel) ? hintLevel : null,
      rawAnalysis,
      mistakes,
    },
  };
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

app.get("/api/contracts/problem-errors", (_request, response) => {
  response.json({
    version: "1.0",
    endpoint: "/api/assignments/:id/problems/:problemIndex/errors",
    enums: {
      source: ["error_analysis"],
      correctness: ["correct", "incorrect", "unclear"],
      confidence: ["low", "medium", "high"],
      severity: ["low", "medium", "high"],
    },
    limits: {
      maxMistakes: MAX_ERROR_MISTAKES,
      maxTopicsPerMistake: MAX_TOPICS_PER_MISTAKE,
      maxConceptsPerMistake: MAX_CONCEPTS_PER_MISTAKE,
      maxObservedStepLength: MAX_OBSERVED_STEP_LENGTH,
      maxStageLength: MAX_STAGE_LENGTH,
      maxErrorTypeLength: MAX_ERROR_TYPE_LENGTH,
      maxMistakeSummaryLength: MAX_MISTAKE_SUMMARY_LENGTH,
      maxWhyWrongLength: MAX_WHY_WRONG_LENGTH,
      maxSuggestedFixLength: MAX_SUGGESTED_FIX_LENGTH,
    },
    shape: {
      source: "error_analysis",
      observedStep: "string",
      stage: "string",
      correctness: "correct | incorrect | unclear",
      confidence: "low | medium | high",
      hintLevel: "number | null",
      rawAnalysis: "object | null",
      mistakes: [
        {
          errorType: "string",
          mistakeSummary: "string",
          whyWrong: "string",
          suggestedFix: "string",
          severity: "low | medium | high",
          topics: ["string"],
          concepts: ["string"],
        },
      ],
    },
  });
});

const isDebugRoutesEnabled = () => {
  const flag = readEnv("STEPWISE_DEBUG_ROUTES").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
};

const sanitizeDebugLabel = (value) =>
  String(value || "debug")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .slice(0, 48);

const debugImageCache = new Map();
const MAX_DEBUG_CACHE_ITEMS = 60;

const buildDebugCacheKey = (userId, label) => `${String(userId || "anonymous")}::${label}`;

app.get("/api/debug/echo-image", requireAuth, (request, response) => {
  if (!isDebugRoutesEnabled()) {
    response.status(404).json({ message: "Not found." });
    return;
  }

  const label = sanitizeDebugLabel(request.query?.label);
  const cacheKey = buildDebugCacheKey(request.user?.id, label);
  const cached = debugImageCache.get(cacheKey);
  if (!cached?.buffer) {
    response.status(404).json({ message: "No debug image captured yet for this label." });
    return;
  }

  response.setHeader("Content-Type", cached.mimeType || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Disposition", `inline; filename="${label}.${cached.extension}"`);
  response.send(cached.buffer);
});

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

  const label = sanitizeDebugLabel(request.query?.label);
  const mimeType = file.mimetype || "application/octet-stream";
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "bin";
  const cacheKey = buildDebugCacheKey(request.user?.id, label);
  debugImageCache.set(cacheKey, {
    buffer: Buffer.from(file.buffer),
    mimeType,
    extension,
    createdAt: Date.now(),
  });
  if (debugImageCache.size > MAX_DEBUG_CACHE_ITEMS) {
    const oldestKey = debugImageCache.keys().next().value;
    if (oldestKey) debugImageCache.delete(oldestKey);
  }

  response.setHeader("Content-Type", mimeType);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Disposition", `inline; filename="${label}.${extension}"`);
  response.send(file.buffer);
});

app.use(express.json({ limit: "2mb" }));

app.post("/api/notes/study-tools", requireAuth, async (request, response) => {
  const tool = String(request.body?.tool || "").trim().toLowerCase();
  const subject = String(request.body?.subject || "").trim();
  const notes = Array.isArray(request.body?.notes) ? request.body.notes : [];
  const supportedTools = new Set(["flashcards", "quiz", "revision-sheet", "mind-map"]);

  if (!supportedTools.has(tool)) {
    response.status(400).json({ message: "Unsupported study tool." });
    return;
  }

  if (!subject) {
    response.status(400).json({ message: "Subject is required." });
    return;
  }

  const normalizedNotes = notes
    .map((entry) => ({
      title: String(entry?.title || "").trim(),
      content: String(entry?.content || "").trim(),
    }))
    .filter((entry) => entry.title || entry.content);

  if (normalizedNotes.length === 0) {
    response.status(400).json({ message: "At least one note is required to generate study material." });
    return;
  }

  const notesText = normalizedNotes
    .map((entry, index) => `Note ${index + 1}: ${entry.title || "Untitled"}\n${entry.content}`)
    .join("\n\n---\n\n")
    .slice(0, 50000);

  try {
    const output = await generateStudyToolWithAzure({
      tool,
      subject,
      notesText,
    });

    response.json({
      tool,
      subject,
      output,
    });
  } catch (error) {
    console.error("Study tool generation failed:", error.message);
    response.status(500).json({ message: "Unable to generate study material right now." });
  }
});

app.post("/api/notes/insights", requireAuth, async (request, response) => {
  const mode = String(request.body?.mode || "").trim().toLowerCase();
  const subject = String(request.body?.subject || "").trim();
  const title = String(request.body?.title || "").trim();
  const content = String(request.body?.content || "").trim();
  const supportedModes = new Set(["summary", "formulas", "mistakes"]);

  if (!supportedModes.has(mode)) {
    response.status(400).json({ message: "Unsupported note insight mode." });
    return;
  }

  if (!subject) {
    response.status(400).json({ message: "Subject is required." });
    return;
  }

  if (!content) {
    response.status(400).json({ message: "Note content is required." });
    return;
  }

  try {
    const output = await generateNoteInsightWithAzure({
      mode,
      subject,
      title: title || "Untitled Note",
      content,
    });

    response.json({
      mode,
      subject,
      output,
    });
  } catch (error) {
    console.error("Note insight generation failed:", error.message);
    response.status(500).json({ message: "Unable to analyze this note right now." });
  }
});

app.post("/api/notes/extract-image-text", requireAuth, upload.single("file"), async (request, response) => {
  const file = request.file;
  if (!file) {
    response.status(400).json({ message: "Image file is required." });
    return;
  }

  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(file.mimetype)) {
    response.status(400).json({ message: "Only PNG, JPEG, and WEBP uploads are supported." });
    return;
  }

  try {
    const text = await extractImageTextWithAzureOpenAI(file.buffer, file.mimetype || "image/png");
    response.json({ text });
  } catch (error) {
    console.error("Image note extraction failed:", error.message);
    response.status(500).json({ message: "Unable to extract notes from this image with Azure OpenAI right now." });
  }
});

// ── Notebook Subjects ──────────────────────────────────

app.get("/api/notebooks/subjects", requireAuth, async (request, response) => {
  try {
    const subjects = await listNotebookSubjects(request.user.id);
    response.json(subjects.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt })));
  } catch (error) {
    console.error("List notebook subjects failed:", error.message);
    response.status(500).json({ message: "Unable to load notebooks." });
  }
});

app.post("/api/notebooks/subjects", requireAuth, async (request, response) => {
  const name = String(request.body?.name || "").trim();
  if (!name) {
    response.status(400).json({ message: "Notebook name is required." });
    return;
  }
  try {
    const subject = await insertNotebookSubject(request.user.id, name);
    response.status(201).json({ id: subject.id, name: subject.name, createdAt: subject.createdAt, updatedAt: subject.updatedAt });
  } catch (error) {
    console.error("Create notebook subject failed:", error.message);
    response.status(500).json({ message: "Unable to create notebook." });
  }
});

app.delete("/api/notebooks/subjects/:subjectId", requireAuth, async (request, response) => {
  try {
    const notes = await listNotebookNotes(request.user.id, request.params.subjectId);
    for (const note of notes) {
      if (note.blobName) {
        await deleteBlobIfExists(note.blobName).catch(() => {});
      }
    }
    await removeNotebookSubject(request.user.id, request.params.subjectId);
    await deleteNotebookFromIndex(request.params.subjectId);
    response.status(204).end();
  } catch (error) {
    console.error("Delete notebook subject failed:", error.message);
    response.status(500).json({ message: "Unable to delete notebook." });
  }
});

// ── Notebook Notes ─────────────────────────────────────

app.get("/api/notebooks/:subjectId/notes", requireAuth, async (request, response) => {
  try {
    const subject = await loadNotebookSubjectOrRespond(request, response);
    if (!subject) return;
    const notes = await listNotebookNotes(request.user.id, request.params.subjectId);
    response.json(notes.map((n) => ({
      id: n.id, title: n.title, content: n.content, tags: n.tags,
      sourceType: n.sourceType, fileName: n.fileName,
      updatedAt: n.updatedAt, createdAt: n.createdAt,
    })));
  } catch (error) {
    console.error("List notes failed:", error.message);
    response.status(500).json({ message: "Unable to load notes." });
  }
});

app.post("/api/notebooks/:subjectId/notes", requireAuth, async (request, response) => {
  const title = String(request.body?.title || "").trim();
  const content = String(request.body?.content || "").trim();
  const tags = Array.isArray(request.body?.tags) ? request.body.tags : [];
  if (!title) {
    response.status(400).json({ message: "Note title is required." });
    return;
  }
  try {
    const subject = await loadNotebookSubjectOrRespond(request, response);
    if (!subject) return;
    const note = await insertNotebookNote(request.user.id, request.params.subjectId, { title, content, tags, sourceType: "text" });
    
    // Index in background
    Promise.resolve()
      .then(() => {
        indexNoteChunks({
          userId: request.user.id,
          noteId: note.id,
          subjectId: request.params.subjectId,
          subjectName: subject.name,
          title: note.title,
          content: note.content,
          sourceType: note.sourceType,
          tags: note.tags,
          updatedAt: note.updatedAt,
          blobName: note.blobName || "",
          contentType: note.contentType || "",
        });
      })
      .catch((e) => console.error("Failed to index note:", e));

    response.status(201).json({
      id: note.id, title: note.title, content: note.content, tags: note.tags,
      sourceType: note.sourceType, updatedAt: note.updatedAt, createdAt: note.createdAt,
    });
  } catch (error) {
    console.error("Create note failed:", error.message);
    response.status(500).json({ message: "Unable to create note." });
  }
});

app.patch("/api/notebooks/:subjectId/notes/:noteId", requireAuth, async (request, response) => {
  const title = request.body?.title != null ? String(request.body.title).trim() : undefined;
  const content = request.body?.content != null ? String(request.body.content) : undefined;
  const tags = Array.isArray(request.body?.tags) ? request.body.tags : undefined;
  try {
    const updated = await updateNotebookNote(request.user.id, request.params.noteId, { title, content, tags });
    if (!updated) { response.status(404).json({ message: "Note not found." }); return; }
    
    // Update index in background
    getNotebookSubject(request.user.id, request.params.subjectId)
      .then((subject) => {
        if (subject) {
          indexNoteChunks({
            userId: request.user.id,
            noteId: updated.id,
            subjectId: request.params.subjectId,
            subjectName: subject.name,
            title: updated.title,
            content: updated.content,
            sourceType: updated.sourceType,
            tags: updated.tags,
            updatedAt: updated.updatedAt,
            blobName: updated.blobName || "",
            contentType: updated.contentType || "",
          });
        }
      })
      .catch((e) => console.error("Failed to re-index note:", e));

    response.json({
      id: updated.id, title: updated.title, content: updated.content, tags: updated.tags,
      sourceType: updated.sourceType, updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error("Update note failed:", error.message);
    response.status(500).json({ message: "Unable to update note." });
  }
});

app.delete("/api/notebooks/:subjectId/notes/:noteId", requireAuth, async (request, response) => {
  try {
    const note = await getNotebookNote(request.user.id, request.params.noteId);
    if (note?.blobName) { await deleteBlobIfExists(note.blobName).catch(() => {}); }
    await removeNotebookNote(request.user.id, request.params.noteId);
    await deleteNoteFromIndex(request.params.noteId);
    response.status(204).end();
  } catch (error) {
    console.error("Delete note failed:", error.message);
    response.status(500).json({ message: "Unable to delete note." });
  }
});

// PDF upload → store blob + create note with extracted text
app.post("/api/notebooks/:subjectId/notes/upload-pdf", requireAuth, upload.single("file"), async (request, response) => {
  const file = request.file;
  if (!file) { response.status(400).json({ message: "PDF file is required." }); return; }
  if (file.mimetype !== "application/pdf") { response.status(400).json({ message: "Only PDF files are supported." }); return; }
  try {
    const subject = await loadNotebookSubjectOrRespond(request, response);
    if (!subject) return;
    const tempNoteId = `note-${Date.now()}`;
    const blobResult = await uploadNoteFileToBlob({
      userId: request.user.id, subjectId: request.params.subjectId,
      noteId: tempNoteId, fileName: file.originalname || "upload.pdf",
      contentType: "application/pdf", buffer: file.buffer,
    });
    let extractedText = String(request.body?.extractedText || "").trim();
    if (!extractedText || extractedText === "No readable text was found in this PDF.") {
      try {
        extractedText = await extractTextFromPdfBuffer(file.buffer);
      } catch (err) {
        console.error("Fallback PDF extraction failed:", err.message);
      }
    }
    const title = String(request.body?.title || file.originalname || "PDF Upload")
      .replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "PDF Upload";
    const note = await insertNotebookNote(request.user.id, request.params.subjectId, {
      title, content: extractedText || `Imported PDF: ${file.originalname || "file.pdf"}`,
      tags: ["PDF", "Uploaded"], sourceType: "pdf",
      blobName: blobResult.blobName, fileName: file.originalname || "upload.pdf",
      contentType: "application/pdf", fileSize: file.size,
    });

    // Index in background
    Promise.resolve()
      .then(() => {
        if (extractedText) {
          indexNoteChunks({
            userId: request.user.id,
            noteId: note.id,
            subjectId: request.params.subjectId,
            subjectName: subject.name,
            title: note.title,
            content: note.content,
            sourceType: note.sourceType,
            tags: note.tags,
            updatedAt: note.updatedAt,
            blobName: note.blobName || "",
            contentType: note.contentType || "",
          });
        }
      })
      .catch((e) => console.error("Failed to index PDF note:", e));

    response.status(201).json({
      id: note.id, title: note.title, content: note.content, tags: note.tags,
      sourceType: note.sourceType, fileName: note.fileName,
      updatedAt: note.updatedAt, createdAt: note.createdAt,
    });
  } catch (error) {
    console.error("PDF note upload failed:", error.message);
    response.status(500).json({ message: "Unable to upload PDF." });
  }
});

// Image upload → store blob + OCR extract text → create note
app.post("/api/notebooks/:subjectId/notes/upload-image", requireAuth, upload.single("file"), async (request, response) => {
  const file = request.file;
  if (!file) { response.status(400).json({ message: "Image file is required." }); return; }
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(file.mimetype)) { response.status(400).json({ message: "Only PNG, JPEG, and WEBP images are supported." }); return; }
  try {
    const subject = await loadNotebookSubjectOrRespond(request, response);
    if (!subject) return;
    const tempNoteId = `note-${Date.now()}`;
    const blobResult = await uploadNoteFileToBlob({
      userId: request.user.id, subjectId: request.params.subjectId,
      noteId: tempNoteId, fileName: file.originalname || "image.png",
      contentType: file.mimetype, buffer: file.buffer,
    });
    let extractedText = "";
    try { extractedText = await extractImageTextWithAzureOpenAI(file.buffer, file.mimetype); } catch (ocrErr) {
      console.error("OCR extraction failed, saving note without text:", ocrErr.message);
    }
    const title = String(request.body?.title || file.originalname || "Image Upload")
      .replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Image Upload";
    const note = await insertNotebookNote(request.user.id, request.params.subjectId, {
      title, content: extractedText || `Imported image: ${file.originalname || "image"}`,
      tags: ["Notebook Image", "Uploaded"], sourceType: "image",
      blobName: blobResult.blobName, fileName: file.originalname || "image.png",
      contentType: file.mimetype, fileSize: file.size,
    });

    // Index in background
    Promise.resolve()
      .then(() => {
        if (extractedText) {
          indexNoteChunks({
            userId: request.user.id,
            noteId: note.id,
            subjectId: request.params.subjectId,
            subjectName: subject.name,
            title: note.title,
            content: note.content,
            sourceType: note.sourceType,
            tags: note.tags,
            updatedAt: note.updatedAt,
            blobName: note.blobName || "",
            contentType: note.contentType || "",
          });
        }
      })
      .catch((e) => console.error("Failed to index image note:", e));

    response.status(201).json({
      id: note.id, title: note.title, content: note.content, tags: note.tags,
      sourceType: note.sourceType, fileName: note.fileName,
      updatedAt: note.updatedAt, createdAt: note.createdAt,
    });
  } catch (error) {
    console.error("Image note upload failed:", error.message);
    response.status(500).json({ message: "Unable to upload image note." });
  }
});

// Download original note file
app.get("/api/notebooks/:subjectId/notes/:noteId/file", requireAuth, async (request, response) => {
  try {
    const note = await getNotebookNote(request.user.id, request.params.noteId);
    if (!note || !note.blobName) { response.status(404).json({ message: "Note file not found." }); return; }
    const download = await downloadNoteFileFromBlob(note.blobName);
    if (!download) { response.status(404).json({ message: "File not found in storage." }); return; }
    response.set("Content-Type", download.contentType);
    response.set("Content-Disposition", `inline; filename="${note.fileName || "file"}"`);
    if (download.contentLength) response.set("Content-Length", String(download.contentLength));
    download.stream.pipe(response);
  } catch (error) {
    console.error("Note file download failed:", error.message);
    response.status(500).json({ message: "Unable to download note file." });
  }
});

// Get all notes for a user (knowledge base for Socratic Tutor)
app.get("/api/notebooks/notes/all", requireAuth, async (request, response) => {
  try {
    const notes = await listAllNotebookNotesForUser(request.user.id);
    response.json(notes.map((n) => ({
      id: n.id, subjectId: n.subjectId, title: n.title, content: n.content,
      tags: n.tags, sourceType: n.sourceType, updatedAt: n.updatedAt,
    })));
  } catch (error) {
    console.error("List all notes failed:", error.message);
    response.status(500).json({ message: "Unable to load notes." });
  }
});

// Re-index all notes for a user (backfill blobName/contentType for multimodal RAG)
app.post("/api/notebooks/reindex", requireAuth, async (request, response) => {
  try {
    const notes = await listAllNotebookNotesForUser(request.user.id);
    const subjects = await listNotebookSubjects(request.user.id);
    const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));

    let indexed = 0;
    let skipped = 0;

    for (const note of notes) {
      if (!note.content || note.content.startsWith("Imported PDF:") || note.content.startsWith("Imported image:")) {
        skipped++;
        continue;
      }

      try {
        await indexNoteChunks({
          userId: request.user.id,
          noteId: note.id,
          subjectId: note.subjectId,
          subjectName: subjectMap.get(note.subjectId) || "Untitled Subject",
          title: note.title,
          content: note.content,
          sourceType: note.sourceType,
          tags: note.tags,
          updatedAt: note.updatedAt,
          blobName: note.blobName || "",
          contentType: note.contentType || "",
        });
        indexed++;
      } catch (err) {
        console.error(`Failed to re-index note ${note.id}:`, err.message);
        skipped++;
      }
    }

    console.log(`Re-index complete: ${indexed} indexed, ${skipped} skipped out of ${notes.length} total`);
    response.json({ total: notes.length, indexed, skipped });
  } catch (error) {
    console.error("Re-index failed:", error.message);
    response.status(500).json({ message: "Unable to re-index notes." });
  }
});

// Debug: inspect what's in the search index for the current user
app.get("/api/debug/search-index", requireAuth, async (request, response) => {
  if (!isDebugRoutesEnabled()) {
    return response.status(404).json({ message: "Not found." });
  }

  try {
    const testQuery = String(request.query?.q || "*").trim();
    const topK = Math.min(20, Math.max(1, Number(request.query?.top) || 10));
    const results = await searchNotes(request.user.id, testQuery, null, topK);

    response.json({
      query: testQuery,
      resultCount: results.length,
      results: results.map((r) => ({
        noteId: r.noteId,
        title: r.title,
        chunkPreview: String(r.chunkText || "").slice(0, 300),
        sourceType: r.sourceType,
        tags: r.tags,
        blobName: r.blobName || null,
        sourceContentType: r.sourceContentType || null,
      })),
    });
  } catch (error) {
    console.error("Debug search failed:", error.message);
    response.status(500).json({ message: "Search debug failed.", error: error.message });
  }
});

// Socratic Tutor endpoint using Azure AI Search knowledge base
app.post("/api/socratic/chat", requireAuth, async (request, response) => {
  const message = String(request.body?.message || "").trim();
  const history = Array.isArray(request.body?.history) ? request.body.history : [];
  const subjectId = request.body?.subjectId || null;
  const context = request.body?.context || {}; // { topic, concept, errorType }
  const audioBase64 = String(request.body?.audioBase64 || "").trim();
  const images = Array.isArray(request.body?.images) ? request.body.images : [];
  const rawClassLevel = Number(request.body?.classLevel);
  const classLevel =
    Number.isInteger(rawClassLevel) && rawClassLevel >= 1 && rawClassLevel <= 12 ? rawClassLevel : null;

  if (!message && !audioBase64 && images.length === 0) {
    return response.status(400).json({ message: "Message, audio, or image is required." });
  }

  try {
    const searchQuery = message || "student question";
    const searchResults = await searchNotes(request.user.id, searchQuery, subjectId, 5);
    
    // Build text context from search results
    let noteContext = "";
    if (searchResults && searchResults.length > 0) {
      noteContext = "Relevant notes context from student's notebook:\n" + 
        searchResults.map((res, i) => `[${i + 1}] Title: ${res.title}\nContent snippet: ${res.chunkText}`).join("\n\n");
    }

    const shouldRetrieveSourceImages = shouldUseRetrievedSourceImages(searchQuery, images);

    // Fetch source images for multimodal context (image notes + PDF pages)
    const retrievedImages = [];
    if (shouldRetrieveSourceImages && searchResults && searchResults.length > 0) {
      // Deduplicate by blob and keep most relevant chunk metadata.
      const byBlob = new Map();
      for (const res of searchResults) {
        const blob = String(res.blobName || "").trim();
        if (!blob) continue;
        const prev = byBlob.get(blob);
        const nextScore = Number(res.searchScore || 0);
        const prevScore = Number(prev?.searchScore || 0);
        if (!prev || nextScore > prevScore) {
          byBlob.set(blob, res);
        }
      }

      const candidates = Array.from(byBlob.values())
        .filter((res) => {
          const hintText = `${res.title || ""}\n${res.chunkText || ""}`;
          return !containsQrLikeHints(hintText);
        })
        .sort((a, b) => Number(b.searchScore || 0) - Number(a.searchScore || 0))
        .slice(0, MAX_RETRIEVED_SOURCE_BLOBS);

      const retrievedByBlob = await Promise.all(candidates.map(async (res) => {
        const blob = res.blobName;
        const ct = res.sourceContentType || "";
        try {
          const download = await downloadNoteFileBufferFromBlob(blob);
          if (!download?.buffer) return [];
          const mimeType = download.contentType || ct || "application/octet-stream";
          const isImage = String(mimeType).startsWith("image/");
          const isPdf = String(mimeType).includes("pdf");

          if (isImage) {
            if (containsQrLikeHints(res.title) || containsQrLikeHints(res.chunkText)) return [];
            return [{
              base64: download.buffer.toString("base64"),
              mimeType,
              title: res.title,
            }];
          }

          if (isPdf) {
            const pdfImages = await extractImagesFromPdfBuffer(download.buffer).catch(() => []);
            return pdfImages
              .slice(0, MAX_PDF_IMAGES_PER_BLOB)
              .map((pdfImage) => ({
                base64: pdfImage.buffer.toString("base64"),
                mimeType: pdfImage.mimeType || "image/png",
                title: pdfImage.pageNumber ? `${res.title} (page ${pdfImage.pageNumber})` : res.title,
              }));
          }

          return [];
        } catch (err) {
          console.warn(`Failed to download or parse note blob '${blob}':`, err.message);
          return [];
        }
      }));

      for (const batch of retrievedByBlob) {
        for (const img of batch) {
          if (retrievedImages.length >= MAX_RETRIEVED_SOURCE_IMAGES) break;
          retrievedImages.push(img);
        }
        if (retrievedImages.length >= MAX_RETRIEVED_SOURCE_IMAGES) break;
      }

      console.log(
        `Multimodal RAG: retrieved ${retrievedImages.length} source image(s) from ${candidates.length} candidate blob(s) for ${searchResults.length} search result(s)`,
      );
    }

    const systemPrompt = `You are a Socratic tutor aiming to help a student learn without giving away the direct answers.
Ask probing questions, break down problems, and guide them to their own realization in 1-2 short sentences.
Adjust your language, difficulty, and examples for this student's class level: ${classLevel ? `Class ${classLevel}` : "unknown"}.
If there is relevant notes context provided below, use it to provide personalized hints or references, but still don't give away the direct answer.
If the student sends audio, transcribe their speech internally and respond to the content of what they said.
If the student attaches images, analyze them carefully. The images may contain math problems, handwritten work, diagrams, or textbook pages. Describe what you see and guide the student based on the visual content.
If source images from the student's notebook are included in this conversation, use them to provide visual references and better explanations. Reference specific diagrams or figures when helpful.
Current learning context: Topic: ${context.topic || "unknown"}, Concept: ${context.concept || "unknown"}, recent error: ${context.errorType || "none"}.

${noteContext}`;

    // Build user content — multimodal when audio, user images, or retrieved images are present
    let userContent;
    const hasMultimodal = audioBase64 || images.length > 0 || retrievedImages.length > 0;
    if (hasMultimodal) {
      userContent = [];
      if (message) {
        userContent.push({ type: "text", text: message });
      }
      // Add user-attached images
      for (const img of images) {
        const mimeType = img.mimeType || "image/png";
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${img.base64}`,
          },
        });
      }
      // Add retrieved note images (multimodal RAG context)
      for (const rImg of retrievedImages) {
        userContent.push({
          type: "text",
          text: `[Source diagram from notes: "${rImg.title}"]`,
        });
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${rImg.mimeType};base64,${rImg.base64}`,
          },
        });
      }
      // Add audio if present
      if (audioBase64) {
        userContent.push({
          type: "input_audio",
          input_audio: {
            data: audioBase64,
            format: "webm",
          },
        });
      }
      // If no text was provided but images are, add a default prompt
      if (!message && images.length > 0 && !audioBase64) {
        userContent.unshift({ type: "text", text: "I'm sharing this image with you. Can you help me understand or solve what's shown here?" });
      }
    } else {
      userContent = message;
    }

    const promptMessages = [
      { role: "system", content: systemPrompt },
      ...history.map((msg) => ({ role: msg.role === "user" ? "user" : "assistant", content: msg.text })),
      { role: "user", content: userContent }
    ];

    const replyText = await requestAzureChatCompletion({ 
      messages: promptMessages, 
      maxTokens: 300, 
      temperature: 0.5 
    });

    response.json({ 
      reply: replyText, 
      usedNotes: searchResults.length > 0,
      usedNoteImages: retrievedImages.length > 0,
    });
  } catch (error) {
    console.error("Socratic chat failed:", error.message);
    response.status(500).json({ message: "Unable to process Socratic chat request." });
  }
});

// Azure Speech Token endpoint
app.get("/api/speech/token", requireAuth, async (request, response) => {
  const speechKey = globalThis.process?.env?.AZURE_SPEECH_KEY || "";
  const speechRegion = globalThis.process?.env?.AZURE_SPEECH_REGION || "eastus";

  if (!speechKey) {
    return response.status(500).json({ message: "AZURE_SPEECH_KEY is not configured on the server." });
  }

  try {
    const res = await fetch(`https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechKey,
        "Content-type": "application/x-www-form-urlencoded"
      }
    });
    
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const token = await res.text();
    response.json({ token, region: speechRegion });
  } catch (err) {
    console.error("Failed to fetch Speech token:", err.message);
    response.status(500).json({ message: "Speech integration unavailable." });
  }
});

app.post("/api/dashboard/insights", requireAuth, async (request, response) => {
  const studentName = String(request.body?.studentName || "").trim();
  const notebooks = Array.isArray(request.body?.notebooks) ? request.body.notebooks : [];

  if (notebooks.length === 0) {
    response.status(400).json({ message: "At least one notebook is required." });
    return;
  }

  try {
    const insights = await generateDashboardInsightsWithAzure({
      studentName,
      notebooks,
    });
    response.json(insights);
  } catch (error) {
    console.error("Dashboard insight generation failed:", error.message);
    response.status(500).json({ message: "Unable to generate dashboard insights right now." });
  }
});

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
    const formattedContext = formatProblemContextForHint(problemContext);
    const errorCheck = await generateErrorFeedbackWithAzure({
      problemContext: formattedContext,
      drawingBuffer: file.buffer,
      drawingMimeType: file.mimetype || "image/png",
    });

    let analysis = {
      observed_step: "",
      correctness: errorCheck.hasError ? "incorrect" : "unclear",
      confidence: "medium",
    };
    let hint = "";
    let errors = errorCheck.hasError ? [errorCheck.error] : [];

    if (!errorCheck.hasError) {
      const analysisRaw = await interpretStudentStepWithAzure({
        drawingBuffer: file.buffer,
        drawingMimeType: file.mimetype || "image/png",
        problemContext,
      });

      try {
        const cleaned = analysisRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        analysis = JSON.parse(cleaned);
      } catch {
        analysis = { observed_step: "Unreadable", correctness: "unclear", confidence: "low" };
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

      const isUnreadableStep = !observedStep || observedStep.toLowerCase() === "unreadable";
      const hintLevel = Math.min(4, Math.max(1, Number(request.body?.hintLevel) || 1));
      const previousHints = Array.isArray(safeJsonParse(request.body?.previousHints))
        ? safeJsonParse(request.body.previousHints).slice(0, 5).map(String)
        : [];

      hint = isUnreadableStep
        ? buildUnreadableHint(problemContext)
        : await generateHintWithAzure({
            problemContext: formattedContext,
            studentAnalysis: analysis,
            hintLevel,
            previousHints
          });

      if (hint && classifyHintAsError(hint)) {
        errors = [sanitizeHint(hint)];
        hint = "";
        analysis.correctness = "incorrect";
      }
    }

    response.json({
      analysis,
      errors,
      hint: hint ? sanitizeHint(hint) : "",
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

app.get("/api/assignments/:id/problems/progress", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const records = await listProblemProgressForAssignment(
    request.user.id,
    request.params.id,
    assignment.problemCount,
  );
  response.json({
    assignmentId: request.params.id,
    problemCount: assignment.problemCount,
    problems: records,
  });
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
    await removeProblemErrors(request.user.id, request.params.id, removedProblemIndex);
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
    await removeProblemErrors(request.user.id, request.params.id, problemIndex);
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

app.get(
  "/api/assignments/:id/problems/:problemIndex/progress",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const record = await getProblemProgress(request.user.id, request.params.id, problemIndex);
    response.json(
      record || {
        id: `${request.user.id}:${request.params.id}:${problemIndex}`,
        userId: request.user.id,
        assignmentId: request.params.id,
        problemIndex,
        attempted: false,
        solved: false,
        attemptedAt: null,
        solvedAt: null,
        totalTimeSeconds: 0,
        mistakeCount: 0,
        updatedAt: 0,
      },
    );
  },
);

app.patch(
  "/api/assignments/:id/problems/:problemIndex/progress",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const attempted = request.body?.attempted === true;
    const solved = request.body?.solved === true;
    const addTimeSeconds = parseNonNegativeSeconds(request.body?.addTimeSeconds);
    if (addTimeSeconds == null) {
      response.status(400).json({ message: "addTimeSeconds must be a non-negative number." });
      return;
    }

    const record = await upsertProblemProgress(
      request.user.id,
      request.params.id,
      problemIndex,
      { attempted, solved, addTimeSeconds },
    );
    response.json(record);
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

app.post(
  "/api/assignments/:id/problems/:problemIndex/errors",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const normalized = normalizeErrorPayload(request.body || {});
    if (normalized.error) {
      response.status(400).json({ message: normalized.error });
      return;
    }

    const created = await createProblemErrorAttempt(
      request.user.id,
      request.params.id,
      problemIndex,
      normalized.payload,
    );

    response.status(201).json(created);
  },
);

app.get(
  "/api/assignments/:id/problems/:problemIndex/errors",
  requireDb,
  requireAuth,
  async (request, response) => {
    const target = await getAssignmentAndProblemIndex(request, response);
    if (!target) return;
    const { problemIndex } = target;

    const limit = clampLimit(request.query?.limit, 50, 100);
    const records = await listProblemErrorAttempts(
      request.user.id,
      request.params.id,
      problemIndex,
      limit,
    );
    response.json({
      assignmentId: request.params.id,
      problemIndex,
      count: records.length,
      attempts: records,
    });
  },
);

app.get("/api/assignments/:id/errors/summary", requireDb, requireAuth, async (request, response) => {
  const assignment = await findAssignmentById(request.user.id, request.params.id);
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }

  const rawGroupBy = String(request.query?.groupBy || "topic").trim();
  const groupBy =
    rawGroupBy === "concept" || rawGroupBy === "errorType" || rawGroupBy === "topic"
      ? rawGroupBy
      : null;
  if (!groupBy) {
    response.status(400).json({ message: "groupBy must be one of: topic, concept, errorType." });
    return;
  }

  const limit = clampLimit(request.query?.limit, 20, 100);
  const items = await listProblemErrorSummary({
    userId: request.user.id,
    assignmentId: request.params.id,
    groupBy,
    limit,
  });
  response.json({
    scope: "assignment",
    assignmentId: request.params.id,
    groupBy,
    items,
  });
});

app.get("/api/errors/summary", requireDb, requireAuth, async (request, response) => {
  const rawGroupBy = String(request.query?.groupBy || "topic").trim();
  const groupBy =
    rawGroupBy === "concept" || rawGroupBy === "errorType" || rawGroupBy === "topic"
      ? rawGroupBy
      : null;
  if (!groupBy) {
    response.status(400).json({ message: "groupBy must be one of: topic, concept, errorType." });
    return;
  }

  const assignmentId = String(request.query?.assignmentId || "").trim();
  if (assignmentId) {
    const assignment = await findAssignmentById(request.user.id, assignmentId);
    if (!assignment) {
      response.status(404).json({ message: "Assignment not found." });
      return;
    }
  }

  const limit = clampLimit(request.query?.limit, 20, 100);
  const items = await listProblemErrorSummary({
    userId: request.user.id,
    assignmentId,
    groupBy,
    limit,
  });
  response.json({
    scope: assignmentId ? "assignment" : "user",
    assignmentId: assignmentId || null,
    groupBy,
    items,
  });
});

app.get("/api/notebooks/quiz-sessions", requireDb, requireAuth, async (request, response) => {
  const records = await listNotebookQuizSessions(request.user.id);
  response.json({ sessions: records });
});

app.get("/api/notebooks/:subjectId/quiz-session", requireDb, requireAuth, async (request, response) => {
  const record = await getNotebookQuizSession(request.user.id, request.params.subjectId);
  response.json(
    record || {
      id: `${request.user.id}:quiz:${request.params.subjectId}`,
      userId: request.user.id,
      subjectId: request.params.subjectId,
      subjectName: "",
      attempted: false,
      solved: false,
      attemptedAt: null,
      solvedAt: null,
      totalQuestions: 0,
      correctCount: 0,
      mistakeCount: 0,
      totalTimeSeconds: 0,
      updatedAt: 0,
    },
  );
});

app.patch("/api/notebooks/:subjectId/quiz-session", requireDb, requireAuth, async (request, response) => {
  const subjectName = normalizeBoundedText(request.body?.subjectName, 120);
  const attempted = request.body?.attempted === true;
  const solved = request.body?.solved === true;
  const addTimeSeconds = parseNonNegativeSeconds(request.body?.addTimeSeconds);
  const totalQuestionsRaw = request.body?.totalQuestions;
  const correctCountRaw = request.body?.correctCount;
  const mistakeCountRaw = request.body?.mistakeCount;

  if (addTimeSeconds == null) {
    response.status(400).json({ message: "addTimeSeconds must be a non-negative number." });
    return;
  }

  const numericFields = [
    ["totalQuestions", totalQuestionsRaw],
    ["correctCount", correctCountRaw],
    ["mistakeCount", mistakeCountRaw],
  ];
  for (const [label, value] of numericFields) {
    if (value == null || value === "") continue;
    if (!Number.isInteger(Number(value)) || Number(value) < 0) {
      response.status(400).json({ message: `${label} must be a non-negative integer.` });
      return;
    }
  }

  const record = await upsertNotebookQuizSession(request.user.id, request.params.subjectId, {
    subjectName,
    attempted,
    solved,
    totalQuestions: totalQuestionsRaw,
    correctCount: correctCountRaw,
    mistakeCount: mistakeCountRaw,
    addTimeSeconds,
  });
  response.json(record);
});

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
    
    // Initialize search index (non-blocking)
    initSearchIndex().catch(e => console.error("Search index initialization failed:", e));
    
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
