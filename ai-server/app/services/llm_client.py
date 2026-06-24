"""하위 호환성 래퍼 모듈.

기존 ``from app.services.llm_client import ...`` 형태의 import가
깨지지 않도록 새 패키지로 재전달(re-export)한다.
새 코드는 ``from app.services.llm import ...`` 을 직접 사용한다.
"""
from app.services.llm.llm_service import (
    LlmConfig,
    call_llm_json,
    get_llm_config,
    llm_status,
)
from app.services.llm.json_parser import extract_json_object

__all__ = [
    "LlmConfig",
    "call_llm_json",
    "get_llm_config",
    "llm_status",
    "extract_json_object",
]
