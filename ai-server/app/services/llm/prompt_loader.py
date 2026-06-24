"""프롬프트 텍스트 파일을 읽어오는 유틸리티."""
from __future__ import annotations

from pathlib import Path

# app/services/llm/ → app/ → ai-server/app/prompts/
PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


def load_prompt(name: str) -> str:
    """name: 'document_analyzer' → prompts/document_analyzer.txt 읽기.

    Args:
        name: 파일명에서 .txt 확장자를 제외한 이름.

    Returns:
        프롬프트 문자열.

    Raises:
        FileNotFoundError: 해당 프롬프트 파일이 없을 때.
    """
    path = PROMPTS_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"프롬프트 파일 없음: {path}")
    return path.read_text(encoding="utf-8")
