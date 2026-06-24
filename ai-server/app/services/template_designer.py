from __future__ import annotations

import json
from typing import Any, Dict, List

from app.services.llm_client import call_llm_json, get_llm_config


def normalize_layout_for_renderer(value: str = "") -> str:
    raw = str(value or "").upper()
    if not raw:
        return "CUSTOM_DOCUMENT_FORM"
    if "DYNAMIC_VENDOR" in raw or "VENDOR_COMPARISON" in raw or "MULTI_VENDOR" in raw:
        return "AI_GENERATED_DYNAMIC_VENDOR_TABLE"
    if "PRICE" in raw or "MARKET" in raw or "UNIT_PRICE" in raw:
        return "PRICE_TABLE"
    if "MEETING" in raw:
        return "MEETING_MINUTES"
    if "OFFICIAL" in raw or "LETTER" in raw:
        return "OFFICIAL_LETTER"
    if "REPORT" in raw or "INSPECTION" in raw or "WORK_LOG" in raw:
        return "CUSTOM_DOCUMENT_FORM"
    if "ESTIMATE" in raw:
        return "ESTIMATE_FORM"
    if "TABLE" in raw:
        return "AI_GENERATED_TABLE"
    return "CUSTOM_DOCUMENT_FORM"


def _request_intent(text: str = "") -> str:
    raw = str(text or "")
    wants_report = any(token in raw for token in ["보고서 형식", "보고서", "업무보고서", "검토보고서", "서술형", "문장형", "보고용"])
    wants_table = any(token in raw for token in ["표로", "표 형태", "표 형식", "비교표", "단가표", "조사표", "테이블", "그리드", "엑셀 표"])
    if wants_table and not wants_report:
        return "TABLE"
    if wants_table and __import__("re").search(r"표로|비교표|단가표|조사표|테이블|그리드|엑셀\s*표", raw):
        return "TABLE"
    if wants_report:
        return "REPORT"
    return "AUTO"


def _field_key(item: Dict[str, Any]) -> str:
    return str(item.get("fieldKey") or item.get("field_key") or item.get("key") or "").strip()


def _field_label(item: Dict[str, Any]) -> str:
    return str(item.get("label") or item.get("fieldLabel") or item.get("field_label") or _field_key(item)).strip()


def _allowed_fields(standard_fields: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {_field_key(item): item for item in standard_fields if _field_key(item)}


def _pick(allowed: Dict[str, Dict[str, Any]], key: str, label: str | None = None) -> Dict[str, str] | None:
    if key not in allowed:
        return None
    return {"fieldKey": key, "label": label or _field_label(allowed[key]) or key}


def _fallback_design(payload: Dict[str, Any]) -> Dict[str, Any]:
    request = str(payload.get("user_request") or "")
    analysis = payload.get("analysis") or {}
    columns = payload.get("columns") or []
    allowed = _allowed_fields(payload.get("standard_fields") or [])
    table_type = str(
        analysis.get("recommendedTableType")
        or analysis.get("recommended_table_type")
        or analysis.get("tableType")
        or ""
    ).upper()
    registry_type = ""
    intent = _request_intent(request)
    is_compare = (
        intent != "REPORT"
        and (
            table_type == "MULTI_VENDOR_PRICE_COMPARISON"
            or registry_type == "VENDOR_COMPARISON_TABLE"
            or any(word in request for word in ["업체별", "회사별", "단가비교", "비교견적", "견적비교", "가격비교", "비교표"])
        )
    )
    is_market = intent != "REPORT" and (table_type == "STANDARD_MARKET_PRICE_TABLE" or registry_type == "PRICE_SURVEY_TABLE" or "표준시장단가" in request)

    if is_compare:
        preferred = ["row_no", "item_name", "spec", "quantity", "unit", "standard_unit_price"]
        title = "업체별 단가 비교표"
        template_type = "MULTI_VENDOR_PRICE_COMPARISON"
    elif is_market:
        preferred = ["row_no", "construction_code", "item_name", "spec", "unit", "standard_unit_price", "labor_ratio", "remark"]
        title = "표준시장단가 정리표"
        template_type = "STANDARD_MARKET_PRICE_TABLE"
    else:
        preferred = ["row_no", "item_name", "spec", "quantity", "unit", "unit_price", "amount", "remark"]
        title = "AI 생성 문서 양식" if intent != "TABLE" else "AI 생성 문서 정리표"
        template_type = "CUSTOM_DOCUMENT_FORM" if intent != "TABLE" else "NORMAL_TABLE"

    base = []
    for key in preferred:
        item = _pick(allowed, key)
        if item and item not in base:
            base.append(item)
    for col in columns:
        key = _field_key(col)
        item = _pick(allowed, key, _field_label(col))
        if item and not any(existing["fieldKey"] == item["fieldKey"] for existing in base):
            base.append(item)
    base = base[:10 if is_compare else 16]

    default_sections = [
        {"key": "purpose", "title": "1. 작성 목적", "bindingKey": "purpose", "height": 3},
        {"key": "summary", "title": "2. 주요 내용", "bindingKey": "summary", "height": 4},
        {"key": "review", "title": "3. 검토 의견", "bindingKey": "review_opinion", "height": 4},
        {"key": "action", "title": "4. 후속 조치", "bindingKey": "action_plan", "height": 3},
    ]
    design: Dict[str, Any] = {
        "templateName": f"AI_{title}",
        "templateType": template_type,
        "sheetName": title[:31],
        "title": title,
        "layout": "AI_GENERATED_DYNAMIC_VENDOR_TABLE" if is_compare else ("PRICE_TABLE" if is_market else normalize_layout_for_renderer(template_type)),
        "headerFields": [item for item in [_pick(allowed, "document_title"), _pick(allowed, "document_date"), _pick(allowed, "requester_name")] if item],
        "headerPairs": [
            {"label": "작성일", "bindingKey": "document_date"},
            {"label": "작성자", "bindingKey": "requester_name"},
            {"label": "공사명", "bindingKey": "project_name"},
            {"label": "현장명", "bindingKey": "site_name"},
        ],
        "sections": [] if is_compare or is_market or intent == "TABLE" else default_sections,
        "baseColumns": base,
        "repeatGroups": [],
        "summaryColumns": [],
        "approvalLines": ["담당", "검토", "승인"],
        "reason": "DB 표준필드와 분석된 표 컬럼을 기준으로 생성한 안전한 기본 양식입니다.",
        "confidence": 0.75,
    }
    if is_compare:
        design["repeatGroups"] = [{
            "groupKey": "vendors",
            "label": "업체별 견적",
            "repeatBy": "vendor",
            "columns": [item for item in [_pick(allowed, "unit_price", "단가"), _pick(allowed, "amount", "금액")] if item],
        }]
        design["summaryColumns"] = [item for item in [
            _pick(allowed, "lowest_target", "최저 업체"),
            _pick(allowed, "calculated_unit_price", "최저 단가"),
            _pick(allowed, "remark", "비고"),
        ] if item]
        design["reason"] = "업체별 단가 비교 문서로 판단되어 업체 수에 따라 반복 컬럼이 늘어나는 양식을 제안했습니다."
        design["confidence"] = 0.82
    return design


def _build_prompt(payload: Dict[str, Any]) -> str:
    standard_fields = payload.get("standard_fields") or []
    slim_fields = [
        {
            "fieldKey": _field_key(item),
            "label": _field_label(item),
            "group": item.get("group") or item.get("field_group"),
            "dataType": item.get("dataType") or item.get("data_type"),
        }
        for item in standard_fields
        if _field_key(item)
    ]
    data = {
        "userRequest": payload.get("user_request") or "",
        "analysis": payload.get("analysis") or {},
        "columns": payload.get("columns") or [],
        "rowsSample": (payload.get("rows") or [])[:8],
        "standardFields": slim_fields,
    }
    return f"""
너는 업무문서 엑셀 양식 설계 보조 AI다.

목표:
사용자 요청, 문서 분석 결과, 추출된 표 컬럼, DB 표준필드 목록을 보고 신규 엑셀 양식 설계 JSON만 생성한다.
기존 템플릿을 고르는 것이 아니라, 회사에서 바로 쓸 수 있는 엑셀 문서 양식의 구조를 설계한다.

반드시 지켜야 할 규칙:
1. baseColumns, repeatGroups, summaryColumns에 들어가는 fieldKey는 standardFields에 있는 값만 사용한다.
2. sections/headerPairs의 bindingKey는 rowsSample 또는 analysis에 있는 키를 우선 사용하되, 없으면 일반 키(purpose, summary, review_opinion, action_plan)를 사용할 수 있다.
3. 엑셀 셀 주소, 병합 주소, 수식은 만들지 않는다.
4. 실제 xlsx 파일은 만들지 않는다.
5. 필요한 문서 섹션, 표 컬럼, 컬럼 순서, 반복그룹 여부를 판단한다.
6. 기존 후보 양식이나 layout registry를 고르지 않는다. Gemini가 사용자 요청에 맞는 신규 회사 문서형 엑셀 양식을 직접 설계한다.
7. 사용자가 "표로", "비교표", "단가표"처럼 표 산출을 명시한 경우에만 업체별/회사별/견적/단가 비교 자료에 repeatGroups를 사용한다.
8. 사용자가 "보고서 형식", "서술형", "문장형", "업무보고서"를 요청하면 표 전용 layout과 repeatGroups를 쓰지 말고 CUSTOM_DOCUMENT_FORM 또는 REPORT_FORM 계열을 우선한다.
9. 보고서/회의록/공문/검토서/점검표/일보처럼 문서형 양식은 sections를 반드시 3개 이상 만든다.
10. layout은 CUSTOM_DOCUMENT_FORM, REPORT_FORM, MEETING_MINUTES, OFFICIAL_LETTER, AI_GENERATED_TABLE, AI_GENERATED_DYNAMIC_VENDOR_TABLE, PRICE_TABLE, ESTIMATE_FORM 중 하나를 사용한다.
11. 설명 문장 없이 JSON 객체 하나만 출력한다.
12. 한국어 라벨을 사용한다.

출력 형식:
{{
  "templateName": "",
  "templateType": "NORMAL_TABLE | STANDARD_MARKET_PRICE_TABLE | MULTI_VENDOR_PRICE_COMPARISON | REPORT_FORM | INSPECTION_REPORT | MEETING_MINUTES | OFFICIAL_LETTER | WORK_LOG_TABLE",
  "sheetName": "",
  "title": "",
  "layout": "CUSTOM_DOCUMENT_FORM | AI_GENERATED_TABLE | AI_GENERATED_DYNAMIC_VENDOR_TABLE | REPORT_FORM | MEETING_MINUTES | OFFICIAL_LETTER | PRICE_TABLE | ESTIMATE_FORM",
  "headerFields": [{{"fieldKey":"", "label":""}}],
  "headerPairs": [{{"label":"작성일", "bindingKey":"document_date"}}, {{"label":"작성자", "bindingKey":"requester_name"}}],
  "sections": [{{"key":"purpose", "title":"1. 작성 목적", "bindingKey":"purpose", "height":3}}, {{"key":"summary", "title":"2. 주요 내용", "bindingKey":"summary", "height":4}}],
  "baseColumns": [{{"fieldKey":"", "label":""}}],
  "repeatGroups": [{{"groupKey":"vendors", "label":"업체별 견적", "repeatBy":"vendor", "columns":[{{"fieldKey":"unit_price", "label":"단가"}}, {{"fieldKey":"amount", "label":"금액"}}]}}],
  "summaryColumns": [{{"fieldKey":"", "label":""}}],
  "approvalLines": ["담당", "검토", "승인"],
  "reason": "",
  "confidence": 0.0
}}

입력 데이터:
{json.dumps(data, ensure_ascii=False)}
""".strip()


def _design_response_schema() -> Dict[str, Any]:
    field_item = {
        "type": "object",
        "properties": {
            "fieldKey": {"type": "string"},
            "label": {"type": "string"},
        },
        "required": ["fieldKey", "label"],
    }
    return {
        "type": "object",
        "properties": {
            "templateName": {"type": "string"},
            "templateType": {"type": "string"},
            "sheetName": {"type": "string"},
            "title": {"type": "string"},
            "layout": {"type": "string"},
            "headerFields": {"type": "array", "items": field_item},
            "headerPairs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "bindingKey": {"type": "string"},
                    },
                    "required": ["label", "bindingKey"],
                },
            },
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                        "title": {"type": "string"},
                        "bindingKey": {"type": "string"},
                        "height": {"type": "integer"},
                    },
                    "required": ["key", "title", "bindingKey"],
                },
            },
            "baseColumns": {"type": "array", "items": field_item},
            "repeatGroups": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "groupKey": {"type": "string"},
                        "label": {"type": "string"},
                        "repeatBy": {"type": "string"},
                        "columns": {"type": "array", "items": field_item},
                    },
                    "required": ["groupKey", "repeatBy", "columns"],
                },
            },
            "summaryColumns": {"type": "array", "items": field_item},
            "approvalLines": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["templateName", "templateType", "sheetName", "title", "layout", "reason", "confidence"],
    }


def _safe_text_items(items: Any, allowed_keys: set[str], fallback_items: List[Dict[str, Any]], max_count: int = 10) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    source = items if isinstance(items, list) else []
    for item in list(source) + list(fallback_items or []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("label") or "").strip()
        binding = str(item.get("bindingKey") or item.get("fieldKey") or item.get("key") or "").strip()
        key = str(item.get("key") or binding or title).strip()[:60]
        if not title or not binding:
            continue
        # 문서형 섹션은 분석 결과/행 데이터 키를 바인딩하므로 standardFields 외 일반 키도 허용한다.
        if len(binding) > 80 or any(ch in binding for ch in ["[", "]", "{", "}"]):
            continue
        height = item.get("height", 3)
        try:
            height = int(height)
        except Exception:
            height = 3
        out.append({"key": key, "title": title[:80], "bindingKey": binding[:80], "height": max(1, min(8, height))})
        if len(out) >= max_count:
            break
    return out

def _sanitize_llm_design(raw: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    fallback = _fallback_design(payload)
    allowed = _allowed_fields(payload.get("standard_fields") or [])

    def safe_item(item: Dict[str, Any]) -> Dict[str, str] | None:
        key = _field_key(item)
        if key not in allowed:
            return None
        return {"fieldKey": key, "label": _field_label(item) or _field_label(allowed[key]) or key}

    def safe_list(items: Any, fallback_items: List[Dict[str, str]]) -> List[Dict[str, str]]:
        out: List[Dict[str, str]] = []
        source = items if isinstance(items, list) else []
        for item in list(source) + list(fallback_items or []):
            if not isinstance(item, dict):
                continue
            safe = safe_item(item)
            if safe and not any(existing["fieldKey"] == safe["fieldKey"] and existing["label"] == safe["label"] for existing in out):
                out.append(safe)
        return out

    repeat_groups = []
    for group in raw.get("repeatGroups") or []:
        if not isinstance(group, dict):
            continue
        cols = safe_list(group.get("columns"), (fallback.get("repeatGroups") or [{}])[0].get("columns", []))
        if cols:
            repeat_groups.append({
                "groupKey": group.get("groupKey") or "vendors",
                "label": group.get("label") or "업체별 견적",
                "repeatBy": group.get("repeatBy") or "vendor",
                "columns": cols,
            })

    allowed_keys = set(allowed.keys())
    sections = _safe_text_items(raw.get("sections"), allowed_keys, fallback.get("sections", []), max_count=12)
    requested_layout = str(raw.get("layout") or raw.get("layoutType") or fallback.get("layout") or "")
    normalized_layout = normalize_layout_for_renderer(requested_layout)
    raw_base_columns = safe_list(raw.get("baseColumns"), [])[:20]
    if repeat_groups and ("VENDOR" in normalized_layout or "DYNAMIC" in normalized_layout or "COMPARISON" in normalized_layout):
        final_layout = "AI_GENERATED_DYNAMIC_VENDOR_TABLE"
        final_base_columns = raw_base_columns or safe_list(raw.get("baseColumns"), fallback.get("baseColumns", []))[:20]
    elif sections and not repeat_groups and ("CUSTOM_DOCUMENT_FORM" in normalized_layout or not raw_base_columns):
        final_layout = "CUSTOM_DOCUMENT_FORM"
        final_base_columns = raw_base_columns
    else:
        final_layout = normalized_layout or fallback.get("layout") or "AI_GENERATED_TABLE"
        final_base_columns = raw_base_columns or safe_list(raw.get("baseColumns"), fallback.get("baseColumns", []))[:20]

    header_pairs = []
    for item in list(raw.get("headerPairs") or []) + list(fallback.get("headerPairs") or []):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        binding = str(item.get("bindingKey") or item.get("fieldKey") or "").strip()
        if label and binding and not any(x["label"] == label and x["bindingKey"] == binding for x in header_pairs):
            header_pairs.append({"label": label[:40], "bindingKey": binding[:80]})
        if len(header_pairs) >= 8:
            break

    approvals = [str(x).strip()[:20] for x in (raw.get("approvalLines") or fallback.get("approvalLines") or ["담당", "검토", "승인"]) if str(x).strip()]

    return {
        "templateName": str(raw.get("templateName") or fallback["templateName"])[:80],
        "templateType": str(raw.get("templateType") or raw.get("layoutType") or fallback["templateType"])[:80],
        "sheetName": str(raw.get("sheetName") or fallback["sheetName"])[:31],
        "title": str(raw.get("title") or fallback["title"])[:120],
        "layout": final_layout,
        "headerFields": safe_list(raw.get("headerFields"), fallback.get("headerFields", [])),
        "headerPairs": header_pairs,
        "sections": sections,
        "baseColumns": final_base_columns,
        "repeatGroups": repeat_groups,
        "summaryColumns": safe_list(raw.get("summaryColumns"), fallback.get("summaryColumns", []))[:8],
        "approvalLines": approvals[:5],
        "reason": str(raw.get("reason") or fallback.get("reason") or "")[:500],
        "confidence": max(0.0, min(1.0, float(raw.get("confidence") or fallback.get("confidence") or 0.75))),
        "_llm": raw.get("_llm") or {},
    }


async def design_template(payload: Dict[str, Any]) -> Dict[str, Any]:
    fallback = _fallback_design(payload)
    cfg = get_llm_config()
    if not cfg.enabled:
        return fallback
    try:
        raw = await call_llm_json(_build_prompt(payload), cfg, response_schema=_design_response_schema())
        return _sanitize_llm_design(raw, payload)
    except Exception as exc:  # noqa: BLE001 - Gemini 응답 지연 또는 JSON 실패 시 규칙 기반 fallback 필요
        fallback["llmError"] = str(exc)[:400]
        fallback["generatedBy"] = "rule-fallback"
        return fallback
