from __future__ import annotations

from typing import Any, Dict, Tuple

from openpyxl import Workbook

from ..utils import (
    DOCUMENT_TYPE_LABELS,
    as_list,
    detect_document_type,
    normalize_columns,
    write_title_area,
    write_table,
)


def create_free_form_workbook(payload: Dict[str, Any]) -> Tuple[Workbook, Dict[str, Any]]:
    rows = as_list(payload.get("rows"))
    columns = as_list(payload.get("columns"))
    doc_type = detect_document_type(payload)
    wb = Workbook()
    ws = wb.active
    ws.title = DOCUMENT_TYPE_LABELS.get(doc_type, "문서정리")[:31]
    normalized_columns = normalize_columns(columns, rows, doc_type, payload.get("mapping_json") or {})
    title = DOCUMENT_TYPE_LABELS.get(doc_type, "문서 정리표")
    write_title_area(ws, title, max(len(normalized_columns), 6), "분석된 표 데이터를 기준으로 생성한 자유형 엑셀입니다.")
    write_table(ws, normalized_columns, rows, 5)
    return wb, {"template_kind": doc_type, "columns": normalized_columns}
