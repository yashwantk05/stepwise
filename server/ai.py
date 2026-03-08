from openai import AzureOpenAI
import base64
import os
client = AzureOpenAI(
    api_key="GEvGCJR1tzS4VLPB45kCfJCQafpdJAmovA5IGdokC7OSwD5I8x1zJQQJ99CCACYeBjFXJ3w3AAABACOG3FcB",
    api_version="2024-02-01",
    azure_endpoint="https://ai-model00.services.ai.azure.com/"
)

MODEL = "gpt-4o"


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

    response = client.chat.completions.create(
        model=MODEL,
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