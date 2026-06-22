from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from fastapi import UploadFile

BASE_DIR = Path(__file__).resolve().parents[1]
STORAGE_DIR = Path(os.getenv("AI_STORAGE_DIR", BASE_DIR / "storage")).resolve()

ALLOWED_UPLOAD_TYPES = {"documents", "templates", "temp"}


def ensure_storage() -> None:
    for name in ALLOWED_UPLOAD_TYPES:
        (STORAGE_DIR / name).mkdir(parents=True, exist_ok=True)


def _score_korean_filename(text: str) -> int:
    hangul = len(re.findall(r"[가-힣]", text or ""))
    mojibake = len(re.findall(r"[ÃÂêëìíðÐ�]", text or ""))
    return hangul * 3 - mojibake * 5


def repair_mojibake_filename(filename: str | None) -> str:
    raw = str(filename or "upload.bin").replace("\r", " ").replace("\n", " ").strip() or "upload.bin"
    candidates = [raw]
    for src_enc, dst_enc in (("latin1", "utf-8"), ("cp1252", "utf-8")):
        try:
            repaired = raw.encode(src_enc, errors="strict").decode(dst_enc, errors="strict")
            candidates.append(repaired)
        except Exception:
            pass
    best = max(candidates, key=_score_korean_filename)
    return re.sub(r"\s+", " ", best).strip() or "upload.bin"


def safe_filename(filename: str | None) -> str:
    raw = repair_mojibake_filename(filename)
    name = Path(raw).name
    stem = Path(name).stem
    suffix = Path(name).suffix.lower()
    safe_stem = re.sub(r"[^0-9a-zA-Z가-힣_.-]+", "_", stem).strip("._") or "upload"
    return f"{safe_stem[:80]}{suffix[:16]}"


async def save_upload_file(upload_file: UploadFile, upload_type: str = "documents") -> dict:
    ensure_storage()
    normalized_type = upload_type if upload_type in ALLOWED_UPLOAD_TYPES else "documents"
    original_name = repair_mojibake_filename(upload_file.filename)
    safe_name = safe_filename(original_name)
    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    target_path = (STORAGE_DIR / normalized_type / stored_name).resolve()

    with target_path.open("wb") as f:
        while True:
            chunk = await upload_file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    size = target_path.stat().st_size
    return {
        "originalName": original_name,
        "original_name": original_name,
        "storedName": stored_name,
        "stored_name": stored_name,
        "filePath": str(target_path),
        "file_path": str(target_path),
        "savedPath": str(target_path),
        "saved_path": str(target_path),
        "fileType": target_path.suffix.lower().replace(".", ""),
        "file_type": target_path.suffix.lower().replace(".", ""),
        "mimeType": upload_file.content_type or "application/octet-stream",
        "mime_type": upload_file.content_type or "application/octet-stream",
        "fileSize": size,
        "file_size": size,
        "uploadType": normalized_type,
    }


def validate_storage_path(file_path: str) -> Path:
    ensure_storage()
    target = Path(file_path).resolve()
    storage_root = STORAGE_DIR.resolve()
    if storage_root not in target.parents and target != storage_root:
        raise FileNotFoundError("허용되지 않은 파일 경로입니다.")
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {file_path}")
    return target
