from __future__ import annotations

from typing import Any, Dict, List

from app.services.document_analyzer.table_utils import (
    source_has_value,
    BUSINESS_TABLE_REQUIRED_KEYS,
)


def is_business_row_supported(row: Dict[str, Any], source_text: str) -> bool:
    """LLM/규칙 파서가 만든 행이 원문 근거를 갖는 실제 업무 표 행인지 확인한다."""
    if not row:
        return False
    meaningful = {k: str(row.get(k) or "").strip() for k in BUSINESS_TABLE_REQUIRED_KEYS if str(row.get(k) or "").strip()}
    if not meaningful:
        return False

    anchor_keys = ["item_name", "vendor_name", "spec", "amount", "unit_price", "vendor_unit_price", "standard_unit_price", "price_diff"]
    anchor_values = [row.get(k) for k in anchor_keys if str(row.get(k) or "").strip()]
    if not anchor_values:
        return False
    return any(source_has_value(source_text, v) for v in anchor_values)


def filter_grounded_rows(rows: List[Dict[str, Any]], source_text: str) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if is_reference_row_supported(row, source_text) or is_business_row_supported(row, source_text):
            filtered.append(row)
    return filtered


def is_reference_row_supported(row: Dict[str, Any], source_text: str) -> bool:
    if not isinstance(row, dict):
        return False
    basis = str(row.get("basis_item") or row.get("application_basis") or row.get("unit_price_basis") or "").strip()
    if not basis:
        return False
    for key in ("basis_item", "application_basis", "calculation_method", "unit_price_basis"):
        value = str(row.get(key) or "").strip()
        if value and source_has_value(source_text, value[:80]):
            return True
    return False
