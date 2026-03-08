export async function analyzeDrawing(blob) {
  const formData = new FormData();
  formData.append("file", blob, "drawing.png");

  const endpoint = import.meta.env.VITE_AI_ANALYZE_URL || "http://localhost:8000/analyze";

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    return { result: "Server error. Try again." };
  }

  return response.json();
}
