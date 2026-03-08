import base64
import os

from openai import AzureOpenAI

AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01")
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


def analyze_image(image_bytes):

    base64_image = base64.b64encode(image_bytes).decode("utf-8")

    prompt = """
You are a strict math tutor checking a student's handwritten algebra solution.

Look carefully at the image and determine the student's steps.

Steps:
1. Identify the equations written by the student.
2. Verify whether the transformation between steps is mathematically valid.
3. If incorrect, explain the mistake.
4. Provide the correct next step.

Rules:
- Always verify the algebra.
- Never assume the student is correct.
- Explanations must be short (max 2 sentences).
- ALL mathematical expressions MUST be written in LaTeX using $...$.

Example format:

Hint:
The subtraction step is correct, but the next equation is wrong.

Correct next line:
$n = \frac{5}{5} = 1$
"""

    client = get_client()

    response = client.chat.completions.create(
        model=AZURE_OPENAI_MODEL,
        temperature=0.3,
        max_tokens=200,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}"
                        }
                    }
                ],
            }
        ],
    )

    return response.choices[0].message.content
