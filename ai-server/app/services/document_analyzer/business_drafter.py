from __future__ import annotations

import re
from typing import Any, Dict, List

from app.services.unit_normalizer import clean_cell_text
from app.services.document_analyzer.table_utils import (
    compact_text,
    MULTI_VENDOR_COMPARE_TABLE_TYPE,
    TEXT_VENDOR_COMPARISON_TABLE_TYPE,
    REFERENCE_TABLE_TYPES,
    STANDARD_MARKET_TABLE_TYPES,
)
from app.services.document_analyzer.doc_profiler import extract_key_values_from_text


# ---------------------------------------------------------------------------
# Text cleaning helpers
# ---------------------------------------------------------------------------

def _first_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, list):
            parts = []
            for item in value:
                if isinstance(item, dict):
                    parts.append(str(item.get("value") or item.get("content") or item.get("text") or ""))
                else:
                    parts.append(str(item or ""))
            text = "\n".join(part.strip() for part in parts if part and str(part).strip()).strip()
            if text:
                return text
            continue
        if isinstance(value, dict):
            text = str(value.get("value") or value.get("content") or value.get("text") or value.get("summary") or "").strip()
            if text:
                return text
            continue
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _clean_business_sentence(value: Any) -> str:
    text = clean_cell_text(value)
    text = re.sub(r"\[page\s*\d+\s*/\s*\d+(?:\s*OCR)?\]", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[•\-–—*\s]+", "", text).strip()
    return text


def _looks_like_system_or_processing_meta(value: Any) -> bool:
    text = _clean_business_sentence(value)
    if not text:
        return False
    if re.search(r"\[page\s*\d+\s*/\s*\d+", text, re.I):
        return True
    meta_tokens = [
        "첨부 파일", "파일 수", "총 페이지", "확인된 총 페이지", "페이지 수",
        "표 후보", "파싱", "PyMuPDF", "pdfplumber", "PP-Structure", "PaddleOCR",
        "OCR", "LLM", "ai-server", "저장 위치", "산출 방식", "요청 내용은",
        "문서 분석", "엑셀 미리보기", "백그라운드", "분석 결과", "처리했습니다",
        "텍스트 전용 샘플", "텍스트전용", "샘플 문서",
    ]
    return any(token.lower() in text.lower() for token in meta_tokens)


def _document_only_sentences(items: List[str], limit: int = 8) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items or []:
        clean = _clean_business_sentence(item)
        if not clean:
            continue
        if _looks_like_user_format_request(clean) or _looks_like_system_or_processing_meta(clean):
            continue
        if re.search(r"(보고서|검토보고|검토본)$", clean) or "/ 검토보고" in clean:
            continue
        key = compact_text(clean)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(clean)
        if len(out) >= limit:
            break
    return out


def _looks_like_user_format_request(value: Any) -> bool:
    text = _clean_business_sentence(value)
    if not text:
        return False
    prompt_tokens = [
        "정리해줘", "작성해줘", "만들어줘", "써줘", "출력해줘", "보여줘",
        "보고서 형식", "보고서 형태", "보고서로", "업무보고서 형식",
        "회사 업무보고서 형식", "회사 보고서 형식", "핵심 내용만", "요약과 검토내용",
        "상세하게", "풍부하게", "보고 목적·", "검토 결과·", "조치 계획 중심",
        "원문에 없는 내용", "임의로 만들지", "확인 필요로 표시",
    ]
    return any(token in text for token in prompt_tokens)


def _safe_document_purpose(value: Any) -> str:
    text = _clean_business_sentence(value)
    if not text or _looks_like_user_format_request(text):
        return ""
    generic_values = {
        compact_text("문서 데이터 엑셀화 목적"),
        compact_text("문서 내용 요약 및 표 데이터 추출 가능 여부 확인"),
        compact_text("문서 데이터 엑셀화"),
    }
    if compact_text(text) in generic_values:
        return ""
    return text


def _infer_report_purpose_from_document(analysis: Dict[str, Any], combined_text: str, topics: List[str]) -> str:
    source = " ".join([
        _clean_business_sentence(analysis.get("documentType") or analysis.get("document_type") or ""),
        _clean_business_sentence(analysis.get("summary") or ""),
        _clean_business_sentence(combined_text[:3000]),
        " ".join(topics or []),
    ])
    if any(word in source for word in ["점검", "안전", "위험", "현장", "감리", "지적사항"]):
        return "첨부 문서의 현장 점검 내용과 확인 필요 사항을 검토하기 위한 보고입니다."
    if any(word in source for word in ["견적", "단가", "금액", "업체", "비교", "견적서"]):
        return "첨부 문서의 견적·단가·업체 비교 내용을 검토하기 위한 보고입니다."
    if any(word in source for word in ["회의", "안건", "결정", "조치사항", "협의"]):
        return "첨부 문서의 논의 내용과 후속 조치 사항을 정리하기 위한 보고입니다."
    if any(word in source for word in ["작업일보", "작업일지", "공정", "물량"]):
        return "첨부 문서의 작업 현황과 후속 관리 사항을 정리하기 위한 보고입니다."
    return "첨부 문서의 주요 내용과 확인 필요 사항을 업무 보고 형식으로 정리하기 위한 보고입니다."


def _split_business_sentences(text: str, limit: int = 8) -> List[str]:
    normalized = str(text or "").replace("\r", "\n")
    chunks: List[str] = []
    for line in normalized.splitlines():
        line = _clean_business_sentence(line)
        if not line:
            continue
        pieces = re.split(r"(?<=[.。!?])\s+|(?<=다\.)\s+|(?<=요\.)\s+", line)
        for piece in pieces:
            item = _clean_business_sentence(piece)
            if 8 <= len(item) <= 220:
                chunks.append(item)
            elif len(item) > 220:
                chunks.append(item[:220].rstrip() + "…")
        if len(chunks) >= limit:
            break
    out: List[str] = []
    seen = set()
    for chunk in chunks:
        key = compact_text(chunk)
        if key and key not in seen:
            seen.add(key)
            out.append(chunk)
        if len(out) >= limit:
            break
    return out


def _bullet_text(items: List[str], empty: str = "") -> str:
    clean_items = [_clean_business_sentence(item) for item in items if _clean_business_sentence(item)]
    if not clean_items:
        return empty
    return "\n".join(f"• {item}" for item in clean_items)


def _extract_document_title_from_text(text: str, user_request: str = "") -> str:
    request = _clean_business_sentence(user_request)
    if request and not _looks_like_user_format_request(request):
        m = re.search(r"([가-힣A-Za-z0-9·ㆍ\s/()\-]{4,60})(보고서|회의록|공문|검토서)", request)
        if m:
            return _clean_business_sentence(m.group(0))[:70]
    for line in str(text or "").splitlines()[:40]:
        line = _clean_business_sentence(line)
        if 4 <= len(line) <= 70 and any(token in line for token in ["보고서", "회의록", "검토", "현황", "공문", "작업일보", "지시사항"]):
            return line[:70]
    if request and not _looks_like_user_format_request(request):
        return request[:60]
    return "업무 문서 검토 보고서"


def _extract_key_topics(text: str, user_request: str = "", limit: int = 6) -> List[str]:
    source = str(text or "")[:6000]
    topics: List[str] = []
    patterns = [
        r"([가-힣A-Za-z0-9·ㆍ/()\-\s]{2,40})(?:\s*[:：]\s*)([가-힣A-Za-z0-9·ㆍ/()\-\s]{2,80})",
        r"(설계변경|협력업체|작업일보|물량|일정|감리\s*지적사항|발주처\s*회의\s*지시사항|임시전력\s*안전점검|안전점검|EPS\s*변경|위험요인)",
    ]
    for pattern in patterns:
        for m in re.finditer(pattern, source, re.I):
            value = _clean_business_sentence(" ".join(g for g in m.groups() if g))
            if value and len(value) >= 2:
                topics.append(value)
    for line in _split_business_sentences(source, limit=30):
        if any(word in line for word in ["설계변경", "협력업체", "작업일보", "물량", "일정", "감리", "발주처", "회의", "지시", "안전", "점검", "위험", "EPS"]):
            topics.append(line)
    out: List[str] = []
    seen = set()
    for topic in topics:
        key = compact_text(topic)
        if key and key not in seen:
            seen.add(key)
            out.append(topic)
        if len(out) >= limit:
            break
    return out


def _extract_action_candidates(text: str, issues: List[Dict[str, Any]], user_request: str = "", limit: int = 6) -> List[Dict[str, str]]:
    source_lines = _split_business_sentences(str(text or "")[:9000], limit=80)
    action_words = ["조치", "처리", "미종결", "지시", "점검", "보완", "협의", "변경", "수립", "제출", "요청", "재확인"]
    stop_exact = {"물량", "일정", "품질", "안전", "회의", "작업일보", "협력업체"}
    candidates: List[str] = []
    for line in source_lines:
        compact = compact_text(line)
        if compact in {compact_text(x) for x in stop_exact}:
            continue
        if len(line) < 8:
            continue
        if re.search(r"(보고서|검토보고|검토본)$", line) or "/ 검토보고" in line:
            continue
        if "조치 현황" in line and not any(word in line for word in ["미종결", "재확인", "보완", "처리", "지시", "계획"]):
            continue
        if any(word in line for word in action_words):
            candidates.append(line)
    for issue in issues or []:
        message = _clean_business_sentence(issue.get("message") or issue.get("fieldLabel") or "")
        if message and len(message) >= 8:
            candidates.append(message)
    if not candidates:
        topics = _extract_key_topics(text, user_request=user_request, limit=4)
        for topic in topics:
            if any(word in topic for word in ["미종결", "지시", "점검", "변경", "위험", "감리", "발주처"]):
                candidates.append(f"{topic}에 대한 담당자 지정 및 처리 현황 확인")
    out: List[Dict[str, str]] = []
    seen = set()
    for candidate in candidates:
        candidate = _clean_business_sentence(candidate)
        key = compact_text(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        if not any(word in candidate for word in ["확인", "조치", "처리", "점검", "보완", "제출", "협의", "수립", "재확인"]):
            action_text = f"{candidate} 관련 처리 필요 여부 확인"
        else:
            action_text = candidate
        out.append({
            "action_item": action_text[:180],
            "owner": "확인 필요",
            "due_date": "미정",
            "status": "확인 필요",
            "remark": "원문 근거 확인 후 담당자/기한 확정",
        })
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------------------
# _make_business_drafts
# ---------------------------------------------------------------------------

def _make_business_drafts(
    user_request: str,
    analysis: Dict[str, Any],
    table: Dict[str, Any],
    issues: List[Dict[str, Any]],
    combined_text: str,
    file_profiles: List[Dict[str, Any]],
) -> Dict[str, Any]:
    rows = table.get("rows") if isinstance(table, dict) and isinstance(table.get("rows"), list) else []
    title = _extract_document_title_from_text(combined_text, "")
    topics = _document_only_sentences(_extract_key_topics(combined_text, user_request="", limit=8), limit=6)
    sentences = _document_only_sentences(_split_business_sentences(combined_text, limit=10), limit=6)
    actions = _extract_action_candidates(combined_text, issues, user_request="", limit=6)

    purpose = _first_text(
        _safe_document_purpose(analysis.get("purpose")),
        _safe_document_purpose(analysis.get("documentPurpose") or analysis.get("document_purpose")),
        _infer_report_purpose_from_document(analysis, combined_text, topics),
    )

    review_items = _document_only_sentences(sentences[:7], limit=7)
    if not review_items:
        review_items = _document_only_sentences(topics[:7], limit=7)
    if not review_items:
        summary_candidate = _clean_business_sentence(analysis.get("summary") or "")
        review_items = _document_only_sentences([summary_candidate], limit=3)

    issue_items = []
    if actions:
        issue_items.extend([item["action_item"] for item in actions[:4]])
    if issues:
        issue_items.extend([_clean_business_sentence(item.get("message") or item.get("fieldLabel") or "") for item in issues[:4]])
    issue_items = _document_only_sentences(issue_items, limit=5)

    if actions:
        action_plan = _bullet_text([item["action_item"] for item in actions])
    else:
        action_plan = ""

    report = {
        "report_title": title if "보고" in title else f"{title} 보고서",
        "report_purpose": purpose,
        "summary": _bullet_text(review_items[:7]),
        "issue_summary": _bullet_text(issue_items[:5]),
        "review_opinion": _bullet_text(issue_items[:5]),
        "action_plan": action_plan,
        "footer_note": "",
    }

    meeting = {
        "meeting_title": title if "회의" in title else f"{title} 검토 회의록",
        "meeting_date": "",
        "meeting_place": "",
        "attendees": "",
        "agenda": _bullet_text([purpose, *topics[:4]], empty=purpose),
        "discussion": _bullet_text(review_items[:5]),
        "decision": "원문에 명시된 최종 결정사항은 확인되지 않았습니다. 회의 확정 후 결정사항을 입력하세요.",
        "remark": "문서 분석 결과 기준 회의록 초안입니다. 참석자, 장소, 최종 결정사항은 회의 후 확정 입력하세요.",
        "action_items": actions,
    }

    body_lines = [
        "1. 귀 부서의 업무 협조에 감사드립니다.",
        f"2. {purpose}",
        "3. 주요 검토 내용은 아래와 같습니다.",
        *[f"   - {item}" for item in review_items[:4]],
    ]
    if actions:
        body_lines.extend(["4. 아래 사항에 대한 확인 및 조치를 요청드립니다.", *[f"   - {item['action_item']}" for item in actions[:4]]])
    else:
        body_lines.append("4. 원문에 명시된 별도 조치사항은 확인되지 않았으나, 필요 시 담당자 지정 후 후속 관리 바랍니다.")
    official = {
        "letter_title": "공 문",
        "document_no": "",
        "recipient": "수신처 확인 필요",
        "reference": "",
        "document_title": title,
        "body": "\n".join(body_lines),
        "attachment_note": "첨부 문서 참조",
        "sender": "공사팀",
    }

    return {
        "report": report,
        "meeting": meeting,
        "officialLetter": official,
    }


# ---------------------------------------------------------------------------
# _build_document_only_summary / _build_source_key_values
# ---------------------------------------------------------------------------

def _build_document_only_summary(combined_text: str, table_type: str, row_count: int, document_type: str) -> str:
    sentences = _document_only_sentences(_split_business_sentences(combined_text, limit=8), limit=3)
    if sentences:
        return " ".join(sentences)[:700]
    if table_type == MULTI_VENDOR_COMPARE_TABLE_TYPE:
        return "업체별 견적 단가 비교 내용이 확인됩니다."
    if table_type == TEXT_VENDOR_COMPARISON_TABLE_TYPE:
        return "서술형 업체별 단가 비교 검토 내용이 확인됩니다."
    if table_type in STANDARD_MARKET_TABLE_TYPES:
        return "표준시장단가 관련 공종·규격·단가 내용이 확인됩니다."
    if table_type in REFERENCE_TABLE_TYPES:
        return "기준서 또는 지침서의 검토 항목과 확인 사항이 확인됩니다."
    return f"{document_type or '업무 문서'}의 주요 내용이 확인됩니다."


def _build_source_key_values(combined_text: str, file_profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    values = extract_key_values_from_text(combined_text)
    return values[:20]
