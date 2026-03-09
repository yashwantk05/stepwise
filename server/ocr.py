import os
import time

import requests

VISION_ENDPOINT = os.getenv("AZURE_VISION_ENDPOINT", "")
VISION_KEY = os.getenv("AZURE_VISION_KEY", "")


def require_vision_config():
    if not VISION_ENDPOINT or not VISION_KEY:
        raise RuntimeError(
            "Azure Vision is not configured. Set AZURE_VISION_ENDPOINT and AZURE_VISION_KEY."
        )

    endpoint = VISION_ENDPOINT.rstrip("/")
    return endpoint, VISION_KEY

def extract_text(image_bytes):
    endpoint, api_key = require_vision_config()

    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Content-Type": "application/octet-stream"
    }

    response = requests.post(
    endpoint + "/vision/v3.2/read/analyze",
    headers=headers,
    data=image_bytes
)

    operation_url = response.headers["Operation-Location"]

    while True:

        result = requests.get(
            operation_url,
            headers={"Ocp-Apim-Subscription-Key": api_key}
        ).json()

        if result["status"] == "succeeded":

            text = ""

            for page in result["analyzeResult"]["readResults"]:
                for line in page["lines"]:
                    text += line["text"] + "\n"

            return text

        time.sleep(1)

