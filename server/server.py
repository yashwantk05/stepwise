from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

from ai import analyze_image

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "StepWise backend running"}


@app.post("/analyze")
async def analyze(file: UploadFile):

    try:
        image = await file.read()

        print("Image received:", len(image))

        hint = analyze_image(image)

        print("GPT hint:", hint)

        return {"result": hint}

    except Exception as e:

        print("SERVER ERROR:", e)

        return {"result": "AI tutor temporarily unavailable."}