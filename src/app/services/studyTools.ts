const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const normalizeFlag = (value: unknown) => String(value || "").trim().toLowerCase();

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  return bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes";
};

const buildDevHeaders = () => {
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
