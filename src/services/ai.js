const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const normalizeFlag = (value) => String(value || "").trim().toLowerCase();
const isLocalHost = () =>
  ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  if (bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes") return true;
  if (bypassFlag === "false" || bypassFlag === "0" || bypassFlag === "no") return false;
  return import.meta.env.DEV && isLocalHost();
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

export async function analyzeDrawing(blob) {
  const formData = new FormData();
  formData.append("file", blob, "drawing.png");

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
