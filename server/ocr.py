import requests
import time
import os
VISION_ENDPOINT = "https://ai-vision00.cognitiveservices.azure.com/"
VISION_KEY = "1rOUALmQmxXjkkfN5iVI9ir7cgcGfMZG4lWgqGkrrMB5Kxi26VHOJQQJ99CCACGhslBXJ3w3AAAFACOGMbLc"

def extract_text(image_bytes):

    headers = {
        "Ocp-Apim-Subscription-Key": VISION_KEY,
        "Content-Type": "application/octet-stream"
    }

    response = requests.post(
    VISION_ENDPOINT + "vision/v3.2/read/analyze",
    headers=headers,
    data=image_bytes
)

    operation_url = response.headers["Operation-Location"]

    while True:

        result = requests.get(
            operation_url,
            headers={"Ocp-Apim-Subscription-Key": VISION_KEY}
        ).json()

        if result["status"] == "succeeded":

            text = ""

            for page in result["analyzeResult"]["readResults"]:
                for line in page["lines"]:
                    text += line["text"] + "\n"

            return text

        time.sleep(1)

