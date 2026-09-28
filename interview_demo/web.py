from __future__ import annotations

import os
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .plan import public_config


load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = PROJECT_ROOT / "static"

app = FastAPI(title="Dialt interview demo")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def config() -> dict:
    return public_config()


@app.get("/api/health")
async def health() -> dict[str, bool]:
    return {"ok": True, "configured": bool(os.getenv("CONVERSE_API_KEY", "").strip())}


@app.post("/api/session")
async def create_session() -> dict:
    api_key = os.getenv("CONVERSE_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="CONVERSE_API_KEY is not configured on the server.",
        )

    base_url = os.getenv("CONVERSE_API_BASE_URL", "https://api.dialt.com").rstrip("/")
    session_id = f"short-interview-{uuid.uuid4().hex[:16]}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{base_url}/v1/session-keys",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"session_id": session_id},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not reach the Dialt credential service.",
        ) from exc

    if response.is_error:
        try:
            upstream_detail = response.json().get("error") or response.json().get("detail")
        except ValueError:
            upstream_detail = None
        raise HTTPException(
            status_code=response.status_code,
            detail=str(upstream_detail or "Dialt rejected the session credential request."),
        )
    return response.json()
