"""LLM 팩토리 및 단일 진입점.

``LLM_PROVIDER`` 환경변수로 gemini(기본) 또는 openai를 선택한다.
기존 코드가 사용하는 ``call_llm_json`` / ``get_llm_config`` / ``llm_status`` 인터페이스를
하위 호환성을 유지하며 그대로 제공한다.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from .base_client import BaseLLMClient


# ---------------------------------------------------------------------------
# LlmConfig: 기존 코드가 dataclass로 직접 사용하는 경우를 위해 유지한다.
# ---------------------------------------------------------------------------

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


@dataclass(frozen=True)
class LlmConfig:
    enabled: bool
    provider: str
    model: str
    temperature: float
    top_p: float
    timeout_seconds: int
    context_chars: int
    use_mode: str
    max_output_tokens: int
    api_key: str
    thinking_budget: int


def get_llm_config() -> LlmConfig:
    """현재 환경변수 기준으로 LlmConfig를 반환한다.

    provider는 ``LLM_PROVIDER`` (gemini | openai)를 읽는다.
    기본값은 gemini이며, 각 provider 전용 환경변수를 우선 사용한다.
    """
    provider = os.getenv("LLM_PROVIDER", "gemini").strip().lower()

    if provider == "openai":
        model = (os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or "gpt-4o-mini").strip()
        temperature = _env_float("OPENAI_TEMPERATURE", _env_float("LLM_TEMPERATURE", 0.1))
        top_p = _env_float("LLM_TOP_P", 0.8)
        timeout_seconds = _env_int("OPENAI_TIMEOUT_SECONDS", _env_int("LLM_TIMEOUT_SECONDS", 90))
        context_chars = _env_int("LLM_CONTEXT_CHARS", 24000)
        max_output_tokens = _env_int("OPENAI_MAX_OUTPUT_TOKENS", _env_int("LLM_MAX_OUTPUT_TOKENS", 8192))
        api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        thinking_budget = -1
    else:
        # gemini (default)
        model = (os.getenv("GEMINI_MODEL") or os.getenv("LLM_MODEL") or "gemini-2.5-flash").strip()
        temperature = _env_float("GEMINI_TEMPERATURE", _env_float("LLM_TEMPERATURE", 0.1))
        top_p = _env_float("GEMINI_TOP_P", _env_float("LLM_TOP_P", 0.8))
        timeout_seconds = _env_int("GEMINI_TIMEOUT_SECONDS", _env_int("LLM_TIMEOUT_SECONDS", 90))
        context_chars = _env_int("GEMINI_CONTEXT_CHARS", _env_int("LLM_CONTEXT_CHARS", 24000))
        max_output_tokens = _env_int("GEMINI_MAX_OUTPUT_TOKENS", _env_int("LLM_MAX_OUTPUT_TOKENS", 8192))
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        thinking_budget = _env_int("GEMINI_THINKING_BUDGET", -1)

    return LlmConfig(
        enabled=_env_bool("LLM_ENABLED", True),
        provider=provider,
        model=model,
        temperature=temperature,
        top_p=top_p,
        timeout_seconds=timeout_seconds,
        context_chars=context_chars,
        use_mode=os.getenv("LLM_USE_MODE", "auto").strip().lower(),
        max_output_tokens=max_output_tokens,
        api_key=api_key,
        thinking_budget=thinking_budget,
    )


# ---------------------------------------------------------------------------
# 팩토리: LLM_PROVIDER 환경변수에 따라 클라이언트 인스턴스를 반환한다.
# ---------------------------------------------------------------------------

def get_llm_client() -> BaseLLMClient:
    """``LLM_PROVIDER`` 환경변수에 따라 적절한 LLM 클라이언트를 반환한다.

    - ``LLM_PROVIDER=openai`` → :class:`OpenAIClient`
    - 그 외 (기본) → :class:`GeminiClient`
    """
    provider = os.getenv("LLM_PROVIDER", "gemini").strip().lower()
    if provider == "openai":
        from .openai_client import OpenAIClient
        return OpenAIClient()
    else:  # gemini (default)
        from .gemini_client import GeminiClient
        return GeminiClient()


# ---------------------------------------------------------------------------
# 하위 호환성: 기존 call_llm_json 인터페이스를 유지한다.
# ---------------------------------------------------------------------------

async def call_llm_json(
    prompt: str,
    cfg: Optional[LlmConfig] = None,
    response_schema: Optional[Dict[str, Any]] = None,
    task_name: Optional[str] = None,
) -> Dict[str, Any]:
    """기존 코드와의 하위 호환 진입점.

    ``cfg`` 파라미터는 하위 호환성을 위해 수락하지만 실제 클라이언트 설정은
    환경변수에서 직접 읽는다. ``cfg.enabled`` 와 ``cfg.use_mode`` 체크는 유지한다.
    """
    resolved_cfg = cfg or get_llm_config()
    if not resolved_cfg.enabled:
        raise RuntimeError("LLM_ENABLED=false 상태입니다.")
    if resolved_cfg.use_mode == "off":
        raise RuntimeError("LLM_USE_MODE=off 상태입니다.")

    client = get_llm_client()
    return await client.generate_json(
        prompt,
        task_name=task_name,
        response_schema=response_schema,
    )


# ---------------------------------------------------------------------------
# llm_status: 기존 /llm/status 엔드포인트용 딕셔너리 반환
# ---------------------------------------------------------------------------

def llm_status() -> Dict[str, Any]:
    cfg = get_llm_config()
    return {
        "enabled": cfg.enabled,
        "provider": cfg.provider,
        "model": cfg.model,
        "useMode": cfg.use_mode,
        "contextChars": cfg.context_chars,
        "timeoutSeconds": cfg.timeout_seconds,
        "maxOutputTokens": cfg.max_output_tokens,
        "thinkingBudget": cfg.thinking_budget,
        "hasApiKey": bool(cfg.api_key),
        "imageLlmEnabled": False,
    }
