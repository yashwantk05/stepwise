import base64
import os

from openai import AzureOpenAI

AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-06")
AZURE_OPENAI_MODEL = os.getenv("AZURE_OPENAI_MODEL", "gpt-4o")


def get_client():
    if not AZURE_OPENAI_API_KEY or not AZURE_OPENAI_ENDPOINT:
        raise RuntimeError(
            "Azure OpenAI is not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT."
        )

    return AzureOpenAI(
        api_key=AZURE_OPENAI_API_KEY,
        api_version=AZURE_OPENAI_API_VERSION,
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
    )


def _image_url_content_part(image_bytes, mime_type="image/png"):
    base64_image = base64.b64encode(image_bytes).decode("utf-8").replace("\n", "")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{mime_type};base64,{base64_image}"},
    }


def generate_problem_context(problem_image_bytes, mime_type="image/png"):
    """
    Build reusable context by solving the problem shown in the cropped problem image.
    """
    prompt = """
You are solving a math problem from the provided image before tutoring begins.

Tasks:
1. Read the problem carefully.
2. Solve it fully.
3. Produce reusable tutoring context for future hints.

Return exactly these sections:
Problem:
<one sentence summary>

Goal:
<what the student must find or prove>

Solved answer:
<final answer>

Key steps:
1. <step>
2. <step>
3. <step>

Pitfalls:
1. <pitfall>
2. <pitfall>

Rules:
- Be concise and precise.
- If text is unclear, say what you infer.
- ALL mathematical expressions MUST be written in LaTeX using $...$.
""".strip()

    client = get_client()
    response = client.chat.completions.create(
        model=AZURE_OPENAI_MODEL,
        temperature=0.2,
        max_completion_tokens=350,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    _image_url_content_part(problem_image_bytes, mime_type),
                ],
            }
        ],
    )
    return (response.choices[0].message.content or "").strip()


def analyze_image(
    drawing_image_bytes,
    *,
    drawing_mime_type="image/png",
    problem_context="",
    problem_image_bytes=None,
    problem_mime_type="image/png",
):
    """
    Generate a hint from the student's drawing, optionally grounded by:
    1) precomputed problem_context
    2) the cropped problem image itself
    """
    prompt = f"""
You are a strict math tutor checking a student's handwritten solution.

Stored problem context:
{problem_context or "No stored problem context is available."}

Tasks:
1. Identify the student's current work from the drawing image.
2. Compare it against the stored problem context and expected solution path.
3. Verify whether the latest visible step is valid.
4. If incorrect, explain the mistake briefly.
5. Provide the best next hint, not the full solution.

Rules:
- Prefer a minimal next-step hint.
- Never assume the student is correct.
- If the drawing is too incomplete, say what to do next.
- Explanations must be short (max 2 sentences).
- ALL mathematical expressions MUST be written in LaTeX using $...$.

Format:
Hint:
<short hint>

Correct next line:
<next mathematical line or "Not enough work shown yet.">
""".strip()

    content = [{"type": "text", "text": prompt}]
    if problem_image_bytes is not None:
        content.append({"type": "text", "text": "Reference problem image:"})
        content.append(_image_url_content_part(problem_image_bytes, problem_mime_type))

    content.append({"type": "text", "text": "Student whiteboard image:"})
    content.append(_image_url_content_part(drawing_image_bytes, drawing_mime_type))

    client = get_client()
    response = client.chat.completions.create(
        model=AZURE_OPENAI_MODEL,
        temperature=0.3,
        max_completion_tokens=220,
        messages=[{"role": "user", "content": content}],
    )
    return (response.choices[0].message.content or "").strip()
