from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from openpyxl import Workbook

from .utils import (
    RESULT_DIR,
    TEMPLATE_DIR,
    ensure_dir,
    now_stamp,
    safe_filename,
)
from .workbooks.design import create_design_workbook
from .workbooks.template_mapped import create_mapped_template_workbook
from .workbooks.narrative_report import create_narrative_report_workbook


def save_workbook(wb: Workbook, file_name: Optional[str]) -> Dict[str, Any]:
    ensure_dir(RESULT_DIR)
    safe = safe_filename(file_name, f"excel_result_{now_stamp()}.xlsx")
    out_path = RESULT_DIR / f"{now_stamp()}_{safe}"
    wb.save(out_path)
    return {"file_name": safe, "file_path": str(out_path)}


def generate_excel(payload: Dict[str, Any]) -> Dict[str, Any]:
    # 서술형 검토보고서 요청이면 narrative_report 템플릿 우선 적용
    analysis = payload.get("analysis") or {}
    narrative_report = analysis.get("narrativeReport") or analysis.get("narrative_report")
    if narrative_report and isinstance(narrative_report, dict) and not narrative_report.get("_error"):
        wb, meta = create_narrative_report_workbook(payload, narrative_report)
        result = save_workbook(wb, payload.get("file_name"))
        result.update({"template_kind": meta.get("template_kind"), "vendor_count": 0, "engine": "openpyxl"})
        return result

    mapped = None
    mapping_json = payload.get("mapping_json") or {}
    if payload.get("output_mode") == "COMPANY_TEMPLATE" and not mapping_json.get("aiGenerated"):
        mapped = create_mapped_template_workbook(payload)
    if mapped:
        wb, meta = mapped
    else:
        wb, meta = create_design_workbook(payload)
    result = save_workbook(wb, payload.get("file_name"))
    result.update({
        "template_kind": meta.get("template_kind"),
        "vendor_count": meta.get("vendor_count", 0),
        "engine": "openpyxl",
    })
    return result


def make_template_skeleton(payload: Dict[str, Any]) -> Dict[str, Any]:
    design = payload.get("design") or {}
    skeleton_payload = {
        "rows": [],
        "columns": design.get("baseColumns") or [],
        "mapping_json": design,
        "template": {"template_name": design.get("templateName"), "template_type": design.get("templateType")},
        "job": {"user_request": design.get("reason") or design.get("title") or ""},
        "output_mode": "COMPANY_TEMPLATE",
        "file_name": payload.get("file_name") or f"{design.get('templateName') or 'AI_TEMPLATE'}.xlsx",
    }
    wb, meta = create_design_workbook(skeleton_payload)
    ensure_dir(TEMPLATE_DIR)
    safe = safe_filename(payload.get("file_name"), f"ai_template_{now_stamp()}.xlsx")
    out_path = TEMPLATE_DIR / f"{now_stamp()}_{safe}"
    wb.save(out_path)
    return {"file_name": safe, "file_path": str(out_path), "template_kind": meta.get("template_kind"), "engine": "openpyxl"}


def build_design_candidates(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    이전 layout registry 기반 후보 생성 기능은 사용하지 않는다.
    Gemini가 실제 양식 JSON을 생성하고, 서버가 sanitize 후 openpyxl 렌더링한다.
    """
    analysis = payload.get("analysis") or {}
    doc_type = str(analysis.get("documentType") or analysis.get("document_type") or "업무 문서")
    return {"document_type": doc_type, "design_candidates": []}
