"""LLM 응답 텍스트에서 JSON 객체를 추출·복구하는 유틸리티."""
from __future__ import annotations

import json
import re
from typing import Any, Dict


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
            normalized_candidates.append(
                _quote_unquoted_json_keys(_strip_trailing_commas(candidate.replace("'", '"')))
            )

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
        except Exception as exc:  # noqa: BLE001
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
