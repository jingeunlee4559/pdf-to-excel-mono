"""app.services.llm 패키지.

주요 공개 API:
    - ``call_llm_json``: 기존 코드와의 하위 호환 비동기 진입점
    - ``get_llm_client``: 팩토리 (provider 인스턴스 반환)
    - ``get_llm_config``: LlmConfig dataclass 반환
    - ``llm_status``: /llm/status 엔드포인트용 딕셔너리

``LLM_PROVIDER=gemini`` (기본) 또는 ``LLM_PROVIDER=openai`` 로 provider 전환.
"""
from .llm_service import call_llm_json, get_llm_client, get_llm_config, LlmConfig, llm_status

__all__ = [
    "call_llm_json",
    "get_llm_client",
    "get_llm_config",
    "LlmConfig",
    "llm_status",
]
