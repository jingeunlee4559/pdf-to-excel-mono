from __future__ import annotations

import json
from typing import Any, Dict, List

from app.services.llm_client import call_local_llm_json, get_llm_config
from app.services.layout_registry import LAYOUT_REGISTRY, normalize_layout_for_renderer, build_layout_candidates


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


def _infer_registry_candidate(payload: Dict[str, Any]) -> Dict[str, Any]:
    request = str(payload.get("user_request") or "")
    analysis = payload.get("analysis") or {}
    columns = payload.get("columns") or []
    candidates = build_layout_candidates(
        analysis=analysis,
        table={"columns": columns, "tableType": analysis.get("recommendedTableType") or analysis.get("tableType") or ""},
        user_request=request,
    )
    return candidates[0] if candidates else {}


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
    registry_candidate = _infer_registry_candidate(payload)
    registry_type = str(registry_candidate.get("layoutType") or registry_candidate.get("layout") or "")
    is_compare = table_type == "MULTI_VENDOR_PRICE_COMPARISON" or registry_type == "VENDOR_COMPARISON_TABLE" or any(word in request for word in ["업체별", "회사별", "단가비교", "비교견적", "견적비교", "가격비교"])
    is_market = table_type == "STANDARD_MARKET_PRICE_TABLE" or registry_type == "PRICE_SURVEY_TABLE" or "표준시장단가" in request

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
        title = str(registry_candidate.get("title") or registry_candidate.get("name") or "AI 생성 문서 정리표")
        template_type = registry_type or "NORMAL_TABLE"

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

    design: Dict[str, Any] = {
        "templateName": f"AI_{title}",
        "templateType": template_type,
        "sheetName": title[:31],
        "title": title,
        "layout": "AI_GENERATED_DYNAMIC_VENDOR_TABLE" if is_compare else ("PRICE_TABLE" if is_market else normalize_layout_for_renderer(template_type)),
        "headerFields": [item for item in [_pick(allowed, "document_title"), _pick(allowed, "document_date"), _pick(allowed, "requester_name")] if item],
        "baseColumns": base,
        "repeatGroups": [],
        "summaryColumns": [],
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
        "layoutRegistry": payload.get("layout_registry") or LAYOUT_REGISTRY,
    }
    return f"""
너는 업무문서 엑셀 양식 설계 보조 AI다.

목표:
사용자 요청, 문서 분석 결과, 추출된 표 컬럼, DB 표준필드 목록을 보고 신규 엑셀 양식 설계 JSON만 생성한다.

반드시 지켜야 할 규칙:
1. standardFields에 없는 fieldKey는 절대 만들지 않는다.
2. 엑셀 셀 주소, 병합 주소, 수식은 만들지 않는다.
3. 실제 xlsx 파일은 만들지 않는다.
4. 필요한 컬럼, 컬럼 순서, 반복그룹 여부만 판단한다.
5. 업체별/회사별/견적/단가 비교 자료는 repeatGroups를 사용한다.
6. 보고서/회의록/공문처럼 서술형 문서는 layoutRegistry의 layoutType을 선택하고 baseColumns는 비워도 된다.
7. layout은 layoutRegistry에 있는 layout 또는 렌더러용 layout만 사용한다.
8. 설명 문장 없이 JSON 객체 하나만 출력한다.
9. 한국어 라벨을 사용한다.

출력 형식:
{{
  "templateName": "",
  "templateType": "NORMAL_TABLE | STANDARD_MARKET_PRICE_TABLE | MULTI_VENDOR_PRICE_COMPARISON | REPORT_FORM | INSPECTION_REPORT | MEETING_MINUTES | OFFICIAL_LETTER | WORK_LOG_TABLE",
  "sheetName": "",
  "title": "",
  "layout": "AI_GENERATED_TABLE | AI_GENERATED_DYNAMIC_VENDOR_TABLE | REPORT_FORM | MEETING_MINUTES | OFFICIAL_LETTER | PRICE_TABLE | ESTIMATE_FORM",
  "headerFields": [{{"fieldKey":"", "label":""}}],
  "baseColumns": [{{"fieldKey":"", "label":""}}],
  "repeatGroups": [{{"groupKey":"vendors", "label":"업체별 견적", "repeatBy":"vendor", "columns":[{{"fieldKey":"unit_price", "label":"단가"}}, {{"fieldKey":"amount", "label":"금액"}}]}}],
  "summaryColumns": [{{"fieldKey":"", "label":""}}],
  "reason": "",
  "confidence": 0.0
}}

입력 데이터:
{json.dumps(data, ensure_ascii=False)}
""".strip()


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

    requested_layout = str(raw.get("layout") or raw.get("layoutType") or fallback.get("layout") or "")
    normalized_layout = normalize_layout_for_renderer(requested_layout)
    final_layout = "AI_GENERATED_DYNAMIC_VENDOR_TABLE" if repeat_groups and ("VENDOR" in normalized_layout or "DYNAMIC" in normalized_layout or "COMPARISON" in normalized_layout) else (normalized_layout or fallback.get("layout") or "AI_GENERATED_TABLE")

    return {
        "templateName": str(raw.get("templateName") or fallback["templateName"])[:80],
        "templateType": str(raw.get("templateType") or raw.get("layoutType") or fallback["templateType"])[:80],
        "sheetName": str(raw.get("sheetName") or fallback["sheetName"])[:31],
        "title": str(raw.get("title") or fallback["title"])[:120],
        "layout": final_layout,
        "headerFields": safe_list(raw.get("headerFields"), fallback.get("headerFields", [])),
        "baseColumns": safe_list(raw.get("baseColumns"), fallback.get("baseColumns", []))[:20],
        "repeatGroups": repeat_groups,
        "summaryColumns": safe_list(raw.get("summaryColumns"), fallback.get("summaryColumns", []))[:8],
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
        raw = await call_local_llm_json(_build_prompt(payload), cfg)
        return _sanitize_llm_design(raw, payload)
    except Exception as exc:  # noqa: BLE001 - 로컬 LLM이 늦거나 JSON 실패 시 규칙 기반 fallback 필요
        fallback["llmError"] = str(exc)[:400]
        fallback["generatedBy"] = "rule-fallback"
        return fallback
