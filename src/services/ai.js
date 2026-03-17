const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const normalizeFlag = (value) => String(value || "").trim().toLowerCase();

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  return bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes";
};

const buildDevHeaders = () => {
  if (!canUseDevBypass()) return {};

  return {
    "x-stepwise-user-id": String(import.meta.env.VITE_DEV_USER_ID || "local-dev-user"),
    "x-stepwise-user-name": String(import.meta.env.VITE_DEV_USER_NAME || "Local Developer"),
    "x-stepwise-user-email": String(
      import.meta.env.VITE_DEV_USER_EMAIL || "local-dev@stepwise.local",
    ),
    "x-stepwise-user-provider": "local-dev",
  };
};

export const isDebugImagesEnabled = () =>
  ["true", "1", "yes"].includes(normalizeFlag(import.meta.env.VITE_DEBUG_AI_IMAGES));

export const debugEchoImage = async (blob, label) => {
  const formData = new FormData();
  formData.append("file", blob, `${label || "debug"}.png`);

  const response = await fetch(`${API_BASE}/debug/echo-image?label=${encodeURIComponent(label)}`, {
    method: "POST",
    credentials: "include",
    headers: buildDevHeaders(),
    body: formData,
  });

  // Intentionally ignore the body; the goal is a DevTools Network entry with an image Preview.
  if (!response.ok) {
    throw new Error("Debug echo failed.");
  }
};

export async function analyzeDrawing(
  blob,
  { assignmentId, problemIndex, mode, hintLevel, previousHints} = {},
) {
  if (isDebugImagesEnabled()) {
    const label = `gpt-analyze-${String(mode || "hint").toLowerCase()}-drawing`;
    void debugEchoImage(blob, label).catch(() => {});
  }

  const formData = new FormData();
  formData.append("file", blob, "drawing.png");
  if (assignmentId) {
    formData.append("assignmentId", assignmentId);
  }
  if (Number.isInteger(problemIndex)) {
    formData.append("problemIndex", String(problemIndex));
  }
  if (mode) {
    formData.append("mode", String(mode));
  }
  if (Number.isInteger(hintLevel)) {
    formData.append("hintLevel", String(hintLevel));
  }
  if (Array.isArray(previousHints) && previousHints.length > 0) {
    formData.append("previousHints", JSON.stringify(previousHints));
  }
  const endpoint = import.meta.env.VITE_AI_ANALYZE_URL || `${API_BASE}/ai/analyze`;

  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: buildDevHeaders(),
    body: formData,
  });

  if (!response.ok) {
    return { result: "Server error. Try again." };
  }

  return response.json();
}
