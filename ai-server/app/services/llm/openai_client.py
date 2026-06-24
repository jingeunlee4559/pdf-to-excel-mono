"""OpenAI API 클라이언트."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, Optional

from .base_client import BaseLLMClient
from .json_parser import extract_json_object

logger = logging.getLogger("app.llm.openai")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(str(raw).strip())
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


class OpenAIClient(BaseLLMClient):
    """OpenAI API를 사용하는 LLM 클라이언트.

    필요한 패키지: ``pip install openai``

    환경변수:
        OPENAI_API_KEY: OpenAI API 키 (필수).
        OPENAI_MODEL: 사용할 모델 (기본: gpt-4o-mini).
        OPENAI_TEMPERATURE: 생성 온도 (기본: 0.1).
        OPENAI_TIMEOUT_SECONDS: 요청 타임아웃 (기본: 90).
        OPENAI_MAX_OUTPUT_TOKENS: 최대 출력 토큰 (기본: 8192).
    """

    def __init__(self) -> None:
        self._api_key: str = (os.getenv("OPENAI_API_KEY") or "").strip()
        self._model: str = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()
        self._temperature: float = _env_float("OPENAI_TEMPERATURE", 0.1)
        self._timeout_seconds: int = _env_int("OPENAI_TIMEOUT_SECONDS", 90)
        self._max_output_tokens: int = _env_int("OPENAI_MAX_OUTPUT_TOKENS", 8192)

    def get_provider_name(self) -> str:
        return "openai"

    def get_model_name(self) -> str:
        return self._model

    def _call_sync(
        self,
        prompt: str,
        response_schema: Optional[Dict[str, Any]] = None,
        task_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self._api_key:
            raise RuntimeError(
                "OPENAI_API_KEY가 설정되지 않았습니다. ai-server .env에 OPENAI_API_KEY=... 값을 추가하세요."
            )

        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "openai 패키지가 없습니다. ai-server venv에서 `pip install openai`를 실행하세요."
            ) from exc

        client = OpenAI(api_key=self._api_key, timeout=self._timeout_seconds)
        t_start = time.monotonic()

        try:
            # JSON 응답을 강제하기 위해 response_format을 사용한다.
            kwargs: Dict[str, Any] = {
                "model": self._model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a structured data extraction assistant. "
                            "Always respond with valid JSON only. No markdown, no explanation."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": self._temperature,
                "max_tokens": self._max_output_tokens,
                "response_format": {"type": "json_object"},
            }

            response = client.chat.completions.create(**kwargs)
            response_text = response.choices[0].message.content or ""
            parsed = extract_json_object(response_text)

            elapsed = time.monotonic() - t_start
            logger.info(
                f"[LLM] provider=openai model={self._model} task={task_name} "
                f"prompt_chars={len(prompt)} elapsed={elapsed:.2f}s status=ok"
            )

            parsed.setdefault("_llm", {})
            parsed["_llm"].update(
                {
                    "provider": "openai",
                    "model": self._model,
                    "imageLlm": False,
                    "responseMimeType": "application/json",
                    "attempts": 1,
                    "usage": {
                        "prompt_tokens": getattr(response.usage, "prompt_tokens", None),
                        "completion_tokens": getattr(response.usage, "completion_tokens", None),
                    },
                }
            )
            return parsed

        except Exception as exc:  # noqa: BLE001
            elapsed = time.monotonic() - t_start
            logger.error(
                f"[LLM] provider=openai model={self._model} task={task_name} FAILED: {exc}"
            )
            raise

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
