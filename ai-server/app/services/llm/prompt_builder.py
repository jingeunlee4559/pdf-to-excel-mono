"""프롬프트 템플릿의 {{VAR}} 플레이스홀더를 치환하는 유틸리티."""
from __future__ import annotations


def build_prompt(template: str, **kwargs: object) -> str:
    """``{{USER_REQUEST}}``, ``{{DOCUMENT_TEXT}}`` 같은 플레이스홀더를 치환한다.

    Args:
        template: ``{{KEY}}`` 형식의 플레이스홀더를 포함하는 템플릿 문자열.
        **kwargs: 치환할 키-값 쌍. 값이 ``None`` 이면 빈 문자열로 치환한다.

    Returns:
        모든 플레이스홀더가 치환된 완성 프롬프트 문자열.
    """
    result = template
    for key, value in kwargs.items():
        result = result.replace(f"{{{{{key}}}}}", str(value or ""))
    return result
