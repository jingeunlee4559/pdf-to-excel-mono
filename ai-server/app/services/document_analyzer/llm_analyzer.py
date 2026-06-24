from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from app.services.llm_client import call_llm_json, get_llm_config
from app.services.unit_normalizer import enrich_row_units
from app.services.document_analyzer.table_utils import (
    compact_text,
    clean_number,
    source_has_value,
    NUMBER_KEYS,
    DEFAULT_COLUMNS,
    REFERENCE_GUIDELINE_COLUMNS,
    STANDARD_MARKET_PRICE_COLUMNS,
    TEXT_VENDOR_COMPARISON_COLUMNS,
    TEXT_VENDOR_COMPARISON_TABLE_TYPE,
    REFERENCE_TABLE_TYPES,
    STANDARD_MARKET_TABLE_TYPES,
    MULTI_VENDOR_COMPARE_TABLE_TYPE,
)
from app.services.document_analyzer.vendor_comparator import (
    _request_wants_company_comparison,
    _request_wants_standard_price,
    _extract_focus_terms,
)


# ---------------------------------------------------------------------------
# Prompt helpers
# ---------------------------------------------------------------------------

def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[TRUNCATED]"


def _build_llm_intent_prompt(user_request: str, file_summaries: List[Dict[str, Any]], row_samples: List[Dict[str, Any]]) -> str:
    compact_files = json.dumps(file_summaries[:8], ensure_ascii=False, default=str)
    compact_rows = json.dumps(row_samples[:6], ensure_ascii=False, default=str)
    return f"""
너는 문서 분석 시스템의 요청 의도 분석기다.
반드시 JSON 객체 1개만 반환한다. 마크다운/설명문 금지.

[사용자 입력]
{user_request or ''}

[현재 업로드/작업 파일 요약]
{compact_files}

[파서가 원문에서 추출한 표 행 샘플]
{compact_rows}

[의도(intent) 분류 기준]
NARRATIVE_REPORT : 사용자가 보고서 양식을 명시적으로 요청한 경우. 최우선 판단.
  키워드: "검토보고서", "내부 보고", "업무보고서", "회사 내부 검토", "보고서 형식",
          "보고서로 정리", "보고서로 작성", "보고서 형태", "결재용", "보고서처럼",
          "보고서 느낌", "검토보고", "보고서 작성", "업무보고", "회사 보고서"
COMPANY_COMPARISON : 업체별/회사별 단가·견적 비교 요청.
STANDARD_TABLE    : 표준시장단가/기준단가만 추출.
TABLE_FILTER      : 표 필터링 또는 특정 항목 추출.
EXCEL_CREATE      : 엑셀 파일 생성 직접 요청.
DOCUMENT_SUMMARY  : 문서 내용 요약/이해 요청 (보고서 양식 언급 없음).
DOCUMENT_QA       : 특정 정보 질의응답.
UNKNOWN           : 해당 없음.

[반환 JSON 스키마]
{{
  "intent": "NARRATIVE_REPORT|DOCUMENT_SUMMARY|STANDARD_TABLE|COMPANY_COMPARISON|TABLE_FILTER|EXCEL_CREATE|DOCUMENT_QA|UNKNOWN",
  "targetKeywords": ["사용자가 직접 입력한 검색/비교 대상 단어"],
  "includePreviousFiles": true,
  "requiresStandardPrice": false,
  "requiresVendorQuotes": false,
  "narrativeReportRequested": false,
  "outputFormat": "report|analysis|table|excel",
  "reason": "판단 근거 1문장"
}}

[중요 규칙]
1. NARRATIVE_REPORT 키워드가 하나라도 있으면 즉시 intent=NARRATIVE_REPORT, narrativeReportRequested=true, outputFormat=report 로 반환한다. 다른 키워드가 함께 있어도 NARRATIVE_REPORT가 최우선이다.
2. targetKeywords에는 사용자 입력에 실제로 들어간 단어/구만 넣는다. 원문 표에만 있고 사용자가 말하지 않은 공종명은 넣지 않는다.
3. "이것도 추가해서", "다시", "전에 올린 것"은 includePreviousFiles=true로 해석한다.
4. 금액, 단가, 회사명, 공종명을 새로 만들지 않는다.
5. 사용자가 "회사별", "업체별", "비교", "견적"을 말하면 COMPANY_COMPARISON으로 판단한다. (단, 보고서 요청이 함께 있으면 NARRATIVE_REPORT 우선)
6. 사용자가 "표준시장단가만", "기준단가만"을 말하면 STANDARD_TABLE로 판단한다.
7. NARRATIVE_REPORT일 때 requiresVendorQuotes=false, requiresStandardPrice=false로 둔다.
""".strip()


# ---------------------------------------------------------------------------
# Rule-based intent
# ---------------------------------------------------------------------------

_NARRATIVE_REPORT_KEYWORDS = [
    "검토보고서", "검토 보고서", "내부 보고", "업무보고서", "회사 보고서",
    "보고서 형식", "보고서로 작성", "보고서로 정리", "보고서 형태",
    "내부 검토", "결재용", "검토보고", "보고서 작성", "업무보고",
    "보고서처럼", "보고서 느낌", "회사 내부 검토",
]


def infer_request_intent_by_rule(user_request: str, parsed_files: List[Dict[str, Any]], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Gemini JSON 응답이 실패해도 화면/표 생성이 멈추지 않도록 하는 결정론적 의도 분석."""
    request = str(user_request or "")
    compact = compact_text(request)
    if not compact:
        return {}

    narrative_requested = any(kw in request for kw in _NARRATIVE_REPORT_KEYWORDS)
    if narrative_requested:
        intent = "NARRATIVE_REPORT"
    elif _request_wants_company_comparison(request, None):
        intent = "COMPANY_COMPARISON"
    elif _request_wants_standard_price(request, None):
        intent = "STANDARD_TABLE"
    elif any(word in compact for word in ["엑셀", "다운로드", "만들어줘", "생성"]):
        intent = "EXCEL_CREATE"
    elif any(word in compact for word in ["표", "정리"]):
        intent = "TABLE_FILTER"
    elif any(word in compact for word in ["문서", "뭐야", "요약", "분석"]):
        intent = "DOCUMENT_SUMMARY"
    else:
        intent = "UNKNOWN"

    terms = []
    try:
        terms = _extract_focus_terms(request, rows or [], [], llm_terms=[])[:20]
    except Exception:
        terms = []
    return {
        "intent": intent,
        "targetKeywords": terms,
        "includePreviousFiles": any(word in compact for word in ["이것도", "추가", "전에", "기존", "같이"]),
        "requiresStandardPrice": _request_wants_standard_price(request, None),
        "requiresVendorQuotes": _request_wants_company_comparison(request, None) and not narrative_requested,
        "narrativeReportRequested": narrative_requested,
        "outputFormat": "report" if narrative_requested else ("table" if intent in {"COMPANY_COMPARISON", "TABLE_FILTER", "STANDARD_TABLE"} else "analysis"),
        "reason": "LLM JSON 실패 또는 미사용 시 규칙 기반으로 보정",
        "_llmIntentUsed": False,
        "_intentSource": "rule_fallback",
    }


# ---------------------------------------------------------------------------
# LLM intent call
# ---------------------------------------------------------------------------

async def interpret_request_with_llm(user_request: str, parsed_files: List[Dict[str, Any]], rows: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], str]:
    """LLM은 사용자 요청 의도 분석에 사용하되, 실패하면 규칙 보정으로 계속 진행한다."""
    rule_intent = infer_request_intent_by_rule(user_request, parsed_files, rows)
    cfg = get_llm_config()
    if not cfg.enabled:
        return rule_intent, ""

    file_summaries = []
    for item in parsed_files[:8]:
        text = str(item.get("extractedText") or item.get("extracted_text") or "")
        file_summaries.append({
            "name": item.get("originalName") or item.get("original_name"),
            "pageCount": item.get("pageCount") or item.get("page_count"),
            "charCount": len(text),
            "rowCount": len(item.get("parsedRows") or item.get("rows") or []),
            "textPreview": text[:80],
        })

    prompt = _build_llm_intent_prompt(user_request, file_summaries, rows[:6])
    try:
        result = await call_llm_json(prompt, cfg)
        if not isinstance(result, dict):
            raise ValueError("LLM 의도분석 결과가 JSON 객체가 아닙니다.")
        result.setdefault("intent", rule_intent.get("intent") or "UNKNOWN")
        result.setdefault("targetKeywords", rule_intent.get("targetKeywords") or [])
        result.setdefault("requiresStandardPrice", rule_intent.get("requiresStandardPrice") or False)
        result.setdefault("requiresVendorQuotes", rule_intent.get("requiresVendorQuotes") or False)
        result["_llmIntentUsed"] = True
        result["_intentSource"] = "llm"
        return result, ""
    except Exception as exc:  # noqa: BLE001
        if rule_intent:
            rule_intent["_llmIntentUsed"] = False
            rule_intent["_intentSource"] = "rule_fallback_after_llm_error"
            rule_intent["_llmError"] = str(exc)[:300]
            return rule_intent, ""
        return {}, str(exc)


# ---------------------------------------------------------------------------
# should_call_llm
# ---------------------------------------------------------------------------

def should_call_llm(user_request: str, combined_text: str, rows: List[Dict[str, Any]], file_count: int, table_type: str) -> bool:
    cfg = get_llm_config()
    if not cfg.enabled:
        return False
    if not combined_text.strip() and not rows:
        return False
    if cfg.use_mode == "off":
        return False
    if cfg.use_mode == "always":
        return True
    request_text = user_request or ""
    if user_request and str(user_request).strip():
        return True
    if table_type in {MULTI_VENDOR_COMPARE_TABLE_TYPE, "PRICE_COMPARISON", "STANDARD_MARKET_PRICE_TABLE"}:
        return True
    if file_count >= 2:
        return True
    if not rows:
        return True
    if any(word in request_text for word in ["단가", "비교", "업체", "회사", "표", "엑셀", "자사", "양식"]):
        return True
    return False


# ---------------------------------------------------------------------------
# build_llm_prompt
# ---------------------------------------------------------------------------

def build_llm_prompt(user_request: str, output_mode: str, template_id: str | None, combined_text: str, rows: List[Dict[str, Any]]) -> str:
    from app.services.document_analyzer.table_utils import table_to_markdown
    cfg = get_llm_config()
    is_large_table = len(rows or []) > 30 or any(word in str(user_request or "") for word in ["단가", "비교", "업체", "회사", "견적"])
    max_llm_rows = 25 if is_large_table else 80
    max_markdown_rows = 20 if is_large_table else 50
    max_context_chars = min(cfg.context_chars, 7000) if is_large_table else cfg.context_chars
    markdown_table = table_to_markdown(rows, max_rows=max_markdown_rows)
    compact_rows = json.dumps(rows[:max_llm_rows], ensure_ascii=False)
    text_part = _truncate(combined_text, max_context_chars)
    narrative_requested = any(kw in str(user_request or "") for kw in _NARRATIVE_REPORT_KEYWORDS)
    narrative_hint = "\n⚠️ 사용자가 검토보고서/내부보고서 형식을 요청했습니다. tableType=\"NARRATIVE_REPORT\", rows=[], narrativeReportRequested=true 로 반환하고 가격 표를 만들지 않습니다." if narrative_requested else ""

    return f"""
너는 건설/전기/설비 업무 문서를 엑셀화하기 위한 문서 구조화 엔진이다.
반드시 JSON 객체 1개만 반환한다. 설명문, 마크다운, 코드블록은 금지한다.
{narrative_hint}

[사용자 요청]
{user_request or '문서를 분석해서 표로 만들어줘'}

[산출 방식]
output_mode={output_mode or 'FREE_FORM'}
template_id={template_id or ''}

[기존 규칙 파서 표 후보]
{markdown_table or '(표 후보 없음)'}

[표 후보 JSON]
{compact_rows}

[PyMuPDF/pdfplumber/PP-Structure/OCR 추출 텍스트]
{text_part}

[반환 JSON 스키마]
{{
  "analysis": {{
    "documentType": "검토보고서|단가 비교 자료|표준시장단가 자료|견적서|거래명세서|업무 문서|기타 또는 적절한 한글명",
    "purpose": "문서 데이터 엑셀화 또는 보고 목적",
    "summary": "핵심 분석 결과 1~3문장. 추측 금지. 확인 필요 사항 명시.",
    "confidence": 0.0,
    "narrativeReportRequested": false,
    "keyValues": [{{"label": "문서 유형", "value": "..."}}]
  }},
  "table": {{
    "tableName": "문서 표 후보",
    "tableType": "NARRATIVE_REPORT|PRICE_COMPARISON|NORMAL_TABLE|STANDARD_MARKET_PRICE_TABLE|REFERENCE_GUIDELINE_TABLE",
    "columns": [
      {{"key":"vendor_name","label":"업체명"}},
      {{"key":"item_name","label":"품목명"}},
      {{"key":"spec","label":"규격"}},
      {{"key":"quantity","label":"수량"}},
      {{"key":"unit","label":"단위"}},
      {{"key":"unit_price","label":"단가"}},
      {{"key":"amount","label":"금액"}},
      {{"key":"remark","label":"비고"}}
    ],
    "rows": [
      {{
        "vendor_name":"",
        "item_name":"",
        "spec":"",
        "quantity":"",
        "unit":"",
        "unit_original":"",
        "unit_normalized":"",
        "standard_unit_price":"",
        "vendor_unit_price":"",
        "unit_price":"",
        "amount":"",
        "price_diff":"",
        "diff_rate":"",
        "remark":""
      }}
    ]
  }},
  "issues": [
    {{"rowIndex":0,"issueType":"CHECK_REQUIRED","severity":"WARNING","fieldKey":"unit","fieldLabel":"단위","message":"확인 필요 사유"}}
  ]
}}

[중요 규칙]
1. 원문에 없는 업체명/품목명/규격/수량/단위/단가/금액을 절대 만들어내지 말 것.
2. 사용자가 "검토보고서", "내부 보고", "보고서 형식" 등을 요청한 경우 즉시 narrativeReportRequested=true, tableType="NARRATIVE_REPORT", rows=[]로 처리한다. 가격 표를 만들지 않는다.
3. 문서가 보고서/요구사항서/설명 문서/계획서이면 견적서/단가표로 분류하지 말고 table.rows는 빈 배열로 둔다.
4. 기준서/지침서이면 업체명·품목명·금액을 만들지 말고 section, basis_item, application_basis, calculation_method, unit_price_basis, source_page, remark 구조의 REFERENCE_GUIDELINE_TABLE로 정리한다.
5. 본문에 예시로 "견적서", "단가표"라는 단어가 있어도 실제 제목/표 구조가 아니면 견적서로 판단하지 않는다.
6. 실제 표 행이 없으면 rows를 만들지 말고 issues에 TABLE_NOT_FOUND 또는 NO_BUSINESS_TABLE을 추가한다.
7. 단위는 원문 단위를 unit_original에 보존하고, EA/개/PCS는 개, M/m2/m3는 m/㎡/㎥, 공m3는 공㎥, 본/개소/hr는 본/개소/시간으로 정규화한다.
8. 본/개소/공㎥/㎡/㎥는 건설 표준 단위이므로 행별 환산 경고를 만들지 않는다. 업체별 동일 품목·동일 규격인데 단위가 서로 다를 때만 UNIT_MISMATCH_BETWEEN_VENDORS를 추가한다.
9. 표준단가/기준단가와 업체 견적단가를 구분한다. 업체 비교에는 vendor_unit_price를 사용하고 standard_unit_price를 업체 단가로 사용하지 않는다.
10. 수량×단가와 금액이 다르면 AMOUNT_MISMATCH issue를 추가한다.
11. 업체별 단위가 다른 단가 비교는 최저가를 확정하지 말고 확인 필요로 둔다.
12. 행/열이 애매하면 추측하지 말고 rows에 넣지 않는다.
""".strip()


# ---------------------------------------------------------------------------
# build_llm_grounded_analysis_prompt
# ---------------------------------------------------------------------------

def build_llm_grounded_analysis_prompt(
    user_request: str,
    analysis: Dict[str, Any],
    table: Dict[str, Any],
    issues: List[Dict[str, Any]],
    combined_text: str,
) -> str:
    cfg = get_llm_config()
    rows = table.get("rows") if isinstance(table, dict) and isinstance(table.get("rows"), list) else []
    columns = table.get("columns") if isinstance(table, dict) and isinstance(table.get("columns"), list) else []
    table_type = table.get("tableType") or table.get("table_type") or "NORMAL_TABLE"
    compact_table = {
        "tableName": table.get("tableName") or table.get("table_name") or "문서 표 후보",
        "tableType": table_type,
        "rowCount": len(rows),
        "columns": columns[:30],
        "rowsSample": rows[:30],
    }
    compact_issues = issues[:30]
    text_markers = _truncate(combined_text, min(cfg.context_chars, 2500))
    return f"""
너는 건설 문서 분석 결과를 검토하는 LLM 보조분석기다.
반드시 JSON 객체 1개만 반환한다. 마크다운/설명문/코드블록 금지.

[사용자 요청]
{user_request or ''}

[이미 확정된 파서 결과]
{json.dumps(compact_table, ensure_ascii=False, default=str)}

[기존 확인 필요]
{json.dumps(compact_issues, ensure_ascii=False, default=str)}

[원문 근거 일부]
{text_markers}

[반환 JSON 스키마]
{{
  "analysis": {{
    "documentType": "업체별 단가 비교 자료|표준시장단가 자료|견적서|업무 문서|기타",
    "purpose": "문서 데이터 엑셀화 목적",
    "summary": "파서 결과에 근거한 핵심 분석 3~5문장. 비교 대상, 최저 업체 경향, 수량/금액 반영 여부를 포함",
    "confidence": 0.0,
    "keyValues": [
      {{"label":"LLM 검토", "value":"요청 의도와 파서 결과 기준으로 확인한 핵심 내용"}},
      {{"label":"비교 해석", "value":"어떤 업체가 어떤 품목에서 유리한지 표 데이터 근거로 요약"}},
      {{"label":"비용 포인트", "value":"금액 합계/최저가 경향/차이가 큰 구간을 보수적으로 설명"}},
      {{"label":"확인 추천", "value":"단위, 규격, 수량, 제외/추가 항목 중 사용자가 확인해야 할 점"}}
    ]
  }},
  "issues": [
    {{"rowIndex":null,"issueType":"CHECK_REQUIRED","severity":"INFO","fieldKey":"table","fieldLabel":"표 데이터","message":"필요한 경우만 작성"}}
  ]
}}

[엄격 규칙]
1. rows, columns, 단가, 금액, 수량을 새로 만들거나 수정하지 않는다.
2. 표에 없는 업체명/공종명/단가를 말하지 않는다.
3. 숫자 계산은 이미 Python 파서가 수행한 것으로 보고, 검토 의견만 쓴다.
4. 문제가 없으면 issues는 빈 배열 []로 둔다.
5. summary에는 "LLM이 직접 표를 생성했다"고 쓰지 않는다. "파서 결과를 검토했다"고 표현한다.
6. keyValues는 3개 이상 작성하되, rowsSample에 있는 값만 근거로 삼는다.
7. 표에서 제외되거나 추가된 항목은 table rows 기준으로만 말한다. 없으면 없다고 말한다.
""".strip()


# ---------------------------------------------------------------------------
# normalize_llm_analysis_only / normalize_llm_result
# ---------------------------------------------------------------------------

def normalize_llm_analysis_only(llm_result: Dict[str, Any], base_analysis: Dict[str, Any], base_issues: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """LLM 보조분석 결과에서 analysis/issue만 안전하게 병합한다."""
    merged = dict(base_analysis or {})
    raw_analysis = llm_result.get("analysis") if isinstance(llm_result.get("analysis"), dict) else {}
    for key in ["documentType", "purpose", "summary", "confidence"]:
        value = raw_analysis.get(key) or raw_analysis.get(key[0].lower() + key[1:])
        if value not in (None, ""):
            if key == "confidence":
                try:
                    merged[key] = min(float(value), 0.9)
                except Exception:
                    continue
            else:
                merged[key] = str(value).strip()

    raw_kvs = raw_analysis.get("keyValues") if isinstance(raw_analysis.get("keyValues"), list) else []
    grounded_llm_notes = []
    for kv in raw_kvs[:8]:
        if not isinstance(kv, dict):
            continue
        label = str(kv.get("label") or "").strip()
        value = str(kv.get("value") or "").strip()
        if label and value:
            grounded_llm_notes.append({"label": label, "value": value})
    if grounded_llm_notes:
        merged.setdefault("processingMeta", {})["llmReviewNotes"] = grounded_llm_notes

    merged.setdefault("llmMeta", llm_result.get("_llm", {}))

    merged_issues = list(base_issues or [])
    raw_issues = llm_result.get("issues") if isinstance(llm_result.get("issues"), list) else []
    for issue in raw_issues[:30]:
        if not isinstance(issue, dict):
            continue
        message = str(issue.get("message") or "").strip()
        if not message:
            continue
        merged_issues.append({
            "rowIndex": issue.get("rowIndex") if issue.get("rowIndex") is not None else None,
            "issueType": issue.get("issueType") or "CHECK_REQUIRED",
            "severity": issue.get("severity") or "INFO",
            "fieldKey": issue.get("fieldKey") or issue.get("field") or None,
            "fieldLabel": issue.get("fieldLabel") or None,
            "message": message,
            "suggestedValue": issue.get("suggestedValue") or None,
        })
    return merged, merged_issues


def normalize_llm_result(llm_result: Dict[str, Any], fallback_rows: List[Dict[str, Any]], fallback_table_type: str, source_text: str, user_request: str = "") -> Tuple[Dict[str, Any], Dict[str, Any], List[Dict[str, Any]]]:
    from app.services.document_analyzer.doc_profiler import infer_document_profile, is_narrative_document
    from app.services.document_analyzer.row_filters import is_business_row_supported, filter_grounded_rows
    from app.services.document_analyzer.doc_profiler import is_reference_or_guideline_document
    from app.services.document_analyzer.doc_profiler import extract_key_values_from_text
    from app.services.document_analyzer.business_drafter import _build_document_only_summary

    analysis = llm_result.get("analysis") if isinstance(llm_result.get("analysis"), dict) else {}
    table = llm_result.get("table") if isinstance(llm_result.get("table"), dict) else {}
    if not table and isinstance(llm_result.get("tables"), list) and llm_result["tables"]:
        table = llm_result["tables"][0]

    rows = table.get("rows") if isinstance(table.get("rows"), list) else fallback_rows
    normalized_rows = []
    for row in rows[:250]:
        if not isinstance(row, dict):
            continue
        clean_row = {key: (clean_number(value) if key in NUMBER_KEYS else str(value or "").strip()) for key, value in row.items()}
        enriched = enrich_row_units(clean_row)
        if is_business_row_supported(enriched, source_text):
            normalized_rows.append(enriched)

    if not normalized_rows:
        normalized_rows = filter_grounded_rows(fallback_rows, source_text)

    table_type = table.get("tableType") or table.get("table_type") or fallback_table_type
    narrative_requested = bool(analysis.get("narrativeReportRequested"))
    if table_type not in {"NARRATIVE_REPORT", "PRICE_COMPARISON", "NORMAL_TABLE", "REFERENCE_GUIDELINE_TABLE", "GUIDELINE_SUMMARY_TABLE", "STANDARD_MARKET_PRICE_TABLE", TEXT_VENDOR_COMPARISON_TABLE_TYPE, MULTI_VENDOR_COMPARE_TABLE_TYPE}:
        table_type = fallback_table_type
    if narrative_requested:
        table_type = "NARRATIVE_REPORT"
        normalized_rows = []
    elif is_reference_or_guideline_document(source_text) and (normalized_rows or fallback_table_type in REFERENCE_TABLE_TYPES):
        table_type = "REFERENCE_GUIDELINE_TABLE"
    elif not normalized_rows:
        table_type = "REFERENCE_GUIDELINE_TABLE" if fallback_table_type in REFERENCE_TABLE_TYPES else "NORMAL_TABLE"

    default_cols_for_type = REFERENCE_GUIDELINE_COLUMNS if table_type in REFERENCE_TABLE_TYPES else (STANDARD_MARKET_PRICE_COLUMNS if table_type in STANDARD_MARKET_TABLE_TYPES else (TEXT_VENDOR_COMPARISON_COLUMNS if table_type == TEXT_VENDOR_COMPARISON_TABLE_TYPE else DEFAULT_COLUMNS))
    normalized_table = {
        "tableName": table.get("tableName") or table.get("table_name") or ("기준서 항목 표" if table_type in REFERENCE_TABLE_TYPES else "문서 표 후보"),
        "tableType": table_type,
        "columns": table.get("columns") if isinstance(table.get("columns"), list) and table.get("columns") else default_cols_for_type,
        "rows": normalized_rows,
    }

    profile = infer_document_profile(source_text, user_request)
    inferred_doc_type = profile["documentType"]
    llm_doc_type = str(analysis.get("documentType") or analysis.get("document_type") or "").strip()
    if is_narrative_document(source_text) or (llm_doc_type in {"견적서", "단가 비교 자료", "견적서/단가표"} and not normalized_rows):
        doc_type = inferred_doc_type
    else:
        doc_type = llm_doc_type or inferred_doc_type or ("단가 비교 자료" if table_type == "PRICE_COMPARISON" else "업무 문서")

    key_values = analysis.get("keyValues") if isinstance(analysis.get("keyValues"), list) else []
    grounded_key_values = []
    for kv in key_values[:20]:
        if not isinstance(kv, dict):
            continue
        label = str(kv.get("label") or "").strip()
        value = str(kv.get("value") or "").strip()
        if label and value and source_has_value(source_text, value):
            grounded_key_values.append({"label": label, "value": value})
    for kv in extract_key_values_from_text(source_text):
        if kv not in grounded_key_values:
            grounded_key_values.append(kv)

    summary = str(analysis.get("summary") or "").strip()
    if not summary or ("견적" in summary and not normalized_rows and is_narrative_document(source_text)):
        if normalized_rows:
            summary = _build_document_only_summary(source_text, table_type, len(normalized_rows), doc_type)
        else:
            summary = _build_document_only_summary(source_text, table_type, 0, doc_type)

    normalized_analysis = {
        "documentType": doc_type,
        "purpose": analysis.get("purpose") or profile.get("purpose") or "문서 데이터 엑셀화",
        "summary": summary,
        "confidence": min(float(analysis.get("confidence") or profile.get("confidence") or 0.7), 0.88),
        "keyValues": grounded_key_values[:20],
        "narrativeReportRequested": narrative_requested,
        "llmMeta": llm_result.get("_llm", {}),
    }

    issues = llm_result.get("issues") if isinstance(llm_result.get("issues"), list) else []
    normalized_issues = []
    for issue in issues[:100]:
        if not isinstance(issue, dict):
            continue
        normalized_issues.append({
            "rowIndex": issue.get("rowIndex") if issue.get("rowIndex") is not None else None,
            "issueType": issue.get("issueType") or "CHECK_REQUIRED",
            "severity": issue.get("severity") or "WARNING",
            "fieldKey": issue.get("fieldKey") or issue.get("field") or None,
            "fieldLabel": issue.get("fieldLabel") or None,
            "message": issue.get("message") or "LLM 분석 결과 확인이 필요합니다.",
            "suggestedValue": issue.get("suggestedValue") or None,
        })

    return normalized_analysis, normalized_table, normalized_issues
