from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BaseLLMClient(ABC):
    @abstractmethod
    async def generate_json(
        self,
        prompt: str,
        task_name: Optional[str] = None,
        response_schema: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """프롬프트를 받아 JSON dict를 반환한다."""
        ...

    @abstractmethod
    def get_provider_name(self) -> str:
        """LLM 제공자 이름 (예: 'gemini', 'openai')."""
        ...

    @abstractmethod
    def get_model_name(self) -> str:
        """실제 모델 식별자 (예: 'gemini-2.5-flash', 'gpt-4o-mini')."""
        ...
