from __future__ import annotations

import re
from typing import Any, Dict, Tuple

from openpyxl import Workbook

from ..utils import (
    HEADER_FILL,
    TITLE_FILL,
    as_list,
    label_for,
    merge_write,
    normalize_key,
    set_widths,
    today_text,
    write_cell,
    write_table,
)


def resolve_binding_value(payload: Dict[str, Any], row: Dict[str, Any], binding_key: str, default: str = "") -> Any:
    key = str(binding_key or "").strip()
    if not key:
        return default
    if key in ("today", "document_date"):
        return row.get(key) or today_text()
    if key in row and row.get(key) not in (None, ""):
        return row.get(key)
    analysis = (payload.get("job") or {}).get("analysis") or {}
    camel = re.sub(r"_([a-z])", lambda m: m.group(1).upper(), key)
    for candidate in (key, camel):
        if isinstance(analysis, dict) and analysis.get(candidate) not in (None, ""):
            return analysis.get(candidate)
    if key in ("requester_name", "writer_name", "created_by"):
        return payload.get("author_name") or default
    if key in ("summary", "purpose", "content"):
        return analysis.get("summary") or analysis.get("purpose") or (payload.get("job") or {}).get("userRequest") or default
    if key in ("review_opinion", "review", "issue_summary"):
        return analysis.get("reviewSummary") or analysis.get("review_summary") or analysis.get("summary") or default
    if key == "action_plan":
        return analysis.get("actionPlan") or analysis.get("nextSteps") or default
    return default


def create_custom_document_workbook(payload: Dict[str, Any]) -> Tuple[Workbook, Dict[str, Any]]:
    """Gemini가 만든 sections/headerPairs를 그대로 렌더링하는 범용 회사 문서형 엑셀."""
    rows = as_list(payload.get("rows"))
    first = rows[0] if rows else {}
    mapping = payload.get("mapping_json") or {}
    sections = as_list(mapping.get("sections"))
    if not sections:
        sections = [
            {"title": "1. 작성 목적", "bindingKey": "purpose", "height": 3},
            {"title": "2. 주요 내용", "bindingKey": "summary", "height": 4},
            {"title": "3. 검토 의견", "bindingKey": "review_opinion", "height": 4},
            {"title": "4. 후속 조치", "bindingKey": "action_plan", "height": 3},
        ]
    header_pairs = as_list(mapping.get("headerPairs")) or [
        {"label": "작성일", "bindingKey": "document_date"},
        {"label": "작성자", "bindingKey": "requester_name"},
        {"label": "공사명", "bindingKey": "project_name"},
        {"label": "현장명", "bindingKey": "site_name"},
    ]
    approvals = [str(x) for x in as_list(mapping.get("approvalLines")) if str(x).strip()] or ["담당", "검토", "승인"]
    total_cols = 8
    wb = Workbook()
    ws = wb.active
    ws.title = str(mapping.get("sheetName") or mapping.get("sheet") or "AI문서양식")[:31]

    title = str(mapping.get("title") or first.get("document_title") or first.get("report_title") or "AI 생성 문서 양식")
    merge_write(ws, 1, 1, 1, total_cols, title, bold=True, size=18, fill=TITLE_FILL)

    # 우측 결재란
    start_approval_col = max(5, total_cols - len(approvals) + 1)
    for idx, label in enumerate(approvals[:4], start=start_approval_col):
        write_cell(ws, 2, idx, label, bold=True, fill=HEADER_FILL)
        write_cell(ws, 3, idx, "")
        ws.row_dimensions[3].height = 32

    r = 3
    c = 1
    for pair in header_pairs[:8]:
        lbl = str(pair.get("label") or "").strip()
        binding = str(pair.get("bindingKey") or pair.get("fieldKey") or "").strip()
        if not lbl or not binding:
            continue
        write_cell(ws, r, c, lbl, bold=True, fill=HEADER_FILL)
        merge_write(ws, r, c + 1, r, min(c + 2, total_cols), resolve_binding_value(payload, first, binding, ""))
        c += 4
        if c > total_cols:
            r += 1
            c = 1

    r += 2
    for idx, section in enumerate(sections[:12], start=1):
        section_title = str(section.get("title") or section.get("label") or f"{idx}. 문서 내용")
        binding = str(section.get("bindingKey") or section.get("fieldKey") or section.get("key") or "summary")
        height = section.get("height", 3)
        try:
            height = int(height)
        except Exception:
            height = 3
        height = max(1, min(8, height))
        merge_write(ws, r, 1, r, total_cols, section_title, bold=True, fill=HEADER_FILL)
        value = resolve_binding_value(payload, first, binding, "")
        merge_write(ws, r + 1, 1, r + height, total_cols, value or "")
        for rr in range(r + 1, r + height + 1):
            ws.row_dimensions[rr].height = 24
        r += height + 2

    # 표 컬럼이 같이 필요한 문서 양식이면 하단에 첨부 내역표를 붙인다.
    base_columns = as_list(mapping.get("baseColumns"))
    if base_columns and rows:
        merge_write(ws, r, 1, r, total_cols, "첨부 내역", bold=True, fill=HEADER_FILL)
        norm_cols = []
        for item in base_columns[:total_cols]:
            key = normalize_key(item.get("fieldKey") or item.get("key"))
            if key:
                norm_cols.append({"key": key, "label": label_for(key, item.get("label"))})
        if norm_cols:
            write_table(ws, norm_cols, rows, r + 1)

    set_widths(ws, total_cols, 16)
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 18
    return wb, {"template_kind": "CUSTOM_DOCUMENT_FORM", "section_count": len(sections)}
