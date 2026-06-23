from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class LlmConfig:
    enabled: bool
    provider: str
    base_url: str
    model: str
    temperature: float
    top_p: float
    timeout_seconds: int
    context_chars: int
    use_mode: str


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "y", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(str(raw).strip())
    except ValueError:
        return default


def get_llm_config() -> LlmConfig:
    """로컬 qwen2.5:7b 전용 설정.

    이미지 LLM은 사용하지 않는다. PDF/이미지 해석은 PyMuPDF, pdfplumber,
    PP-Structure/PaddleOCR에서 끝내고 LLM은 텍스트/표 후보를 JSON으로 정리하는 역할만 한다.
    """
    provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:7b").strip() or "qwen2.5:7b"
    if model != "qwen2.5:7b":
        # 운영 혼선을 막기 위해 현재 프로젝트 기본은 qwen2.5:7b로 고정한다.
        model = "qwen2.5:7b"
    return LlmConfig(
        enabled=_env_bool("LLM_ENABLED", True),
        provider=provider,
        base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
        model=model,
        temperature=_env_float("LLM_TEMPERATURE", 0.0),
        top_p=_env_float("LLM_TOP_P", 0.2),
        timeout_seconds=_env_int("LLM_TIMEOUT_SECONDS", 120),
        context_chars=_env_int("LLM_CONTEXT_CHARS", 18000),
        use_mode=os.getenv("LLM_USE_MODE", "auto").strip().lower(),
    )


def llm_status() -> Dict[str, Any]:
    cfg = get_llm_config()
    return {
        "enabled": cfg.enabled,
        "provider": cfg.provider,
        "baseUrl": cfg.base_url,
        "model": cfg.model,
        "useMode": cfg.use_mode,
        "contextChars": cfg.context_chars,
        "timeoutSeconds": cfg.timeout_seconds,
        "numCtx": _env_int("LLM_NUM_CTX", 8192),
        "imageLlmEnabled": False,
    }


def _quote_unquoted_json_keys(value: str) -> str:
    # qwen 계열이 {documentType: "..."}처럼 key 따옴표를 빠뜨리는 경우를 보정한다.
    return re.sub(r'([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)', r'\1"\2"\3', value)


def _strip_trailing_commas(value: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", value)


def extract_json_object(text: str) -> Dict[str, Any]:
    if not text:
        raise ValueError("LLM 응답이 비어 있습니다.")

    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    candidates = [cleaned]
    start_obj = cleaned.find("{")
    end_obj = cleaned.rfind("}")
    if start_obj >= 0 and end_obj > start_obj:
        candidates.append(cleaned[start_obj : end_obj + 1])
    start_arr = cleaned.find("[")
    end_arr = cleaned.rfind("]")
    if start_arr >= 0 and end_arr > start_arr:
        candidates.append(cleaned[start_arr : end_arr + 1])

    last_error: Exception | None = None
    normalized_candidates: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        normalized_candidates.append(candidate)
        normalized_candidates.append(_strip_trailing_commas(candidate))
        normalized_candidates.append(_quote_unquoted_json_keys(_strip_trailing_commas(candidate)))
        # Python dict처럼 single quote를 쓴 경우의 보수적 복구.
        if "'" in candidate and '"' not in candidate[:80]:
            normalized_candidates.append(_quote_unquoted_json_keys(_strip_trailing_commas(candidate.replace("'", '"'))))

    seen = set()
    for candidate in normalized_candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list):
                return {"items": parsed}
        except Exception as exc:  # noqa: BLE001 - 복구 후보를 순차적으로 시도해야 한다.
            last_error = exc

    preview = cleaned[:300].replace("\n", " ")
    raise ValueError(f"LLM JSON 파싱 실패: {last_error}. response_preview={preview}")


def _post_json_sync(url: str, payload: Dict[str, Any], timeout_seconds: int) -> Dict[str, Any]:
    req = urllib.request.Request(
        url=url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama 연결 실패: {url} / {exc}") from exc


def _call_ollama_sync(prompt: str, cfg: LlmConfig) -> Dict[str, Any]:
    if cfg.provider != "ollama":
        raise RuntimeError(f"현재 로컬 개발 모드는 provider=ollama만 지원합니다. provider={cfg.provider}")

    payload = {
        "model": cfg.model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": cfg.temperature,
            "top_p": cfg.top_p,
            "num_ctx": _env_int("LLM_NUM_CTX", 8192),
            "num_predict": _env_int("LLM_NUM_PREDICT", 1024),
        },
        "keep_alive": "10m",
    }

    data = _post_json_sync(
        url=f"{cfg.base_url}/api/generate",
        payload=payload,
        timeout_seconds=cfg.timeout_seconds,
    )

    response = data.get("response") or ""
    parsed = extract_json_object(response)
    parsed.setdefault("_llm", {})
    parsed["_llm"].update({
        "provider": cfg.provider,
        "model": cfg.model,
        "done": data.get("done", True),
        "total_duration": data.get("total_duration"),
        "eval_count": data.get("eval_count"),
        "imageLlm": False,
    })
    return parsed


async def call_local_llm_json(prompt: str, cfg: Optional[LlmConfig] = None) -> Dict[str, Any]:
    cfg = cfg or get_llm_config()
    if not cfg.enabled:
        raise RuntimeError("LLM_ENABLED=false 상태입니다.")
    return await asyncio.to_thread(_call_ollama_sync, prompt, cfg)
