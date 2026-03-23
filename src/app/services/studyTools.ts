const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const normalizeFlag = (value: unknown) => String(value || "").trim().toLowerCase();

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  return bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes";
};

const buildDevHeaders = (): Record<string, string> => {
  if (!canUseDevBypass()) return {};

  return {
    "x-stepwise-user-id": String(import.meta.env.VITE_DEV_USER_ID || "local-dev-user"),
    "x-stepwise-user-name": String(import.meta.env.VITE_DEV_USER_NAME || "Local Developer"),
    "x-stepwise-user-email": String(import.meta.env.VITE_DEV_USER_EMAIL || "local-dev@stepwise.local"),
    "x-stepwise-user-provider": "local-dev",
  };
};

export type StudyToolType = "flashcards" | "quiz" | "revision-sheet" | "mind-map";

interface NoteInput {
  title: string;
  content: string;
}

export async function generateStudyTool(
  tool: StudyToolType,
  subject: string,
  notes: NoteInput[],
) {
  const response = await fetch(`${API_BASE}/notes/study-tools`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...buildDevHeaders(),
    },
    body: JSON.stringify({
      tool,
      subject,
      notes,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.message || "Unable to generate study material."));
  }

  return payload;
}

export async function sendSocraticChat(
  message: string,
  history: { role: string; text: string }[],
  options?: {
    subjectId?: string;
    classLevel?: number;
    context?: { topic?: string; concept?: string; errorType?: string };
    audioBase64?: string;
    images?: { base64: string; mimeType: string }[];
  }
) {
  const response = await fetch(`${API_BASE}/socratic/chat`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...buildDevHeaders(),
    },
    body: JSON.stringify({
      message,
      history,
      ...options,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.message || "Failed to get tutor reply."));
  }

  return payload as { reply: string; usedNotes: boolean; usedNoteImages: boolean };
}

export async function getSpeechToken(): Promise<{ token: string; region: string }> {
  const response = await fetch(`${API_BASE}/speech/token`, {
    method: "GET",
    credentials: "include",
    headers: { ...buildDevHeaders() },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.message || "Speech token unavailable."));
  }
  return payload;
}
