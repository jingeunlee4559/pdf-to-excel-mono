from __future__ import annotations

from typing import Any, Dict, Tuple

from openpyxl import Workbook

from ..utils import detect_document_type
from .estimate import create_estimate_comparison_workbook, create_estimate_form_workbook
from .price_table import create_price_table_workbook
from .custom_document import create_custom_document_workbook
from .report import create_report_workbook
from .free_form import create_free_form_workbook


def create_design_workbook(payload: Dict[str, Any]) -> Tuple[Workbook, Dict[str, Any]]:
    mapping = payload.get("mapping_json") or {}
    layout = str(mapping.get("layout") or mapping.get("layoutType") or "").upper()
    doc_type = detect_document_type(payload)

    # 디자인 후보를 선택한 경우 문서 유형보다 layout을 우선한다.
    if "DYNAMIC_VENDOR" in layout or "VENDOR_COMPARE" in layout or layout == "AI_GENERATED_DYNAMIC_VENDOR_TABLE":
        return create_estimate_comparison_workbook(payload)
    if "ESTIMATE" in layout:
        return create_estimate_form_workbook(payload)
    if "PRICE" in layout or "UNIT_PRICE" in layout:
        return create_price_table_workbook(payload)
    if "CUSTOM_DOCUMENT_FORM" in layout or "DOCUMENT_FORM" in layout:
        return create_custom_document_workbook(payload)
    if "OFFICIAL" in layout:
        return create_report_workbook(payload, "OFFICIAL_LETTER")
    if "MEETING" in layout:
        return create_report_workbook(payload, "MEETING_MINUTES")
    if any(token in layout for token in ("SECTION", "SUMMARY", "APPROVAL", "HEADER_TABLE", "REPORT")):
        return create_report_workbook(payload, "REPORT")
    if "TABLE_ONLY" in layout:
        return create_free_form_workbook(payload)

    if doc_type == "ESTIMATE_COMPARISON":
        return create_estimate_comparison_workbook(payload)
    if doc_type in ("REPORT", "MEETING_MINUTES", "OFFICIAL_LETTER"):
        return create_report_workbook(payload, doc_type)
    if doc_type == "UNIT_PRICE_TABLE":
        return create_price_table_workbook(payload)
    return create_free_form_workbook(payload)
