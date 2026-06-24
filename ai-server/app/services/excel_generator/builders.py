from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from .utils import (
    compact_status,
    document_only_text,
    first_text,
    get_payload_analysis,
    get_payload_drafts,
    get_row_value,
    ignore_plain_status,
    to_number,
    today_text,
    _strip_page_markers,
)


def _build_review_content(analysis: Dict[str, Any], rows: List[Dict[str, Any]]) -> str:
    """분석 결과에서 실제 검토 의견을 구성한다."""
    parts = []
    doc_type = str(analysis.get("documentType") or "").strip()
    summary = _strip_page_markers(str(analysis.get("summary") or ""))
    purpose = _strip_page_markers(str(analysis.get("purpose") or ""))
    key_values = analysis.get("keyValues") or []

    # 업체별 단가 비교 문서
    if rows and any(r.get("lowest_vendor") or r.get("standard_unit_price") for r in rows[:5]):
        prices = [(r.get("item_name", ""), r.get("lowest_vendor", ""), r.get("lowest_unit_price") or r.get("calculated_unit_price", "")) for r in rows[:5] if r.get("item_name")]
        if prices:
            parts.append("□ 단가 검토 결과")
            for item, vendor, price in prices[:5]:
                if item and vendor:
                    price_str = f"{int(to_number(price)):,}원" if price and to_number(price) else "확인 필요"
                    parts.append(f"  - {item}: 최저 {vendor} ({price_str})")

    # 표준시장단가와의 비교
    std_rows = [r for r in rows if to_number(r.get("standard_unit_price")) and to_number(r.get("lowest_unit_price") or r.get("calculated_unit_price"))]
    if std_rows:
        diffs = []
        for r in std_rows[:3]:
            std = to_number(r.get("standard_unit_price"))
            low = to_number(r.get("lowest_unit_price") or r.get("calculated_unit_price"))
            if std and low:
                rate = (low - std) / std * 100
                diffs.append(rate)
        if diffs:
            avg_diff = sum(diffs) / len(diffs)
            direction = "낮은" if avg_diff < 0 else "높은"
            parts.append(f"\n□ 표준단가 대비 분석\n  평균 {abs(avg_diff):.1f}% {direction} 수준으로 검토됨")

    # 핵심 키값 활용
    for kv in key_values[:4]:
        label = str(kv.get("label") or "")
        value = str(kv.get("value") or "")
        if label and value and not re.search(r"page|OCR|LLM|샘플", label, re.I):
            parts.append(f"  · {label}: {value}")

    # 결론
    if "견적" in doc_type or "비교" in doc_type or rows:
        parts.append("\n□ 종합 의견\n  업체별 단가 차이를 확인하고, 최저 견적 기준으로 계약 검토를 진행하기 바람.")
    elif purpose:
        parts.append(f"\n□ 검토 의견\n  {purpose}")

    return "\n".join(parts) if parts else ""


def build_report_first_row(payload: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    first = rows[0] if rows else {}
    analysis = get_payload_analysis(payload)
    report = get_payload_drafts(payload).get("report") if isinstance(get_payload_drafts(payload).get("report"), dict) else {}
    job = payload.get("job") or {}

    doc_title = first_text(
        document_only_text(first.get("report_title")),
        document_only_text(first.get("document_title")),
        document_only_text(report.get("report_title")),
        document_only_text(analysis.get("documentType")),
    )
    report_title = doc_title or "업무 보고서"

    purpose = first_text(
        document_only_text(first.get("report_purpose")),
        document_only_text(analysis.get("purpose")),
        document_only_text(report.get("purpose")),
    )
    if not purpose or len(purpose) < 10:
        doc_type = str(analysis.get("documentType") or "")
        if "견적" in doc_type or "비교" in doc_type:
            purpose = "첨부 문서의 업체별 견적 단가를 검토하고, 비교 결과를 보고합니다."
        else:
            purpose = "첨부 문서의 주요 내용을 검토하여 업무 보고서 형식으로 정리합니다."

    raw_summary = first_text(
        document_only_text(first.get("summary")),
        document_only_text(first.get("content")),
        document_only_text(report.get("summary")),
        document_only_text(analysis.get("summary")),
    )
    summary = _strip_page_markers(raw_summary)

    key_values = analysis.get("keyValues") or []
    kv_lines = []
    for kv in key_values[:8]:
        label = str(kv.get("label") or "").strip()
        value = str(kv.get("value") or "").strip()
        if label and value and not re.search(r"page|OCR|LLM|샘플|파싱", label, re.I):
            kv_lines.append(f"  · {label}: {value}")
    if kv_lines:
        summary = ("□ 문서 기본 정보\n" + "\n".join(kv_lines) + "\n\n" + summary).strip()

    issue_value = first_text(first.get("issue_summary"), first.get("review_result"), first.get("review_opinion"))
    if ignore_plain_status(issue_value):
        issue_value = first_text(report.get("issue_summary"), report.get("review_result"), report.get("review_opinion"))
    review_content = document_only_text(issue_value)
    if ignore_plain_status(review_content) or not review_content:
        review_content = _build_review_content(analysis, rows)

    action = first_text(document_only_text(first.get("action_plan")), document_only_text(report.get("action_plan")))
    if not action or len(action) < 5:
        action = "수량 및 단가 최종 확인 후 발주 진행 예정" if rows else "문서 내용 확인 후 후속 조치 예정"

    return {
        **first,
        "report_title": report_title,
        "report_purpose": purpose,
        "summary": summary,
        "issue_summary": review_content,
        "action_plan": action,
        "footer_note": first_text(document_only_text(first.get("footer_note")), document_only_text(report.get("footer_note"))),
    }


def is_explicit_action_text(value: Any) -> bool:
    text = compact_status(value)
    if len(text) < 6:
        return False
    if re.fullmatch(r"(물량|일정|품질|안전|회의|작업일보|협력업체)", text):
        return False
    return bool(re.search(r"조치|처리|확인|점검|보완|검토|지시|미종결|변경|협의|관리|요청|제출|작성|보고|수립", text))


def build_meeting_rows(payload: Dict[str, Any], rows: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    analysis = get_payload_analysis(payload)
    meeting = get_payload_drafts(payload).get("meeting") if isinstance(get_payload_drafts(payload).get("meeting"), dict) else {}
    first = rows[0] if rows else {}
    base = {
        **first,
        "meeting_title": first_text(first.get("meeting_title"), first.get("document_title"), meeting.get("meeting_title"), meeting.get("title"), "업무 회의록"),
        "meeting_date": first_text(first.get("meeting_date"), meeting.get("meeting_date")),
        "meeting_place": first_text(first.get("meeting_place"), meeting.get("meeting_place")),
        "attendees": first_text(first.get("attendees"), meeting.get("attendees")),
        "agenda": first_text(first.get("agenda"), meeting.get("agenda"), analysis.get("purpose"), "첨부 문서 검토 및 후속 관리 방안 논의"),
        "discussion": first_text(first.get("discussion"), first.get("content"), meeting.get("discussion"), analysis.get("summary")),
        "decision": first_text(first.get("decision"), meeting.get("decision"), "원문에 명시된 최종 결정사항은 확인되지 않았습니다. 회의 확정 후 입력하세요."),
        "remark": first_text(first.get("remark"), meeting.get("remark"), "문서 분석 결과 기준 회의록 초안입니다."),
    }
    row_actions = []
    for row in rows:
        action = first_text(row.get("action_item"), row.get("todo"), row.get("next_action"))
        if is_explicit_action_text(action):
            row_actions.append({**row, "action_item": action})
    draft_actions = meeting.get("action_items") if isinstance(meeting.get("action_items"), list) else []
    if not row_actions:
        for item in draft_actions:
            if not isinstance(item, dict):
                continue
            action = first_text(item.get("action_item"), item.get("content"), item.get("text"))
            if is_explicit_action_text(action):
                row_actions.append({
                    "action_item": action,
                    "owner": first_text(item.get("owner"), item.get("assignee"), "확인 필요"),
                    "due_date": first_text(item.get("due_date"), item.get("dueDate"), "미정"),
                    "status": first_text(item.get("status"), "확인 필요"),
                    "remark": first_text(item.get("remark"), item.get("note")),
                })
    if not row_actions:
        row_actions = [{
            "action_item": "원문에 명시된 후속 조치사항은 확인되지 않았습니다. 필요 시 담당자와 기한을 지정하세요.",
            "owner": "확인 필요",
            "due_date": "미정",
            "status": "확인 필요",
            "remark": "",
        }]
    return base, row_actions


def build_official_first_row(payload: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    first = rows[0] if rows else {}
    analysis = get_payload_analysis(payload)
    official = get_payload_drafts(payload).get("officialLetter") if isinstance(get_payload_drafts(payload).get("officialLetter"), dict) else {}
    return {
        **first,
        "letter_title": first_text(first.get("letter_title"), official.get("letter_title"), "공 문"),
        "document_no": first_text(first.get("document_no"), official.get("document_no")),
        "recipient": first_text(first.get("recipient"), official.get("recipient"), "수신처 확인 필요"),
        "reference": first_text(first.get("reference"), official.get("reference")),
        "document_title": first_text(first.get("document_title"), first.get("title"), official.get("document_title"), analysis.get("purpose"), "업무 협조 요청"),
        "body": first_text(first.get("body"), first.get("content"), official.get("body"), analysis.get("summary")),
        "attachment_note": first_text(first.get("attachment_note"), official.get("attachment_note"), "첨부 문서 참조"),
        "sender": first_text(first.get("sender"), official.get("sender"), payload.get("author_name"), "공사팀"),
    }
