from __future__ import annotations

from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from app.services.storage_service import validate_storage_path


def _argb_to_hex(color: Any, fallback: str | None = None) -> str | None:
    try:
        if not color:
            return fallback
        if color.type == "rgb" and color.rgb:
            value = str(color.rgb)
            if len(value) == 8:
                return f"#{value[2:]}"
            if len(value) == 6:
                return f"#{value}"
        if color.type == "indexed":
            return fallback
    except Exception:
        return fallback
    return fallback


def _cell_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def build_excel_preview(file_path: str, sheet_name: str | None = None, max_rows: int = 80, max_cols: int = 26) -> dict:
    target = validate_storage_path(file_path)
    if target.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise ValueError("엑셀 미리보기는 xlsx, xlsm 파일만 지원합니다.")

    wb = load_workbook(target, read_only=False, data_only=False)
    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active

    max_row = min(ws.max_row or 1, max_rows)
    max_col = min(ws.max_column or 1, max_cols)

    columns = []
    for col_idx in range(1, max_col + 1):
        letter = get_column_letter(col_idx)
        width = ws.column_dimensions[letter].width or 10
        columns.append({"index": col_idx, "letter": letter, "widthPx": max(56, int(width * 7))})

    merged_ranges = [str(rng) for rng in ws.merged_cells.ranges]

    rows = []
    for row_idx in range(1, max_row + 1):
        height = ws.row_dimensions[row_idx].height or 24
        cells = []
        for col_idx in range(1, max_col + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            fill = cell.fill
            font = cell.font
            alignment = cell.alignment
            border = cell.border
            bg = None
            if fill and fill.fill_type and fill.fgColor:
                bg = _argb_to_hex(fill.fgColor, None)
            fg = _argb_to_hex(font.color, "#0f172a") if font and font.color else "#0f172a"
            cells.append(
                {
                    "address": cell.coordinate,
                    "row": row_idx,
                    "columnIndex": col_idx,
                    "columnLetter": get_column_letter(col_idx),
                    "value": _cell_value(cell.value),
                    "text": _cell_value(cell.value),
                    "style": {
                        "backgroundColor": bg or "#ffffff",
                        "color": fg or "#0f172a",
                        "fontWeight": 700 if font and font.bold else 500,
                        "fontSize": int(font.sz or 11) if font else 11,
                        "textAlign": alignment.horizontal or "center",
                        "verticalAlign": alignment.vertical or "center",
                        "whiteSpace": "normal" if alignment.wrap_text else "nowrap",
                        "borderTop": "1px solid #cbd5e1" if border.top and border.top.style else "1px solid #e2e8f0",
                        "borderRight": "1px solid #cbd5e1" if border.right and border.right.style else "1px solid #e2e8f0",
                        "borderBottom": "1px solid #cbd5e1" if border.bottom and border.bottom.style else "1px solid #e2e8f0",
                        "borderLeft": "1px solid #cbd5e1" if border.left and border.left.style else "1px solid #e2e8f0",
                    },
                }
            )
        rows.append({"rowNumber": row_idx, "heightPx": max(28, int(height * 1.35)), "cells": cells})

    return {
        "engine": "openpyxl",
        "sheetNames": wb.sheetnames,
        "sheet_names": wb.sheetnames,
        "preview": {
            "fileName": target.name,
            "sheetName": ws.title,
            "rows": rows,
            "columns": columns,
            "mergedRanges": merged_ranges,
            "maxRow": ws.max_row,
            "maxColumn": ws.max_column,
        },
    }
