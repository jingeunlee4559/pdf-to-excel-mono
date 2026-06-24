from __future__ import annotations

from typing import Any, Dict, List

from fastapi import UploadFile

from app.services.llm_client import call_llm_json, get_llm_config
from app.services.storage_service import repair_mojibake_filename, save_upload_file, validate_storage_path
from app.services.unit_normalizer import enrich_row_units

from app.services.document_analyzer.table_utils import (
    _new_parse_logger,
    DEFAULT_COLUMNS,
    REFERENCE_GUIDELINE_COLUMNS,
    STANDARD_MARKET_PRICE_COLUMNS,
    TEXT_VENDOR_COMPARISON_COLUMNS,
    TEXT_VENDOR_COMPARISON_TABLE_TYPE,
    REFERENCE_TABLE_TYPES,
    STANDARD_MARKET_TABLE_TYPES,
    MULTI_VENDOR_COMPARE_TABLE_TYPE,
    prune_empty_columns,
    validate_rows,
)
from app.services.document_analyzer.file_parser import (
    read_xlsx,
    read_pdf,
    read_docx,
    decode_text,
    infer_rows_from_text,
)
from app.services.document_analyzer.ocr_engine import read_image_with_ocr
from app.services.document_analyzer.doc_profiler import (
    infer_document_profile,
    build_file_profiles,
    is_text_only_vendor_comparison_report,
    is_standard_market_price_document,
    is_reference_or_guideline_document,
)
from app.services.document_analyzer.vendor_comparator import (
    _request_wants_company_comparison,
    build_single_file_multi_vendor_price_comparison,
    build_multi_vendor_price_comparison,
)
from app.services.document_analyzer.text_extractor import (
    extract_standard_market_rows_from_text,
    extract_reference_guideline_rows,
    build_text_vendor_comparison_item_table,
    build_text_vendor_comparison_summary_table,
)
from app.services.document_analyzer.row_filters import filter_grounded_rows
from app.services.document_analyzer.table_utils import merge_standard_market_rows
from app.services.document_analyzer.llm_analyzer import (
    interpret_request_with_llm,
    should_call_llm,
    build_llm_prompt,
    build_llm_grounded_analysis_prompt,
    normalize_llm_analysis_only,
    normalize_llm_result,
)
from app.services.document_analyzer.business_drafter import (
    _make_business_drafts,
    _build_document_only_summary,
    _build_source_key_values,
)
from app.services.document_analyzer.report_generator import (
    user_wants_narrative_report,
    generate_narrative_report,
)


async def analyze_uploads(files: List[UploadFile], user_request: str, output_mode: str, template_id: str | None) -> Dict[str, Any]:
    parsed_files = []
    all_rows: List[Dict[str, Any]] = []
    combined_text_parts = []
    all_parse_logs: List[Dict[str, Any]] = []
    total_page_count = 0
    total_text_chars = 0

    for file in files:
        original_filename = repair_mojibake_filename(file.filename)
        file_logs, file_log = _new_parse_logger(f"ANALYZE:{original_filename}")
        file_log("info", "File received", filename=original_filename, content_type=file.content_type or "")
        saved = await save_upload_file(file, "documents")
        target_path = validate_storage_path(saved["filePath"])
        content = target_path.read_bytes()
        suffix = target_path.suffix.lower()
        text = ""
        rows: List[Dict[str, Any]] = []
        page_count = None
        pages_meta: List[Dict[str, Any]] = []
        parse_metrics: Dict[str, Any] = {"ocrUsed": False}

        if suffix in {".xlsx", ".xlsm"}:
            file_log("info", "Spreadsheet parse start", filename=saved["originalName"], engine="openpyxl")
            text, rows = read_xlsx(content)
            parse_metrics = {"engine": "openpyxl", "rowCount": len(rows), "charCount": len(text), "ocrUsed": False}
            file_log("info", "Spreadsheet parse finish", filename=saved["originalName"], rows=len(rows), chars=len(text))
        elif suffix == ".pdf":
            text, rows, page_count, pages_meta, parse_metrics = read_pdf(content, filename=saved["originalName"], log=file_log)
        elif suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
            file_log("info", "Image OCR parse start", filename=saved["originalName"], engine="PP-Structure/PaddleOCR")
            text, rows, image_metrics = read_image_with_ocr(content, filename=saved["originalName"], log=file_log)
            page_count = 1
            pages_meta = [{
                "page": 1,
                "pageCount": 1,
                "engine": image_metrics.get("engine") or "PP-Structure/PaddleOCR",
                "status": "OCR_EXTRACTED" if text.strip() or rows else "OCR_EMPTY",
                "charCount": len(text),
                "rowCount": len(rows),
            }]
            parse_metrics = image_metrics
        elif suffix == ".docx":
            file_log("info", "DOCX parse start", filename=saved["originalName"], engine="python-docx")
            text, rows = read_docx(content)
            parse_metrics = {"engine": "python-docx", "rowCount": len(rows), "charCount": len(text), "ocrUsed": False}
            file_log("info", "DOCX parse finish", filename=saved["originalName"], rows=len(rows), chars=len(text))
        elif suffix in {".txt", ".csv", ".tsv", ".md", ".json"}:
            file_log("info", "Plain text parse start", filename=saved["originalName"], suffix=suffix)
            text = decode_text(content)
            parse_metrics = {"engine": "text-decode", "charCount": len(text), "ocrUsed": False}
            file_log("info", "Plain text parse finish", filename=saved["originalName"], chars=len(text))
        else:
            file_log("warning", "Unknown extension parsed as text", filename=saved["originalName"], suffix=suffix)
            text = decode_text(content)
            parse_metrics = {"engine": "text-decode", "charCount": len(text), "ocrUsed": False}

        if not rows:
            rows = infer_rows_from_text(text, saved["originalName"] or "file")
        rows = [enrich_row_units(row) for row in rows]
        file_log("info", "File parse summary", filename=saved["originalName"], pages=page_count or 0, chars=len(text), table_rows=len(rows), ocr_used=bool(parse_metrics.get("ocrUsed")))
        all_rows.extend(rows)
        combined_text_parts.append(text)
        all_parse_logs.extend(file_logs)
        total_page_count += int(page_count or 0)
        total_text_chars += len(text or "")
        parsed_files.append({
            **saved,
            "pageCount": page_count,
            "page_count": page_count,
            "extractedText": text,
            "extracted_text": text,
            "pages": pages_meta,
            "parseLogs": file_logs,
            "parse_logs": file_logs,
            "parseMetrics": parse_metrics,
            "parse_metrics": parse_metrics,
            "parsedRows": rows,
            "rows": rows,
        })

    combined_text = "\n\n".join(combined_text_parts)
    llm_intent, llm_intent_error = await interpret_request_with_llm(user_request, parsed_files, all_rows)
    intent_keywords = llm_intent.get("targetKeywords") or llm_intent.get("target_keywords") or [] if isinstance(llm_intent, dict) else []
    intent_name = str(llm_intent.get("intent") or "").strip() if isinstance(llm_intent, dict) else ""
    profile = infer_document_profile(combined_text, user_request)
    file_profiles = build_file_profiles(parsed_files, user_request=user_request, llm_intent=llm_intent)
    wants_price_compare = any(word in (user_request or "") for word in ["단가", "비교", "가격", "견적", "업체", "회사", "최저"]) or intent_name == "COMPANY_COMPARISON"
    text_only_compare_report = is_text_only_vendor_comparison_report(combined_text)
    multi_compare_table = None
    if not text_only_compare_report:
        multi_compare_table = build_multi_vendor_price_comparison(parsed_files, user_request=user_request, llm_intent=llm_intent)
        if not multi_compare_table:
            multi_compare_table = build_single_file_multi_vendor_price_comparison(parsed_files, user_request=user_request, llm_intent=llm_intent)
    narrative_compare_table = None
    if text_only_compare_report:
        narrative_compare_table = build_text_vendor_comparison_item_table(combined_text, user_request=user_request)
        if not narrative_compare_table:
            narrative_compare_table = build_text_vendor_comparison_summary_table(combined_text, user_request=user_request)
    is_standard_market_doc = is_standard_market_price_document(combined_text) and not _request_wants_company_comparison(user_request, llm_intent) and not text_only_compare_report

    if multi_compare_table:
        all_rows = multi_compare_table.get("rows", [])
        table_type = MULTI_VENDOR_COMPARE_TABLE_TYPE
        document_type = "업체별 단가 비교 자료"
        profile = {
            "documentType": document_type,
            "purpose": "업체별 견적 단가를 공종별로 비교",
            "confidence": 0.88,
        }
    elif narrative_compare_table:
        all_rows = narrative_compare_table.get("rows", [])
        # item-level 추출이면 MULTI_VENDOR_COMPARE_TABLE_TYPE, 총괄 요약이면 TEXT_VENDOR_COMPARISON_TABLE_TYPE
        narrative_type = narrative_compare_table.get("tableType", TEXT_VENDOR_COMPARISON_TABLE_TYPE)
        table_type = narrative_type if narrative_type in (MULTI_VENDOR_COMPARE_TABLE_TYPE, TEXT_VENDOR_COMPARISON_TABLE_TYPE) else TEXT_VENDOR_COMPARISON_TABLE_TYPE
        document_type = "업체별 단가 비교 검토보고서"
        profile = {
            "documentType": document_type,
            "purpose": "서술형 업체별 단가 비교 결과와 확인 필요 사항 검토",
            "confidence": 0.9,
        }
    else:
        if is_standard_market_doc:
            text_market_rows = extract_standard_market_rows_from_text(combined_text)
            all_rows = [
                row for row in all_rows
                if str(row.get("item_name", "")).strip()
                and str(row.get("unit", "")).strip()
                and str(row.get("unit_price", "")).strip()
            ]
            all_rows = merge_standard_market_rows(all_rows, text_market_rows)
            for row in all_rows:
                row.pop("remark", None)
            all_rows = filter_grounded_rows(all_rows, combined_text)
        elif is_reference_or_guideline_document(combined_text):
            reference_rows = extract_reference_guideline_rows(combined_text, user_request=user_request)
            if reference_rows:
                all_rows = reference_rows
        all_rows = filter_grounded_rows(all_rows, combined_text)
        is_reference_doc = is_reference_or_guideline_document(combined_text) and not is_standard_market_doc
        has_price_rows = bool(all_rows) and profile.get("documentType") in {"견적서/단가표"} and not is_reference_doc
        if is_standard_market_doc:
            table_type = "STANDARD_MARKET_PRICE_TABLE"
        elif is_reference_doc:
            table_type = "REFERENCE_GUIDELINE_TABLE"
        else:
            table_type = "PRICE_COMPARISON" if (wants_price_compare and bool(all_rows)) or has_price_rows else "NORMAL_TABLE"
        document_type = profile.get("documentType") or ("단가 비교 자료" if table_type == "PRICE_COMPARISON" else "업무 문서")

    model_name = "pymupdf-pdfplumber-ppstructure-rule-parser"
    prompt_version = "pymupdf-pdfplumber-ppstructure-v1"
    llm_used = False
    llm_error = ""
    analysis = {
        "documentType": document_type,
        "purpose": profile.get("purpose") or "문서 데이터 엑셀화",
        "summary": _build_document_only_summary(combined_text, table_type, len(all_rows), document_type),
        "confidence": profile.get("confidence") if profile else (0.86 if all_rows else 0.58),
        "fileProfiles": file_profiles,
        "keyValues": _build_source_key_values(combined_text, file_profiles),
        "processingMeta": {
            "fileCount": len(files),
            "totalPageCount": total_page_count,
            "parsedTextChars": total_text_chars,
            "rowCount": len(all_rows),
            "outputMode": output_mode,
            "llmIntentUsed": bool(isinstance(llm_intent, dict) and llm_intent.get("_llmIntentUsed")),
            "llmIntent": intent_name or None,
            "llmIntentError": llm_intent_error[:120] if llm_intent_error else "",
        },
    }
    if multi_compare_table:
        table = multi_compare_table
        table_columns = table.get("columns", [])
    elif narrative_compare_table:
        table = narrative_compare_table
        table_columns = table.get("columns", [])
    else:
        table_columns = REFERENCE_GUIDELINE_COLUMNS if table_type in REFERENCE_TABLE_TYPES else (STANDARD_MARKET_PRICE_COLUMNS if table_type in STANDARD_MARKET_TABLE_TYPES else (TEXT_VENDOR_COMPARISON_COLUMNS if table_type == TEXT_VENDOR_COMPARISON_TABLE_TYPE else DEFAULT_COLUMNS))
        table_columns = prune_empty_columns(table_columns, all_rows)
        table = {
            "tableName": "기준서 항목 표" if table_type in REFERENCE_TABLE_TYPES else ("표준시장단가 표" if table_type in STANDARD_MARKET_TABLE_TYPES else ("서술형 업체별 단가 비교 요약" if table_type == TEXT_VENDOR_COMPARISON_TABLE_TYPE else "문서 표 후보")),
            "tableType": table_type,
            "columns": table_columns,
            "rows": all_rows,
        }
    issues = validate_rows(all_rows, table_type=table_type)
    business_drafts = _make_business_drafts(user_request, analysis, table, issues, combined_text, file_profiles)
    analysis["drafts"] = business_drafts
    analysis["reportDraft"] = business_drafts.get("report")
    analysis["meetingDraft"] = business_drafts.get("meeting")
    analysis["officialLetterDraft"] = business_drafts.get("officialLetter")
    if isinstance(table, dict):
        meta = dict(table.get("meta") or {})
        meta["drafts"] = business_drafts
        meta["draftPolicy"] = "업무 양식 미리보기용 초안. 원문에 없는 담당자/기한은 확인 필요 또는 미정으로 표시"
        table["meta"] = meta
    for parsed in parsed_files:
        table_metrics = ((parsed.get("parseMetrics") or {}).get("tables") or {}) if isinstance(parsed, dict) else {}
        if table_metrics.get("rowLimitReached"):
            issues.append({
                "rowIndex": None,
                "issueType": "TABLE_ROW_LIMIT_REACHED",
                "severity": "INFO",
                "fieldKey": "table",
                "fieldLabel": "표 추출",
                "message": f"표 행 제한({table_metrics.get('rowCount')}행)에 도달하여 {table_metrics.get('pagesRead')}페이지까지 표를 추출했습니다. 전체 표가 필요하면 PDF_TABLE_MAX_ROWS 값을 늘리세요.",
            })
    result_tables: List[Dict[str, Any]] = [table]

    llm_intent_used = bool(isinstance(llm_intent, dict) and llm_intent.get("_llmIntentUsed"))
    llm_intent_source = str((llm_intent or {}).get("_intentSource") or ("llm" if llm_intent_used else "rule")) if isinstance(llm_intent, dict) else "none"
    llm_summary_used = False
    llm_structure_used = False
    llm_summary_error = ""
    llm_structure_error = ""

    current_rows_for_llm: List[Dict[str, Any]] = []
    for result_table in result_tables:
        if isinstance(result_table, dict):
            current_rows_for_llm.extend(result_table.get("rows", []) or [])

    # 1) 표가 있는 경우: LLM은 표/금액을 다시 만들지 않고 분석 요약·검증 의견만 작성한다.
    if current_rows_for_llm and should_call_llm(user_request, combined_text, all_rows, len(files), table_type):
        cfg = get_llm_config()
        prompt = build_llm_grounded_analysis_prompt(user_request, analysis, table, issues, combined_text)
        try:
            llm_result = await call_llm_json(prompt, cfg)
            analysis, merged_issues = normalize_llm_analysis_only(llm_result, analysis, issues)
            if table_type not in {MULTI_VENDOR_COMPARE_TABLE_TYPE, "PRICE_COMPARISON", "STANDARD_MARKET_PRICE_TABLE"}:
                issues = merged_issues
            llm_summary_used = True
            llm_used = True
            model_name = f"gemini:{cfg.model}+grounded-parser"
            prompt_version = "gemini-grounded-summary-v1"
            analysis.setdefault("processingMeta", {})["llmSummaryUsed"] = True
            analysis.setdefault("processingMeta", {})["llmModel"] = cfg.model
        except Exception as exc:  # noqa: BLE001
            llm_summary_error = str(exc)
            analysis.setdefault("keyValues", []).extend([
                {"label": "LLM 요약/검증", "value": "실패 → 파서 요약 유지"},
                {"label": "LLM 역할", "value": "표 추출·단가 계산은 Python 파서로 완료"},
            ])

    # 2) 표가 전혀 없는 경우에만 LLM 구조화를 시도한다.
    if not current_rows_for_llm and should_call_llm(user_request, combined_text, all_rows, len(files), table_type):
        cfg = get_llm_config()
        prompt = build_llm_prompt(user_request, output_mode, template_id, combined_text, all_rows)
        try:
            llm_result = await call_llm_json(prompt, cfg)
            llm_analysis, llm_table, llm_issues = normalize_llm_result(llm_result, all_rows, table_type, combined_text, user_request)
            analysis = llm_analysis
            table = llm_table
            result_tables = [table]
            system_issues = validate_rows(table.get("rows", []), table_type=table.get("tableType", table_type))
            dedup: Dict[str, Dict[str, Any]] = {}
            for issue in [*llm_issues, *system_issues]:
                key = f"{issue.get('rowIndex')}|{issue.get('issueType')}|{issue.get('fieldKey')}|{issue.get('message')}"
                dedup[key] = issue
            issues = list(dedup.values())
            llm_structure_used = True
            llm_used = True
            model_name = f"gemini:{cfg.model}"
            prompt_version = "gemini-structure-v1"
            analysis.setdefault("processingMeta", {})["llmStructureUsed"] = True
            analysis.setdefault("processingMeta", {})["llmModel"] = cfg.model
        except Exception as exc:  # noqa: BLE001
            llm_structure_error = str(exc)
            analysis.setdefault("processingMeta", {})["llmStructureError"] = llm_structure_error[:120]

    # 3) 사용자가 서술형 검토보고서를 요청한 경우 LLM으로 생성
    if user_wants_narrative_report(user_request) and combined_text.strip():
        narrative_report = await generate_narrative_report(user_request, combined_text, analysis)
        if narrative_report and not narrative_report.get("_error"):
            analysis["narrativeReport"] = narrative_report

    # LLM이 analysis 객체를 보정해도 업무 양식 초안은 유지한다.
    if "business_drafts" in locals():
        analysis["drafts"] = business_drafts
        analysis["reportDraft"] = business_drafts.get("report")
        analysis["meetingDraft"] = business_drafts.get("meeting")
        analysis["officialLetterDraft"] = business_drafts.get("officialLetter")
        if isinstance(table, dict):
            meta = dict(table.get("meta") or {})
            meta["drafts"] = business_drafts
            table["meta"] = meta

    analysis.setdefault("processingMeta", {}).update({
        "tableExtractionSource": "PyMuPDF/pdfplumber",
        "priceCalculationSource": "Python rule parser",
        "llmDirectTableGeneration": "unused" if current_rows_for_llm else ("used" if llm_structure_used else "skipped_or_failed"),
    })

    current_rows = []
    for result_table in result_tables:
        if isinstance(result_table, dict):
            current_rows.extend(result_table.get("rows", []) or [])
    if not current_rows and not any(issue.get("issueType") == "NO_BUSINESS_TABLE" for issue in issues):
        is_ref_table = any(isinstance(t, dict) and (t.get("tableType") in REFERENCE_TABLE_TYPES) for t in result_tables)
        issues.append({
            "rowIndex": None,
            "issueType": "NO_BUSINESS_TABLE",
            "severity": "INFO",
            "fieldKey": "table",
            "fieldLabel": "표 데이터",
            "message": "원문에서 기준서 표로 정리할 수 있는 기준 문장을 찾지 못했습니다." if is_ref_table else "원문에서 견적/단가표 형태의 품목·수량·단가 행은 확인되지 않았습니다. 근거 없는 표 행은 생성하지 않았습니다.",
        })
        analysis["summary"] = analysis.get("summary") or "문서 내용은 확인되었지만 업무 표 행은 추출되지 않았습니다."

    if issues:
        analysis["confidence"] = min(float(analysis.get("confidence") or 0.7), 0.82)

    llm_used_final = bool(llm_used or llm_intent_used or llm_summary_used or llm_structure_used)
    llm_usage = {
        "used": llm_used_final,
        "intentAnalysis": {
            "used": llm_intent_used,
            "source": llm_intent_source,
            "status": "LLM 사용" if llm_intent_used else ("규칙 보정" if llm_intent else "미사용"),
        },
        "tableExtraction": {
            "used": False,
            "source": "PyMuPDF/pdfplumber",
            "status": "LLM 미사용 - 원문 파서 담당",
        },
        "priceCalculation": {
            "used": False,
            "source": "Python rule parser",
            "status": "LLM 미사용 - 코드 계산",
        },
        "summaryAnalysis": {
            "used": llm_summary_used,
            "source": f"gemini:{get_llm_config().model}" if llm_summary_used else "rule summary",
            "status": "LLM 사용" if llm_summary_used else ("파서 요약 유지" if current_rows else "미사용"),
        },
        "structureGeneration": {
            "used": llm_structure_used,
            "source": f"gemini:{get_llm_config().model}" if llm_structure_used else "parser/fallback",
            "status": "LLM 사용" if llm_structure_used else "미사용 또는 실패 시 파서 유지",
        },
    }

    return {
        "model": model_name,
        "promptVersion": prompt_version,
        "llmUsed": llm_used_final,
        "llmIntentUsed": llm_intent_used,
        "llmIntent": llm_intent,
        "llmUsage": llm_usage,
        "llmError": "" if llm_used_final or llm_intent else (llm_error or llm_intent_error),
        "analysis": analysis,
        "tables": result_tables,
        "issues": issues,
        "files": parsed_files,
        "parseLogs": all_parse_logs,
        "parse_logs": all_parse_logs,
        "parseMetrics": {
            "fileCount": len(files),
            "totalPages": total_page_count,
            "totalChars": total_text_chars,
            "ocrUsed": any(bool((pf.get("parseMetrics") or {}).get("ocrUsed")) for pf in parsed_files),
            "textForLlmTruncatedToChars": get_llm_config().context_chars,
        },
    }
