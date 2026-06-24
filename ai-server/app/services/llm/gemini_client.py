"""Google Gemini API 클라이언트."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional

from .base_client import BaseLLMClient
from .json_parser import extract_json_object

logger = logging.getLogger("app.llm.gemini")


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


_RETRYABLE_ERRORS = (
    "ResourceExhausted",
    "ServiceUnavailable",
    "InternalServerError",
    "DeadlineExceeded",
    "RESOURCE_EXHAUSTED",
    "503",
    "429",
    "500",
)


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc)
    return any(token in msg for token in _RETRYABLE_ERRORS)


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


class GeminiClient(BaseLLMClient):
    """Google Gemini API를 사용하는 LLM 클라이언트."""

    def __init__(self) -> None:
        self._api_key: str = (os.getenv("GEMINI_API_KEY") or "").strip()
        self._model: str = (
            os.getenv("GEMINI_MODEL") or os.getenv("LLM_MODEL") or "gemini-2.5-flash"
        ).strip()
        self._temperature: float = _env_float(
            "GEMINI_TEMPERATURE", _env_float("LLM_TEMPERATURE", 0.1)
        )
        self._top_p: float = _env_float("GEMINI_TOP_P", _env_float("LLM_TOP_P", 0.8))
        self._timeout_seconds: int = _env_int(
            "GEMINI_TIMEOUT_SECONDS", _env_int("LLM_TIMEOUT_SECONDS", 90)
        )
        self._max_output_tokens: int = _env_int(
            "GEMINI_MAX_OUTPUT_TOKENS", _env_int("LLM_MAX_OUTPUT_TOKENS", 8192)
        )
        self._thinking_budget: int = _env_int("GEMINI_THINKING_BUDGET", -1)

    def get_provider_name(self) -> str:
        return "gemini"

    def get_model_name(self) -> str:
        return self._model

    def _make_config(self, types: Any, response_schema: Optional[Dict[str, Any]] = None) -> Any:
        kwargs: Dict[str, Any] = {
            "temperature": self._temperature,
            "top_p": self._top_p,
            "max_output_tokens": self._max_output_tokens,
            "response_mime_type": "application/json",
        }
        if response_schema:
            kwargs["response_schema"] = response_schema
        if self._thinking_budget >= 0:
            try:
                kwargs["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=self._thinking_budget
                )
            except Exception:
                pass
        return types.GenerateContentConfig(**kwargs)

    def _call_sync(
        self,
        prompt: str,
        response_schema: Optional[Dict[str, Any]] = None,
        task_name: Optional[str] = None,
        _max_retries: int = 2,
    ) -> Dict[str, Any]:
        if not self._api_key:
            raise RuntimeError(
                "GEMINI_API_KEY가 설정되지 않았습니다. ai-server .env에 GEMINI_API_KEY=... 값을 추가하세요."
            )

        try:
            from google import genai  # type: ignore
            from google.genai import types  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "google-genai 패키지가 없습니다. ai-server venv에서 `pip install -U google-genai`를 실행하세요."
            ) from exc

        client = genai.Client(api_key=self._api_key)
        last_exc: Exception | None = None
        t_start = time.monotonic()

        for attempt in range(_max_retries + 1):
            try:
                try:
                    response = client.models.generate_content(
                        model=self._model,
                        contents=prompt,
                        config=self._make_config(types, response_schema=response_schema),
                    )
                except TypeError:
                    response = client.models.generate_content(
                        model=self._model,
                        contents=prompt,
                        config=self._make_config(types, response_schema=None),
                    )

                response_text = _extract_response_text(response)
                parsed = extract_json_object(response_text)

                elapsed = time.monotonic() - t_start
                logger.info(
                    f"[LLM] provider=gemini model={self._model} task={task_name} "
                    f"prompt_chars={len(prompt)} elapsed={elapsed:.2f}s status=ok"
                )

                parsed.setdefault("_llm", {})
                parsed["_llm"].update(
                    {
                        "provider": "gemini",
                        "model": self._model,
                        "imageLlm": False,
                        "responseMimeType": "application/json",
                        "attempts": attempt + 1,
                    }
                )
                return parsed

            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < _max_retries and _is_retryable(exc):
                    wait = 5 * (2**attempt)
                    time.sleep(wait)
                    continue
                break

        elapsed = time.monotonic() - t_start
        logger.error(
            f"[LLM] provider=gemini model={self._model} task={task_name} FAILED: {last_exc}"
        )
        raise last_exc  # type: ignore[misc]

    async def generate_json(
        self,
        prompt: str,
        task_name: Optional[str] = None,
        response_schema: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await asyncio.wait_for(
            asyncio.to_thread(
                self._call_sync,
                prompt,
                response_schema,
                task_name,
            ),
            timeout=max(5, self._timeout_seconds + 5),
        )
