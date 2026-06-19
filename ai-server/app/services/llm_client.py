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


def get_llm_config() -> LlmConfig:
    return LlmConfig(
        enabled=_env_bool("LLM_ENABLED", True),
        provider=os.getenv("LLM_PROVIDER", "ollama").strip().lower(),
        base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
        model=os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0")),
        top_p=float(os.getenv("LLM_TOP_P", "0.2")),
        timeout_seconds=int(os.getenv("LLM_TIMEOUT_SECONDS", "120")),
        context_chars=int(os.getenv("LLM_CONTEXT_CHARS", "18000")),
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
    }


def extract_json_object(text: str) -> Dict[str, Any]:
    if not text:
        raise ValueError("LLM 응답이 비어 있습니다.")

    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


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
        },
    }
    req = urllib.request.Request(
        url=f"{cfg.base_url}/api/generate",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_seconds) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama 연결 실패: {cfg.base_url} / {exc}") from exc

    response = data.get("response") or ""
    parsed = extract_json_object(response)
    parsed.setdefault("_llm", {})
    parsed["_llm"].update({
        "provider": cfg.provider,
        "model": cfg.model,
        "done": data.get("done", True),
        "total_duration": data.get("total_duration"),
        "eval_count": data.get("eval_count"),
    })
    return parsed


async def call_local_llm_json(prompt: str, cfg: Optional[LlmConfig] = None) -> Dict[str, Any]:
    cfg = cfg or get_llm_config()
    if not cfg.enabled:
        raise RuntimeError("LLM_ENABLED=false 상태입니다.")
    return await asyncio.to_thread(_call_ollama_sync, prompt, cfg)
