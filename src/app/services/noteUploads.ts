import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

GlobalWorkerOptions.workerSrc = pdfWorker;

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

export const fileNameToTitle = (fileName: string) =>
  String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "Imported Note";

export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str || "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      pageTexts.push(text);
    }
  }

  return pageTexts.join("\n\n");
}

export async function extractImageText(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, file.name || "note-image.png");

  const response = await fetch(`${API_BASE}/notes/extract-image-text`, {
    method: "POST",
    credentials: "include",
    headers: buildDevHeaders(),
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.message || "Unable to read text from image."));
  }

  return String(payload?.text || "").trim();
}
