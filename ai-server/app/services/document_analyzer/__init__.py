"""document_analyzer package.

기존 document_analyzer.py를 기능별 모듈로 분리한 패키지입니다.
하위 호환성을 위해 주요 public 함수를 re-export합니다.
"""
from __future__ import annotations

from app.services.document_analyzer.orchestrator import analyze_uploads
from app.services.document_analyzer.doc_profiler import (
    infer_document_profile,
    build_file_profiles,
    extract_key_values_from_text,
    is_narrative_document,
    is_reference_or_guideline_document,
    is_standard_market_price_document,
    is_text_only_vendor_comparison_report,
)
from app.services.document_analyzer.table_utils import (
    rows_to_table,
    table_to_markdown,
    validate_rows,
    normalize_header,
    clean_number,
    to_number,
    compact_text,
    source_has_value,
    prune_empty_columns,
    merge_standard_market_rows,
    # Column definitions
    DEFAULT_COLUMNS,
    STANDARD_MARKET_PRICE_COLUMNS,
    REFERENCE_GUIDELINE_COLUMNS,
    TEXT_VENDOR_COMPARISON_COLUMNS,
    TEXT_VENDOR_COMPARISON_TABLE_TYPE,
    REFERENCE_TABLE_TYPES,
    STANDARD_MARKET_TABLE_TYPES,
    MULTI_VENDOR_COMPARE_TABLE_TYPE,
    # Env/utility
    _env_int,
    _env_float,
    _env_bool,
    _new_parse_logger,
    _limit_pages,
)
from app.services.document_analyzer.file_parser import (
    read_pdf,
    read_xlsx,
    read_docx,
    decode_text,
    parse_delimited_text,
    infer_rows_from_text,
)
from app.services.document_analyzer.ocr_engine import (
    read_image_with_ocr,
    _ocr_enabled,
    _ocr_lang,
    _ocr_dpi,
    _ocr_max_pages,
    _ocr_min_text_chars,
)
from app.services.document_analyzer.vendor_comparator import (
    build_single_file_multi_vendor_price_comparison,
    build_multi_vendor_price_comparison,
    _request_wants_company_comparison,
    _request_wants_standard_price,
    _is_standard_market_file,
    _is_estimate_file,
    _extract_company_name,
    _extract_focus_terms,
    _filter_rows_by_focus,
    _collect_dynamic_vendor_columns,
    _safe_compare_key,
)
from app.services.document_analyzer.text_extractor import (
    extract_standard_market_rows_from_text,
    extract_reference_guideline_rows,
    extract_text_vendor_total_rows,
    extract_text_vendor_item_rows,
    build_text_vendor_comparison_item_table,
    build_text_vendor_comparison_summary_table,
    _split_text_pages,
    _clean_line,
)
from app.services.document_analyzer.row_filters import (
    is_business_row_supported,
    filter_grounded_rows,
    is_reference_row_supported,
)
from app.services.document_analyzer.llm_analyzer import (
    interpret_request_with_llm,
    infer_request_intent_by_rule,
    should_call_llm,
    build_llm_prompt,
    build_llm_grounded_analysis_prompt,
    normalize_llm_analysis_only,
    normalize_llm_result,
    _truncate,
)
from app.services.document_analyzer.business_drafter import (
    _make_business_drafts,
    _build_document_only_summary,
    _build_source_key_values,
)

__all__ = [
    "analyze_uploads",
    "infer_document_profile",
    "build_file_profiles",
    "extract_key_values_from_text",
    "is_narrative_document",
    "is_reference_or_guideline_document",
    "is_standard_market_price_document",
    "is_text_only_vendor_comparison_report",
    "rows_to_table",
    "table_to_markdown",
    "validate_rows",
    "normalize_header",
    "clean_number",
    "to_number",
    "compact_text",
    "source_has_value",
    "prune_empty_columns",
    "merge_standard_market_rows",
    "read_pdf",
    "read_xlsx",
    "read_docx",
    "decode_text",
    "parse_delimited_text",
    "infer_rows_from_text",
    "read_image_with_ocr",
    "build_single_file_multi_vendor_price_comparison",
    "build_multi_vendor_price_comparison",
    "extract_standard_market_rows_from_text",
    "extract_reference_guideline_rows",
    "extract_text_vendor_total_rows",
    "extract_text_vendor_item_rows",
    "build_text_vendor_comparison_item_table",
    "build_text_vendor_comparison_summary_table",
    "is_business_row_supported",
    "filter_grounded_rows",
    "is_reference_row_supported",
    "interpret_request_with_llm",
    "infer_request_intent_by_rule",
    "should_call_llm",
    "build_llm_prompt",
    "build_llm_grounded_analysis_prompt",
    "normalize_llm_analysis_only",
    "normalize_llm_result",
    "DEFAULT_COLUMNS",
    "STANDARD_MARKET_PRICE_COLUMNS",
    "REFERENCE_GUIDELINE_COLUMNS",
    "TEXT_VENDOR_COMPARISON_COLUMNS",
    "TEXT_VENDOR_COMPARISON_TABLE_TYPE",
    "REFERENCE_TABLE_TYPES",
    "STANDARD_MARKET_TABLE_TYPES",
    "MULTI_VENDOR_COMPARE_TABLE_TYPE",
]
