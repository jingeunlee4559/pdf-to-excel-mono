from __future__ import annotations

import logging
import os
from pathlib import Path


def load_env_file() -> None:
    """ai-server/.env를 직접 로드한다. python-dotenv 없이 동작한다."""
    current_file = Path(__file__).resolve()
    candidates = [
        Path.cwd() / ".env",
        current_file.parent / ".env",
        current_file.parents[1] / ".env",
        current_file.parents[2] / ".env",
    ]

    env_path = next((path for path in candidates if path.exists()), None)
    if env_path is None:
        print("[ENV] .env file not found")
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

    print(f"[ENV] loaded: {env_path}")


load_env_file()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.services.llm_client import llm_status

app = FastAPI(title="Document Automation AI Server Lite", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "ai-server-lite",
        "ocr": True,
        "ocrMode": "PP-Structure/PaddleOCR fallback",
        "llm": llm_status(),
        "imageLlmEnabled": False,
    }


app.include_router(router, prefix="/api")
