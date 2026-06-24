from __future__ import annotations

import io
import re
import time
from typing import Any, Callable, Dict, List, Tuple

from app.services.document_analyzer.table_utils import (
    _env_bool,
    _env_int,
    rows_to_table,
)

# ---------------------------------------------------------------------------
# Globals for engine singletons
# ---------------------------------------------------------------------------

PADDLE_OCR_ENGINE = None
PADDLE_STRUCTURE_ENGINE = None


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _ocr_enabled() -> bool:
    return _env_bool("OCR_ENABLED", True)


def _ocr_lang() -> str:
    import os
    return os.getenv("OCR_LANG", "korean").strip() or "korean"


def _ocr_dpi() -> int:
    return max(_env_int("OCR_DPI", 160), 96)


def _ocr_max_pages(total_pages: int) -> int:
    limit = _env_int("OCR_MAX_PAGES", 10)
    if limit <= 0:
        return total_pages
    return min(total_pages, limit)


def _ocr_min_text_chars() -> int:
    return max(_env_int("OCR_MIN_TEXT_CHARS", 80), 0)


# ---------------------------------------------------------------------------
# Engine initialisation
# ---------------------------------------------------------------------------

def _get_paddle_ocr_engine():
    global PADDLE_OCR_ENGINE
    if PADDLE_OCR_ENGINE is not None:
        return PADDLE_OCR_ENGINE
    from paddleocr import PaddleOCR
    try:
        PADDLE_OCR_ENGINE = PaddleOCR(use_angle_cls=True, lang=_ocr_lang(), show_log=False)
    except TypeError:
        PADDLE_OCR_ENGINE = PaddleOCR(lang=_ocr_lang())
    return PADDLE_OCR_ENGINE


def _get_pp_structure_engine():
    global PADDLE_STRUCTURE_ENGINE
    if PADDLE_STRUCTURE_ENGINE is not None:
        return PADDLE_STRUCTURE_ENGINE
    from paddleocr import PPStructure
    try:
        PADDLE_STRUCTURE_ENGINE = PPStructure(show_log=False, lang=_ocr_lang())
    except TypeError:
        PADDLE_STRUCTURE_ENGINE = PPStructure(lang=_ocr_lang())
    return PADDLE_STRUCTURE_ENGINE


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def _image_bytes_to_numpy(image_bytes: bytes):
    from PIL import Image
    import numpy as np

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(image)


def _render_pdf_page_to_png(content: bytes, page_index: int, dpi: int) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=content, filetype="pdf")
    page = doc.load_page(page_index)
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")


# ---------------------------------------------------------------------------
# PaddleOCR result flattening
# ---------------------------------------------------------------------------

def _flatten_paddle_ocr_result(result: Any) -> List[Tuple[str, float]]:
    """PaddleOCR 2.x/3.x 응답 차이를 최대한 흡수해 (text, score) 목록으로 변환한다."""
    pairs: List[Tuple[str, float]] = []

    def walk(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, dict):
            text = node.get("text") or node.get("rec_text") or node.get("transcription")
            score = node.get("score") or node.get("confidence") or node.get("rec_score") or 0
            if text:
                try:
                    pairs.append((str(text), float(score or 0)))
                except Exception:
                    pairs.append((str(text), 0.0))
            for value in node.values():
                if isinstance(value, (list, tuple, dict)):
                    walk(value)
            return
        if isinstance(node, (list, tuple)):
            if len(node) >= 2 and isinstance(node[1], (list, tuple)) and len(node[1]) >= 1 and isinstance(node[1][0], str):
                text = node[1][0]
                score = node[1][1] if len(node[1]) > 1 else 0
                try:
                    pairs.append((str(text), float(score or 0)))
                except Exception:
                    pairs.append((str(text), 0.0))
                return
            for item in node:
                walk(item)

    walk(result)
    seen = set()
    deduped: List[Tuple[str, float]] = []
    for text, score in pairs:
        clean = re.sub(r"\s+", " ", text).strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        deduped.append((clean, score))
    return deduped


def _html_table_to_rows(html: str) -> List[Dict[str, Any]]:
    if not html:
        return []
    table_rows: List[List[str]] = []
    tr_matches = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.I | re.S)
    for tr in tr_matches:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.I | re.S)
        cleaned = []
        for cell in cells:
            value = re.sub(r"<[^>]+>", " ", cell)
            value = re.sub(r"\s+", " ", value).strip()
            cleaned.append(value)
        if any(cleaned):
            table_rows.append(cleaned)
    return rows_to_table(table_rows)


# ---------------------------------------------------------------------------
# PP-Structure rows
# ---------------------------------------------------------------------------

def _extract_pp_structure_rows(image_np: Any, log: Callable[..., None] | None = None, filename: str = "") -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not _env_bool("OCR_USE_PP_STRUCTURE", True):
        return [], {"enabled": False, "reason": "OCR_USE_PP_STRUCTURE=false"}
    try:
        engine = _get_pp_structure_engine()
        result = engine(image_np)
    except Exception as exc:
        if log:
            log("warning", "PP-Structure failed", filename=filename, error=str(exc))
        return [], {"enabled": True, "engine": "PP-Structure", "error": str(exc), "rowCount": 0}

    rows: List[Dict[str, Any]] = []
    block_count = 0
    for block in result or []:
        block_count += 1
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "").lower()
        res = block.get("res")
        html = ""
        if isinstance(res, dict):
            html = str(res.get("html") or res.get("html_table") or "")
        elif isinstance(res, str):
            html = res
        if "table" in block_type or "<table" in html.lower():
            rows.extend(_html_table_to_rows(html))
    return rows, {"enabled": True, "engine": "PP-Structure", "blockCount": block_count, "rowCount": len(rows)}


# ---------------------------------------------------------------------------
# read_image_with_ocr
# ---------------------------------------------------------------------------

def read_image_with_ocr(
    content: bytes,
    filename: str = "",
    page_label: str | int | None = None,
    log: Callable[..., None] | None = None,
) -> Tuple[str, List[Dict[str, Any]], Dict[str, Any]]:
    """이미지 1장을 PP-Structure/PaddleOCR로 처리한다."""
    if not _ocr_enabled():
        return "", [], {"enabled": False, "ocrUsed": False, "reason": "OCR_ENABLED=false"}

    started = time.perf_counter()
    try:
        image_np = _image_bytes_to_numpy(content)
    except Exception as exc:
        if log:
            log("warning", "OCR image decode failed", filename=filename, page=page_label, error=str(exc))
        return "", [], {"enabled": True, "ocrUsed": False, "engine": "PIL", "error": str(exc)}

    rows: List[Dict[str, Any]] = []
    structure_metrics: Dict[str, Any] = {"enabled": False}
    if _env_bool("OCR_USE_PP_STRUCTURE", True):
        rows, structure_metrics = _extract_pp_structure_rows(image_np, log=log, filename=filename)

    try:
        ocr = _get_paddle_ocr_engine()
        if hasattr(ocr, "ocr"):
            result = ocr.ocr(image_np, cls=True)
        elif hasattr(ocr, "predict"):
            result = ocr.predict(image_np)
        else:
            raise RuntimeError("PaddleOCR engine has neither ocr() nor predict().")
        pairs = _flatten_paddle_ocr_result(result)
        text = "\n".join(t for t, _ in pairs)
        avg_conf = round(sum(score for _, score in pairs) / len(pairs), 4) if pairs else 0.0
    except Exception as exc:
        if log:
            log("warning", "PaddleOCR text extraction failed", filename=filename, page=page_label, error=str(exc))
        return "", rows, {
            "enabled": True,
            "ocrUsed": bool(rows),
            "engine": "PaddleOCR",
            "structure": structure_metrics,
            "error": str(exc),
            "rowCount": len(rows),
        }

    if not rows:
        # Lazy import to avoid circular at module load
        from app.services.document_analyzer.file_parser import infer_rows_from_text
        rows = infer_rows_from_text(text, filename or "ocr-image")

    elapsed = round(time.perf_counter() - started, 3)
    if log:
        log("info", "OCR image parse finish", filename=filename, page=page_label, chars=len(text), rows=len(rows), confidence=avg_conf, elapsed_sec=elapsed)
    return text, rows, {
        "enabled": True,
        "ocrUsed": True,
        "engine": "PP-Structure/PaddleOCR" if structure_metrics.get("enabled") else "PaddleOCR",
        "structure": structure_metrics,
        "charCount": len(text),
        "rowCount": len(rows),
        "confidence": avg_conf,
        "elapsedSec": elapsed,
    }


# ---------------------------------------------------------------------------
# PDF OCR fallback
# ---------------------------------------------------------------------------

def _read_pdf_with_ocr_fallback(
    content: bytes,
    filename: str = "",
    page_count: int | None = None,
    log: Callable[..., None] | None = None,
) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    if not _ocr_enabled():
        return "", [], [], {"enabled": False, "ocrUsed": False, "reason": "OCR_ENABLED=false"}

    started = time.perf_counter()
    try:
        import fitz  # noqa: F401
    except Exception as exc:
        if log:
            log("warning", "PDF OCR skipped", filename=filename, reason="PyMuPDF import failed", error=str(exc))
        return "", [], [], {"enabled": True, "ocrUsed": False, "error": str(exc)}

    if page_count is None:
        try:
            import fitz
            doc = fitz.open(stream=content, filetype="pdf")
            page_count = int(doc.page_count or 0)
        except Exception:
            page_count = 0

    pages_to_ocr = _ocr_max_pages(int(page_count or 0))
    dpi = _ocr_dpi()
    text_parts: List[str] = []
    all_rows: List[Dict[str, Any]] = []
    page_meta: List[Dict[str, Any]] = []

    if log:
        log("info", "PDF OCR fallback start", filename=filename, engine="PP-Structure/PaddleOCR", page_count=page_count, pages_to_ocr=pages_to_ocr, dpi=dpi)

    try:
        import fitz
        doc = fitz.open(stream=content, filetype="pdf")
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
    except Exception as exc:
        if log:
            log("warning", "PDF OCR render open failed", filename=filename, error=str(exc))
        return "", [], [], {"enabled": True, "ocrUsed": False, "engine": "PP-Structure/PaddleOCR", "error": str(exc)}

    for idx in range(pages_to_ocr):
        try:
            page = doc.load_page(idx)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            png = pix.tobytes("png")
            page_text, page_rows, metrics = read_image_with_ocr(png, filename=filename, page_label=idx + 1, log=log)
        except Exception as exc:
            page_text, page_rows, metrics = "", [], {"ocrUsed": False, "error": str(exc)}
        text_parts.append(f"[page {idx + 1} / {page_count} OCR]\n{page_text}".rstrip())
        all_rows.extend(page_rows)
        page_meta.append({
            "page": idx + 1,
            "pageCount": page_count,
            "engine": "PP-Structure/PaddleOCR",
            "status": "OCR_EXTRACTED" if page_text.strip() or page_rows else "OCR_EMPTY",
            "charCount": len(page_text),
            "rowCount": len(page_rows),
            "metrics": metrics,
        })

    elapsed = round(time.perf_counter() - started, 3)
    metrics = {
        "enabled": True,
        "ocrUsed": True,
        "engine": "PP-Structure/PaddleOCR",
        "pageCount": page_count,
        "pagesRead": pages_to_ocr,
        "charCount": sum(len(part) for part in text_parts),
        "rowCount": len(all_rows),
        "dpi": dpi,
        "elapsedSec": elapsed,
        "truncatedByLimit": bool(page_count and page_count > pages_to_ocr),
    }
    if log:
        log("info", "PDF OCR fallback finish", filename=filename, pages_ocr=pages_to_ocr, chars=metrics["charCount"], rows=len(all_rows), elapsed_sec=elapsed)
    return "\n\n".join(text_parts), all_rows, page_meta, metrics
