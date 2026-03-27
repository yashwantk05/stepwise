import base64
import os
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv()

API_VERSION = os.getenv("AZURE_CONTENT_SAFETY_API_VERSION", "2024-09-01")
DEFAULT_BLOCK_SEVERITY = int(os.getenv("AZURE_CONTENT_SAFETY_BLOCK_SEVERITY", "4") or "4")
DEFAULT_REVIEW_SEVERITY = int(os.getenv("AZURE_CONTENT_SAFETY_REVIEW_SEVERITY", "2") or "2")

app = FastAPI(title="StepWise Content Safety Service")


class TextModerationRequest(BaseModel):
    text: str = ""
    context: str = "general"
    blockSeverity: int | None = Field(default=None, ge=0, le=6)
    reviewSeverity: int | None = Field(default=None, ge=0, le=6)


class ImageModerationRequest(BaseModel):
    imageBase64: str
    mimeType: str = "image/png"
    context: str = "general"
    blockSeverity: int | None = Field(default=None, ge=0, le=6)
    reviewSeverity: int | None = Field(default=None, ge=0, le=6)


def _read_env(name: str) -> str:
    return str(os.getenv(name, "")).strip()


def _get_config() -> tuple[str, str]:
    endpoint = _read_env("AZURE_CONTENT_SAFETY_ENDPOINT").rstrip("/")
    key = _read_env("AZURE_CONTENT_SAFETY_KEY")
    if not endpoint or not key:
        missing = []
        if not endpoint:
            missing.append("AZURE_CONTENT_SAFETY_ENDPOINT")
        if not key:
            missing.append("AZURE_CONTENT_SAFETY_KEY")
        raise HTTPException(
            status_code=503,
            detail=f"Azure Content Safety is not configured. Missing: {', '.join(missing)}",
        )
    return endpoint, key


def _request_content_safety(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    endpoint, key = _get_config()
    response = requests.post(
        f"{endpoint}{path}?api-version={API_VERSION}",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )

    if not response.ok:
        detail = ""
        try:
            detail = response.json().get("error", {}).get("message", "")
        except Exception:
            detail = response.text
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Azure Content Safety request failed. {str(detail).strip()}".strip(),
        )

    return response.json()


def _normalize_categories(raw_categories: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = []
    for item in raw_categories or []:
        category = str(item.get("category", "")).strip()
        severity = int(item.get("severity", 0) or 0)
        if not category:
            continue
        normalized.append({"category": category, "severity": severity})
    return normalized


def _decide_action(
    categories: list[dict[str, Any]],
    *,
    block_severity: int,
    review_severity: int,
) -> tuple[str, list[str]]:
    reasons = []
    action = "allow"
    for item in categories:
        category = str(item.get("category", "")).strip()
        severity = int(item.get("severity", 0) or 0)
        if severity >= block_severity:
            action = "block"
            reasons.append(f"{category}:{severity}")
        elif action != "block" and severity >= review_severity:
            action = "review"
            reasons.append(f"{category}:{severity}")
    return action, reasons


@app.get("/health")
def healthcheck():
    return {"ok": True, "apiVersion": API_VERSION}


@app.post("/moderate/text")
def moderate_text(payload: TextModerationRequest):
    text = str(payload.text or "").strip()
    if not text:
        return {
            "action": "allow",
            "context": payload.context,
            "categories": [],
            "reasonCodes": [],
        }

    block_severity = payload.blockSeverity if payload.blockSeverity is not None else DEFAULT_BLOCK_SEVERITY
    review_severity = payload.reviewSeverity if payload.reviewSeverity is not None else DEFAULT_REVIEW_SEVERITY
    result = _request_content_safety(
        "/contentsafety/text:analyze",
        {
            "text": text,
        },
    )
    categories = _normalize_categories(result.get("categoriesAnalysis"))
    action, reason_codes = _decide_action(
        categories,
        block_severity=block_severity,
        review_severity=review_severity,
    )
    return {
        "action": action,
        "context": payload.context,
        "categories": categories,
        "reasonCodes": reason_codes,
    }


@app.post("/moderate/image")
def moderate_image(payload: ImageModerationRequest):
    block_severity = payload.blockSeverity if payload.blockSeverity is not None else DEFAULT_BLOCK_SEVERITY
    review_severity = payload.reviewSeverity if payload.reviewSeverity is not None else DEFAULT_REVIEW_SEVERITY
    try:
        image_bytes = base64.b64decode(payload.imageBase64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image payload.") from exc

    result = _request_content_safety(
        "/contentsafety/image:analyze",
        {
            "image": {
                "content": base64.b64encode(image_bytes).decode("utf-8"),
            },
        },
    )
    categories = _normalize_categories(result.get("categoriesAnalysis"))
    action, reason_codes = _decide_action(
        categories,
        block_severity=block_severity,
        review_severity=review_severity,
    )
    return {
        "action": action,
        "context": payload.context,
        "mimeType": payload.mimeType,
        "categories": categories,
        "reasonCodes": reason_codes,
    }
