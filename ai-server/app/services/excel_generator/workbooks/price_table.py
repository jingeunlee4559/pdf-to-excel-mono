from __future__ import annotations

from typing import Any, Dict, Tuple

from openpyxl import Workbook

from ..utils import (
    HEADER_FILL,
    TITLE_FILL,
    as_list,
    merge_write,
    today_text,
    write_cell,
    write_table,
)


def create_price_table_workbook(payload: Dict[str, Any]) -> Tuple[Workbook, Dict[str, Any]]:
    rows = as_list(payload.get("rows"))
    columns = [
        {"key": "row_no", "label": "NO"}, {"key": "construction_code", "label": "공종코드"},
        {"key": "item_name", "label": "공종명/품명"}, {"key": "spec", "label": "규격"},
        {"key": "unit", "label": "단위"}, {"key": "quantity", "label": "수량"},
        {"key": "unit_price", "label": "기준단가"}, {"key": "amount", "label": "금액"}, {"key": "remark", "label": "비고"},
    ]
    wb = Workbook()
    ws = wb.active
    ws.title = "단가표"
    merge_write(ws, 1, 1, 1, len(columns), "표준 단가표", bold=True, size=16, fill=TITLE_FILL)
    write_cell(ws, 3, 1, "기준일", bold=True, fill=HEADER_FILL)
    write_cell(ws, 3, 2, today_text())
    write_cell(ws, 3, 3, "적용범위", bold=True, fill=HEADER_FILL)
    merge_write(ws, 3, 4, 3, len(columns), "공사/자재/장비 단가 관리")
    write_table(ws, columns, rows, 5)
    return wb, {"template_kind": "UNIT_PRICE_TABLE", "columns": columns}
