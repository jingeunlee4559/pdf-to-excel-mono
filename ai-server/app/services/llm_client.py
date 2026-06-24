from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional


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
    """Gemini 2.5 Flash 전용 LLM 설정.

    PDF/표 추출, 금액 계산, 엑셀 생성은 기존 Python 파서가 담당하고,
    Gemini는 의도분석·요약·JSON 구조화·보고서 초안 보조에만 사용한다.
    """
    return LlmConfig(
        enabled=_env_bool("LLM_ENABLED", True),
        provider="gemini",
        model=(os.getenv("GEMINI_MODEL") or os.getenv("LLM_MODEL") or "gemini-2.5-flash").strip(),
        temperature=_env_float("GEMINI_TEMPERATURE", _env_float("LLM_TEMPERATURE", 0.1)),
        top_p=_env_float("GEMINI_TOP_P", _env_float("LLM_TOP_P", 0.8)),
        timeout_seconds=_env_int("GEMINI_TIMEOUT_SECONDS", _env_int("LLM_TIMEOUT_SECONDS", 90)),
        context_chars=_env_int("GEMINI_CONTEXT_CHARS", _env_int("LLM_CONTEXT_CHARS", 24000)),
        use_mode=os.getenv("LLM_USE_MODE", "auto").strip().lower(),
        max_output_tokens=_env_int("GEMINI_MAX_OUTPUT_TOKENS", _env_int("LLM_MAX_OUTPUT_TOKENS", 8192)),
        api_key=(os.getenv("GEMINI_API_KEY") or "").strip(),
        # -1이면 SDK 기본값을 사용한다. 빠른 응답 위주면 0~1024 범위로 조정한다.
        thinking_budget=_env_int("GEMINI_THINKING_BUDGET", -1),
    )


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


def _quote_unquoted_json_keys(value: str) -> str:
    # 모델이 {documentType: "..."}처럼 key 따옴표를 빠뜨리는 경우를 보정한다.
    return re.sub(r'([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)', r'\1"\2"\3', value)


def _strip_trailing_commas(value: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", value)


def _recover_truncated_json(text: str) -> str:
    """잘린 JSON에서 열린 괄호와 따옴표를 닫아 복구를 시도한다."""
    if not text:
        return ""
    stack = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
        elif not in_string:
            if ch in ("{", "["):
                stack.append("}" if ch == "{" else "]")
            elif ch in ("}", "]") and stack:
                stack.pop()
    if in_string:
        text += '"'
    text += "".join(reversed(stack))
    return text


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

    # 잘린 JSON 복구: 열린 괄호/따옴표를 닫아본다.
    for candidate in list(normalized_candidates):
        recovered = _recover_truncated_json(candidate)
        if recovered and recovered not in seen:
            seen.add(recovered)
            try:
                parsed = json.loads(recovered)
                if isinstance(parsed, dict):
                    return parsed
                if isinstance(parsed, list):
                    return {"items": parsed}
            except Exception as exc:
                last_error = exc

    preview = cleaned[:300].replace("\n", " ")
    raise ValueError(f"LLM JSON 파싱 실패: {last_error}. response_preview={preview}")


def _extract_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text

    chunks: list[str] = []
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str):
                chunks.append(part_text)
    return "\n".join(chunks).strip()


def _make_gemini_config(types: Any, cfg: LlmConfig, response_schema: Optional[Dict[str, Any]] = None) -> Any:
    kwargs: Dict[str, Any] = {
        "temperature": cfg.temperature,
        "top_p": cfg.top_p,
        "max_output_tokens": cfg.max_output_tokens,
        "response_mime_type": "application/json",
    }
    # Gemini structured output은 JSON Schema의 일부를 지원한다.
    # SDK/모델 조합에 따라 response_schema 인자가 달라질 수 있으므로 실패 시 schema 없이 재시도한다.
    if response_schema:
        kwargs["response_schema"] = response_schema
    if cfg.thinking_budget >= 0:
        try:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=cfg.thinking_budget)
        except Exception:
            # SDK 버전별 차이가 있으면 thinking 설정만 생략한다.
            pass
    return types.GenerateContentConfig(**kwargs)


_RETRYABLE_ERRORS = ("ResourceExhausted", "ServiceUnavailable", "InternalServerError", "DeadlineExceeded", "RESOURCE_EXHAUSTED", "503", "429", "500")

def _is_retryable(exc: Exception) -> bool:
    msg = str(exc)
    return any(token in msg for token in _RETRYABLE_ERRORS)


def _call_gemini_sync(prompt: str, cfg: LlmConfig, response_schema: Optional[Dict[str, Any]] = None, _max_retries: int = 2) -> Dict[str, Any]:
    if not cfg.api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되지 않았습니다. ai-server .env에 GEMINI_API_KEY=... 값을 추가하세요.")

    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("google-genai 패키지가 없습니다. ai-server venv에서 `pip install -U google-genai`를 실행하세요.") from exc

    client = genai.Client(api_key=cfg.api_key)
    last_exc: Exception | None = None
    for attempt in range(_max_retries + 1):
        try:
            try:
                response = client.models.generate_content(
                    model=cfg.model,
                    contents=prompt,
                    config=_make_gemini_config(types, cfg, response_schema=response_schema),
                )
            except TypeError:
                response = client.models.generate_content(
                    model=cfg.model,
                    contents=prompt,
                    config=_make_gemini_config(types, cfg, response_schema=None),
                )
            response_text = _extract_response_text(response)
            parsed = extract_json_object(response_text)
            parsed.setdefault("_llm", {})
            parsed["_llm"].update({
                "provider": cfg.provider,
                "model": cfg.model,
                "imageLlm": False,
                "responseMimeType": "application/json",
                "attempts": attempt + 1,
            })
            return parsed
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < _max_retries and _is_retryable(exc):
                # 무료 티어 429 대응: 넉넉하게 대기 (5초, 10초)
                wait = 5 * (2 ** attempt)
                time.sleep(wait)
                continue
            break
    raise last_exc  # type: ignore[misc]


async def call_llm_json(prompt: str, cfg: Optional[LlmConfig] = None, response_schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = cfg or get_llm_config()
    if not cfg.enabled:
        raise RuntimeError("LLM_ENABLED=false 상태입니다.")
    if cfg.use_mode == "off":
        raise RuntimeError("LLM_USE_MODE=off 상태입니다.")
    return await asyncio.wait_for(
        asyncio.to_thread(_call_gemini_sync, prompt, cfg, response_schema),
        timeout=max(5, cfg.timeout_seconds + 5),
    )

