from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from app.services.llm_client import call_llm_json, get_llm_config
from app.services.llm.prompt_loader import load_prompt
from app.services.llm.prompt_builder import build_prompt

logger = logging.getLogger("app.chat_service")


def _chat_llm_enabled() -> bool:
    raw = os.getenv("CHAT_LLM_ENABLED", "true")
    return raw.strip().lower() in {"1", "true", "y", "yes", "on"}


def _num(value: Any) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", str(value or ""))
    if not cleaned:
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _has_document(context: Optional[Dict[str, Any]]) -> bool:
    context = context or {}
    if context.get("hasDocument") is True or context.get("hasJob") is True:
        return True
    analysis = context.get("analysis") or {}
    table = context.get("table") or {}
    rows = table.get("rows") if isinstance(table, dict) else []
    doc_type = str(analysis.get("documentType") or analysis.get("document_type") or "").strip()
    if doc_type and doc_type not in {"대기", "문서 분석 대기", "미분석"}:
        return True
    return bool(rows)


_NARRATIVE_REPORT_PATTERNS = [
    "검토보고서", "검토 보고서", "내부 보고", "업무보고서", "회사 보고서",
    "보고서 형식", "보고서로 작성", "보고서로 정리", "보고서 형태",
    "내부 검토", "결재용", "검토보고", "보고서 작성", "업무보고",
    "보고서처럼", "보고서 느낌", "회사 내부 검토", "보고서 양식", "보고서양식",
    "핵심내용 보고", "핵심 내용이 잘 보이게", "결재 올릴", "상신용",
    "보고서로", "보고서 형태로", "보고서양식으로", "보고양식", "보고 형식",
    "핵심내용보고", "핵심보고", "내부보고서", "내부검토보고",
]

_FORMAT_CHANGE_MAP = {
    r"회의록": "MEETING_MINUTES",
    r"공문": "OFFICIAL_LETTER",
    r"비교표|비교견적서|업체별\s*비교|단가비교표|가격비교표": "VENDOR_COMPARISON",
    r"견적서": "SINGLE_ESTIMATE",
    r"계약서|협약서": "CONTRACT",
    r"점검표|점검보고서|감리보고": "INSPECTION_REPORT",
    r"공정보고|진도보고|월간보고|주간보고": "PROGRESS_REPORT",
    r"발주서|구매요청": "PURCHASE_ORDER",
    r"품의서|기안": "APPROVAL_REQUEST",
}

_FORMAT_LABELS = {
    "NARRATIVE_REPORT": "검토보고서",
    "MEETING_MINUTES": "회의록",
    "OFFICIAL_LETTER": "공문",
    "VENDOR_COMPARISON": "업체별 단가 비교표",
    "SINGLE_ESTIMATE": "견적서",
    "CONTRACT": "계약서",
    "INSPECTION_REPORT": "점검보고서",
    "PROGRESS_REPORT": "공정보고서",
    "PURCHASE_ORDER": "발주서",
    "APPROVAL_REQUEST": "품의서",
    "GENERAL_TABLE": "일반 업무표",
}

_FORMAT_DEFAULT_COLUMNS = {
    "MEETING_MINUTES": [
        {"key": "agenda_no", "label": "안건번호", "dataType": "text", "width": 80},
        {"key": "agenda_title", "label": "안건명", "dataType": "text", "width": 180},
        {"key": "discussion", "label": "토의내용", "dataType": "text", "width": 220},
        {"key": "decision", "label": "결정사항", "dataType": "text", "width": 200},
        {"key": "department", "label": "담당부서", "dataType": "text", "width": 100},
        {"key": "assignee", "label": "담당자", "dataType": "text", "width": 90},
        {"key": "due_date", "label": "완료기한", "dataType": "date", "width": 100},
        {"key": "remark", "label": "비고", "dataType": "text", "width": 120},
    ],
    "OFFICIAL_LETTER": [
        {"key": "section", "label": "항목", "dataType": "text", "width": 120},
        {"key": "content", "label": "내용", "dataType": "text", "width": 400},
        {"key": "remark", "label": "비고", "dataType": "text", "width": 120},
    ],
    "INSPECTION_REPORT": [
        {"key": "no", "label": "NO", "dataType": "number", "width": 60},
        {"key": "check_item", "label": "점검항목", "dataType": "text", "width": 180},
        {"key": "result", "label": "점검결과", "dataType": "text", "width": 150},
        {"key": "judgment", "label": "판정", "dataType": "text", "width": 80},
        {"key": "defect", "label": "불량내용", "dataType": "text", "width": 180},
        {"key": "action", "label": "조치사항", "dataType": "text", "width": 180},
        {"key": "inspector", "label": "점검자", "dataType": "text", "width": 90},
        {"key": "check_date", "label": "점검일", "dataType": "date", "width": 100},
    ],
    "PROGRESS_REPORT": [
        {"key": "work_type", "label": "공종명", "dataType": "text", "width": 150},
        {"key": "planned_rate", "label": "계획공정률", "dataType": "percent", "width": 100},
        {"key": "actual_rate", "label": "실적공정률", "dataType": "percent", "width": 100},
        {"key": "diff", "label": "차이", "dataType": "percent", "width": 80},
        {"key": "delay_reason", "label": "지연사유", "dataType": "text", "width": 200},
        {"key": "action_plan", "label": "조치계획", "dataType": "text", "width": 200},
    ],
    "NARRATIVE_REPORT": [
        {"key": "section", "label": "항목", "dataType": "text", "width": 140},
        {"key": "content", "label": "내용", "dataType": "text", "width": 300},
        {"key": "issue", "label": "문제점", "dataType": "text", "width": 200},
        {"key": "action", "label": "조치사항", "dataType": "text", "width": 200},
        {"key": "assignee", "label": "담당자", "dataType": "text", "width": 90},
        {"key": "due_date", "label": "완료기한", "dataType": "date", "width": 100},
    ],
}

_FORMAT_THEMES = {
    "MEETING_MINUTES": {"titleBg": "#0f4c3a", "titleColor": "#ffffff", "headerBg": "#ccfbf1", "headerColor": "#0f4c3a", "rowBg": "#ffffff", "altRowBg": "#f0fdfa", "rowColor": "#374151", "borderColor": "#e2e8f0"},
    "OFFICIAL_LETTER": {"titleBg": "#3b0764", "titleColor": "#ffffff", "headerBg": "#f3e8ff", "headerColor": "#3b0764", "rowBg": "#ffffff", "altRowBg": "#faf5ff", "rowColor": "#374151", "borderColor": "#e2e8f0"},
    "INSPECTION_REPORT": {"titleBg": "#7f1d1d", "titleColor": "#ffffff", "headerBg": "#fee2e2", "headerColor": "#7f1d1d", "rowBg": "#ffffff", "altRowBg": "#fff7f7", "rowColor": "#374151", "borderColor": "#e2e8f0"},
    "PROGRESS_REPORT": {"titleBg": "#1e40af", "titleColor": "#ffffff", "headerBg": "#dbeafe", "headerColor": "#1e3a8a", "rowBg": "#ffffff", "altRowBg": "#eff6ff", "rowColor": "#1e3a8a", "borderColor": "#e2e8f0"},
    "NARRATIVE_REPORT": {"titleBg": "#1e3a5f", "titleColor": "#ffffff", "headerBg": "#dbeafe", "headerColor": "#1e3a5f", "rowBg": "#ffffff", "altRowBg": "#f8fafc", "rowColor": "#334155", "borderColor": "#e2e8f0"},
    "VENDOR_COMPARISON": {"titleBg": "#1e293b", "titleColor": "#ffffff", "headerBg": "#f1f5f9", "headerColor": "#0f172a", "rowBg": "#ffffff", "altRowBg": "#f8fafc", "rowColor": "#334155", "borderColor": "#e2e8f0"},
    "SINGLE_ESTIMATE": {"titleBg": "#064e3b", "titleColor": "#ffffff", "headerBg": "#d1fae5", "headerColor": "#064e3b", "rowBg": "#ffffff", "altRowBg": "#f0fdf4", "rowColor": "#1f2937", "borderColor": "#e2e8f0"},
    "GENERAL_TABLE": {"titleBg": "#374151", "titleColor": "#ffffff", "headerBg": "#f3f4f6", "headerColor": "#111827", "rowBg": "#ffffff", "altRowBg": "#f9fafb", "rowColor": "#374151", "borderColor": "#e2e8f0"},
}


def _clean_inline_vendor_name(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r'^(각각|각|기준으로|대상으로)\s*', '', text)
    text = re.sub(r'\s*(이|가)?\s*\d+\s*개\s*(업체|회사|개사).*$', '', text)
    text = re.sub(r'\s*(업체|회사)$', '', text)
    text = text.strip(' ,·ㆍ/\t\r\n')
    if re.search(r'업체\s*단가\s*비교|단가\s*비교|비교표|대분류|중분류|소분류|최저|최고|비고', text):
        return ''
    return text

def _parse_vendor_table_request(message: str) -> Optional[Dict[str, Any]]:
    """
    업체/품목/수량을 명시한 단가 비교표 생성 요청을 파싱한다.

    지원 형식:
      A) "item1 수량 40개, item2 수량 50개" — 품목별 수량 개별 명시
      B) "item1, item2 각각 수량 40개, 50개" — 품목 목록 후 수량 나열
      C) "item1, item2 수량 40개" — 전체 동일 수량

    업체명은 "업체" 키워드 앞 콤마 구분 목록에서 추출한다.
    파싱 실패 시 None 반환.
    """
    text = message.strip()

    # ── 업체명 추출 ─────────────────────────────────────────────────
    vendor_match = re.search(
        r'([가-힣A-Za-z0-9㈜\(\)\s]+(?:\s*,\s*[가-힣A-Za-z0-9㈜\(\)\s]+)+)'
        r'\s*(?:이?\s*\d+\s*개?\s*업체|업체)',
        text,
    )
    if not vendor_match:
        return None
    vendors_raw = vendor_match.group(1)
    vendors = []
    seen_vendor_keys = set()
    for raw_vendor in re.split(r'\s*,\s*', vendors_raw):
        cleaned_vendor = _clean_inline_vendor_name(raw_vendor)
        key = re.sub(r'[\s㈜()（）주식회사._,·ㆍ-]+', '', cleaned_vendor).lower()
        if cleaned_vendor and key and key not in seen_vendor_keys:
            vendors.append(cleaned_vendor)
            seen_vendor_keys.add(key)
    if not vendors:
        return None

    remainder = text[vendor_match.end():]

    # 업체 수 숫자 (예: "2개업체" → {2}) — 수량 필터링에 사용
    vendor_count_nums = re.findall(r'(\d+)\s*개\s*업체', text)
    vendor_count_set = {int(n) for n in vendor_count_nums}

    items: List[str] = []
    quantities: List[Optional[int]] = []

    # ── 방법 A: "품목 수량 N개" 패턴 — 공백 없는 품목명 한정 ────────────
    # 예) "진공차단기(VCB)설치 수량 40개 , 저압배전반(MDB)설치 수량 50개"
    # 주의: 품목명 그룹에 공백을 허용하면 "수량"이 먹혀 매칭 실패함 → 공백 불허
    per_item_pairs = re.findall(
        r'([가-힣A-Za-z0-9\(\)（）\/]+)'   # 공백 없는 품목명
        r'\s+수량\s+(\d+)\s*개',
        remainder,
    )
    # "2개" 같은 숫자만 있는 항목 제거
    per_item_pairs = [(n, q) for n, q in per_item_pairs if re.search(r'[가-힣]', n)]
    if len(per_item_pairs) >= 2:
        for name, qty in per_item_pairs:
            items.append(name.strip())
            quantities.append(int(qty))

    # ── 방법 B/C: 품목 목록 + 수량 나열 ──────────────────────────────
    if not items:
        item_block_match = re.search(
            r'([가-힣A-Za-z0-9\(\)\s\/]+(?:\s*,\s*[가-힣A-Za-z0-9\(\)\s\/]+)+)'
            r'(?=\s*(?:각각|수량|\d+개))',
            remainder,
        )
        if not item_block_match:
            return None
        items = [i.strip() for i in re.split(r'\s*,\s*', item_block_match.group(1)) if i.strip()]
        if not items:
            return None

        # 수량 숫자 추출 (업체 수 제외)
        qty_nums = re.findall(r'(\d+)\s*개', remainder)
        raw_qtys = [int(q) for q in qty_nums if 0 < int(q) < 10000 and int(q) not in vendor_count_set]

        if len(raw_qtys) == 1:
            quantities = [raw_qtys[0]] * len(items)
        else:
            quantities = raw_qtys[: len(items)]
            while len(quantities) < len(items):
                quantities.append(None)

    # ── 컬럼 빌드 ──────────────────────────────────────────────────
    columns = [
        {"key": "row_no", "label": "NO", "dataType": "number", "width": 50},
        {"key": "item_name", "label": "품명", "dataType": "text", "width": 180},
        {"key": "spec", "label": "규격", "dataType": "text", "width": 120},
        {"key": "quantity", "label": "수량", "dataType": "number", "width": 70},
        {"key": "unit", "label": "단위", "dataType": "text", "width": 60},
    ]
    meta_vendors = []
    for vi, vname in enumerate(vendors):
        price_key = f"vendor_{vi + 1}_unit_price"
        amount_key = f"vendor_{vi + 1}_amount"
        columns.append({"key": price_key, "label": f"{vname} 단가", "dataType": "number", "width": 100})
        columns.append({"key": amount_key, "label": f"{vname} 금액", "dataType": "number", "width": 110})
        meta_vendors.append({"name": vname, "index": vi, "unitPriceKey": price_key, "amountKey": amount_key})

    # ── 행 빌드 (품목별 수량 개별 적용) ────────────────────────────
    rows = []
    for ri, item in enumerate(items):
        row: Dict[str, Any] = {
            "row_no": ri + 1,
            "item_name": item,
            "spec": "",
            "quantity": quantities[ri],  # None이면 빈칸으로 표시됨
            "unit": "식",
        }
        for vi, vname in enumerate(vendors):
            row[f"vendor_{vi + 1}_unit_price"] = None
            row[f"vendor_{vi + 1}_amount"] = None
        rows.append(row)

    return {
        "tableType": "MULTI_VENDOR_PRICE_COMPARISON",
        "tableName": "업체별 단가 비교표",
        "columns": columns,
        "rows": rows,
        "tableJson": {"meta": {"vendors": meta_vendors}},
        "theme": _FORMAT_THEMES.get("VENDOR_COMPARISON", {}),
    }


def _detect_intent(message: str) -> str:
    text = (message or "").strip().lower()
    original = (message or "").strip()
    if re.search(r"(너는|넌).*(뭐|무엇|누구|하는|할 수)|뭐하는\s*(ai|에이아이)|기능|도와줄|할수있|할 수 있|소개", text, re.I):
        return "SELF_INTRO"
    if re.search(r"^(안녕|하이|hello|hi|반가워|ㅎㅇ)\b|안녕하세요", text, re.I):
        return "GREETING"
    if any(kw in original for kw in _NARRATIVE_REPORT_PATTERNS):
        return "NARRATIVE_REPORT"
    for pattern in _FORMAT_CHANGE_MAP:
        if re.search(pattern, text, re.I):
            return "FORMAT_REQUEST"
    if re.search(r"단가|비교|최저|가격|견적", text, re.I):
        return "PRICE_COMPARE"
    if re.search(r"이\s*문서|문서\s*(뭐|무슨|요약|내용)|뭐야|무슨\s*문서|내용|요약", text, re.I):
        return "DOCUMENT_QA"
    if re.search(r"확인|오류|문제|검토|이슈|누락", text, re.I):
        return "ISSUE_CHECK"
    if re.search(r"표|테이블|정리", text, re.I):
        return "TABLE_CREATE"
    if re.search(r"엑셀|xlsx|양식|산출", text, re.I):
        return "EXCEL_CREATE"
    return "GENERAL"


def _detect_target_format(message: str) -> str:
    text = (message or "").strip()
    if any(kw in text for kw in _NARRATIVE_REPORT_PATTERNS):
        return "NARRATIVE_REPORT"
    for pattern, fmt in _FORMAT_CHANGE_MAP.items():
        if re.search(pattern, text, re.I):
            return fmt
    return "GENERAL_TABLE"


def _build_new_table_for_format(target_format: str, existing_rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """FORMAT_REQUEST 시 기존 데이터를 새 포맷의 테이블로 재구성"""
    cols = _FORMAT_DEFAULT_COLUMNS.get(target_format)
    if not cols:
        return None
    theme = _FORMAT_THEMES.get(target_format, _FORMAT_THEMES["GENERAL_TABLE"])
    col_keys = [c["key"] for c in cols]
    new_rows = []
    for i, old_row in enumerate(existing_rows[:40]):
        new_row = {}
        for key in col_keys:
            val = old_row.get(key) or old_row.get("item_name") if key in ("section", "check_item", "agenda_title", "work_type") else old_row.get(key)
            new_row[key] = val or None
        new_rows.append(new_row)
    if not new_rows:
        new_rows = [{k: None for k in col_keys}]
    return {
        "tableType": target_format,
        "tableName": _FORMAT_LABELS.get(target_format, "변환된 표"),
        "columns": cols,
        "rows": new_rows,
        "theme": theme,
    }


def _fallback_answer(message: str, context: Optional[Dict[str, Any]] = None, llm_error: str = "") -> Dict[str, Any]:
    context = context or {}
    msg = (message or "").strip()
    intent = _detect_intent(msg)
    has_document = _has_document(context)
    analysis = context.get("analysis") or {}
    table = context.get("table") or {}
    rows = table.get("rows") or []
    issues = context.get("issues") or []

    base = {
        "llmUsed": False,
        "llmFallback": bool(llm_error),
        "llmError": llm_error,
        "model": "rule-chat-fallback" if llm_error else "rule-chat",
        "newTable": None,
    }

    if intent == "NARRATIVE_REPORT":
        return {
            **base,
            "answer": "검토보고서 형식으로 문서를 분석하여 엑셀로 생성합니다. 개요·검토 배경·주요 현황·핵심 쟁점·비용/일정·부서별 조치·리스크·종합의견 순으로 구성됩니다.",
            "intent": "NARRATIVE_REPORT",
            "needsFile": not has_document,
            "action": "GENERATE_EXCEL" if has_document else "REQUEST_FILE",
            "targetFormat": "NARRATIVE_REPORT",
            "recommendedTab": "excel",
            "quickReplies": ["어떤 섹션이 포함되나요?", "보고서 내용 확인", "다운로드"],
        }

    if intent == "FORMAT_REQUEST":
        target_format = _detect_target_format(msg)
        label = _FORMAT_LABELS.get(target_format, "문서")
        new_table = _build_new_table_for_format(target_format, rows) if has_document else None
        return {
            **base,
            "answer": f"{label} 형식으로 변환합니다. 표 구조가 {label}에 맞게 재구성됩니다.",
            "intent": "FORMAT_REQUEST",
            "needsFile": not has_document,
            "action": "GENERATE_EXCEL" if has_document else "REQUEST_FILE",
            "targetFormat": target_format,
            "recommendedTab": "excel",
            "newTable": new_table,
            "quickReplies": ["엑셀 다운로드", "다른 양식으로", "원래 형식으로"],
        }

    # ── 인라인 테이블 생성 (파일 없이 업체/품목/수량 직접 지정) ────────────────
    if intent in {"TABLE_CREATE", "PRICE_COMPARE", "FORMAT_REQUEST", "GENERAL"}:
        inline_table = _parse_vendor_table_request(msg)
        if inline_table:
            vendor_count = len((inline_table.get("tableJson") or {}).get("meta", {}).get("vendors") or [])
            item_count = len(inline_table.get("rows") or [])
            return {
                **base,
                "answer": (
                    f"업체 {vendor_count}개, 품목 {item_count}개 기준으로 단가 비교표를 생성했습니다. "
                    "단가와 금액을 직접 입력하거나, 견적 파일을 첨부하면 자동으로 채워집니다."
                ),
                "intent": "TABLE_CREATE",
                "needsFile": False,
                "action": "GENERATE_EXCEL",
                "targetFormat": "VENDOR_COMPARISON",
                "recommendedTab": "excel",
                "newTable": inline_table,
                "quickReplies": ["파일 첨부해서 단가 채우기", "엑셀 다운로드", "업체/품목 변경"],
            }

    if intent in {"GREETING", "SELF_INTRO"}:
        answer = (
            "안녕하세요! 저는 업무 문서를 엑셀·보고서로 자동 변환하는 AI 어시스턴트입니다. "
            "PDF·엑셀·문서 파일을 업로드하면 문서 유형 분류, 표 추출, 단가 비교, 보고서 작성, 회의록·공문 형식 변환까지 도와드립니다."
        )
        if has_document:
            answer += " 현재 분석된 문서 기준으로 바로 질문해 주세요."
        return {
            **base,
            "answer": answer,
            "intent": intent,
            "needsFile": False,
            "action": "NONE",
            "recommendedTab": None,
            "quickReplies": ["이 문서 뭐야?", "보고서로 만들어줘", "단가 비교해줘"],
        }

    if intent == "DOCUMENT_QA":
        if has_document:
            doc_type = analysis.get("documentType") or analysis.get("document_type") or "업무 문서"
            summary = analysis.get("summary") or "분석 요약이 없습니다."
            answer = f"현재 문서는 {doc_type}입니다. {summary}"
            if issues:
                answer += f" 확인 필요 항목은 {len(issues)}건입니다."
            return {
                **base,
                "answer": answer,
                "intent": "DOCUMENT_QA",
                "needsFile": False,
                "action": "SHOW_ANALYSIS",
                "recommendedTab": "analysis",
                "quickReplies": ["표로 만들어줘", "보고서로 만들어줘", "단가 비교해줘"],
            }
        return {
            **base,
            "answer": "아직 분석된 문서가 없습니다. PDF나 엑셀 파일을 첨부한 뒤 분석을 실행하면 문서 유형과 핵심 내용을 답변할 수 있습니다.",
            "intent": "DOCUMENT_QA",
            "needsFile": True,
            "action": "REQUEST_FILE",
            "recommendedTab": None,
            "quickReplies": ["파일 첨부", "분석 실행"],
        }

    if intent == "PRICE_COMPARE":
        if not rows:
            return {
                **base,
                "answer": "비교할 표 데이터가 아직 없습니다. 파일을 첨부하고 분석을 실행하면 품목별 단가를 비교할 수 있습니다.",
                "intent": "PRICE_COMPARE",
                "needsFile": True,
                "action": "REQUEST_FILE",
                "recommendedTab": None,
                "quickReplies": ["파일 첨부", "표로 만들어줘"],
            }
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for row in rows:
            item = str(row.get("item_name") or row.get("품목명") or "").strip()
            if item:
                grouped.setdefault(item, []).append(row)
        lines: List[str] = []
        for item, item_rows in list(grouped.items())[:8]:
            valid = []
            for row in item_rows:
                unit_price = _num(row.get("unit_price") or row.get("단가"))
                unit = str(row.get("unit_normalized") or row.get("unit") or "").strip()
                vendor = str(row.get("vendor_name") or row.get("업체명") or "업체 미상").strip()
                if unit_price > 0:
                    valid.append((unit_price, vendor, unit))
            if not valid:
                continue
            units = {unit for _, _, unit in valid if unit}
            if len(units) >= 2:
                lines.append(f"- {item}: 단위가 달라 환산 기준 확인 필요 ({', '.join(sorted(units))})")
            else:
                best = min(valid, key=lambda x: x[0])
                lines.append(f"- {item}: 최저단가 {best[1]} / {best[0]:,.0f}원/{best[2] or '단위 미상'}")
        return {
            **base,
            "answer": "단가 비교 결과입니다.\n" + ("\n".join(lines) if lines else "단가 값이 부족하여 최저가를 확정할 수 없습니다."),
            "intent": "PRICE_COMPARE",
            "needsFile": False,
            "action": "SHOW_TABLE",
            "recommendedTab": "excel",
            "quickReplies": ["금액 다시 확인", "확인 필요한 부분만", "엑셀 다운로드"],
        }

    if intent == "ISSUE_CHECK":
        if issues:
            issue_lines = "\n".join([f"- {issue.get('message', '확인 필요')}" for issue in issues[:8]])
            answer = f"확인 필요 항목은 {len(issues)}건입니다.\n{issue_lines}"
        else:
            answer = "현재 확인 필요 항목이 없습니다. 문서가 아직 분석되지 않았다면 파일 분석 후 확인할 수 있습니다."
        return {
            **base,
            "answer": answer,
            "intent": "ISSUE_CHECK",
            "needsFile": not has_document,
            "action": "SHOW_ANALYSIS" if has_document else "REQUEST_FILE",
            "recommendedTab": "analysis" if has_document else None,
            "quickReplies": ["단가 비교해줘", "표로 만들어줘"],
        }

    return {
        **base,
        "answer": ("요청을 확인했습니다. 현재 분석된 문서 기준으로 이어서 처리할 수 있습니다." if has_document
                   else "요청을 확인했습니다. 문서 파일을 첨부하면 표 추출, 단가 비교, 금액 검증, 엑셀 생성 흐름으로 도와드릴 수 있습니다."),
        "intent": intent,
        "needsFile": not has_document,
        "action": "NONE",
        "recommendedTab": "analysis" if has_document else None,
        "quickReplies": ["이 문서 뭐야?", "단가 비교해줘", "보고서로 만들어줘"],
    }


def _build_chat_prompt(message: str, context: Optional[Dict[str, Any]]) -> str:
    context = context or {}
    intent_hint = _detect_intent(message)
    has_document = _has_document(context)
    table = context.get("table") or {}
    analysis = context.get("analysis") if has_document else None
    compact_context = {
        "hasDocument": has_document,
        "documentState": context.get("documentState") or ("ANALYZED" if has_document else "NO_ANALYZED_DOCUMENT"),
        "intentHint": intent_hint,
        "analysis": analysis or None,
        "table": {
            "tableName": table.get("tableName"),
            "tableType": table.get("tableType"),
            "columns": table.get("columns") or [],
            "rows": (table.get("rows") or [])[:60],
        } if has_document or table.get("rows") else None,
        "issues": (context.get("issues") or [])[:30] if has_document else [],
        "selectedTemplate": context.get("selectedTemplate") or None,
        "outputMode": context.get("outputMode") or None,
    }
    context_json = json.dumps(compact_context, ensure_ascii=False, default=str)
    try:
        template = load_prompt("chat_answer_builder")
        return build_prompt(template, USER_MESSAGE=message, CONTEXT_JSON=context_json)
    except Exception:
        # 폴백: 기본 프롬프트
        return f"[사용자 메시지]\n{message}\n\n[컨텍스트]\n{context_json}\n\n반드시 JSON 객체 1개만 반환. answer, intent, action, targetFormat, recommendedTab, newTable, quickReplies 필드 포함."


def _guard_bad_repeated_answer(result: Dict[str, Any], message: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    intent = _detect_intent(message)
    msg = str(message or "")
    answer = str(result.get("answer") or "")
    if intent in {"GREETING", "SELF_INTRO"} and re.search(r"분석할 문서|분석된 문서|파일을 첨부|분석을 실행", answer):
        corrected = _fallback_answer(message, context)
        corrected["llmUsed"] = False
        corrected["llmFallback"] = True
        corrected["llmError"] = "LLM 답변이 일반 질문 의도와 맞지 않아 보정했습니다."
        corrected["model"] = "rule-chat-guard"
        return corrected
    asked_date = re.search(r"오늘|날짜|몇\s*일|date", msg, re.I)
    if not asked_date and re.search(r"오늘은\s*[0-9]{4}년\s*[0-9]{1,2}월\s*[0-9]{1,2}일", answer):
        corrected = _fallback_answer(message, context)
        corrected["llmUsed"] = False
        corrected["llmFallback"] = True
        corrected["llmError"] = "LLM이 제공되지 않은 현재 날짜를 임의 생성하여 보정했습니다."
        corrected["model"] = "rule-chat-date-guard"
        return corrected
    return result


def _try_patch_quantity(
    message: str,
    existing_rows: List[Dict[str, Any]],
    table: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    "저압배전반만 수량 50개로 고쳐줘" 같은 요청을 파싱해서
    전체 행을 유지하되 해당 품목의 quantity만 변경한다.
    변경이 없으면 None 반환.

    품목 매칭: 기존 행의 item_name이 메시지 안에 직접 포함되는지 비교.
    "설치" 같은 공통 단어 추출 대신 item_name 전체를 역방향으로 검색한다.
    """
    # 수량 숫자 추출
    qty_m = re.search(r'수량\s*(\d+)\s*개?|(\d+)\s*개(?:로|으로)', message)
    if not qty_m:
        return None
    new_qty = int(qty_m.group(1) or qty_m.group(2))

    # "전체", "모두" → 모든 행 변경
    all_pattern = bool(re.search(r'전체|모두|모든\s*(?:항목|품목)|다\s*(?:수량|바꿔|변경)', message))

    # 기존 행의 item_name이 메시지에 직접 등장하는지 체크
    matched_indices: List[int] = []
    if not all_pattern:
        for i, row in enumerate(existing_rows):
            item_name = str(
                row.get("item_name") or row.get("work_item_name") or
                row.get("product_name") or row.get("material_name") or ""
            ).strip()
            # 전략1: item_name 전체가 메시지에 있으면 매칭
            if item_name and item_name in message:
                matched_indices.append(i)
                continue
            # 전략2: 괄호 코드 제거한 핵심 명칭이 메시지에 있으면 매칭
            core = re.sub(r'\([^)]*\)', '', item_name).strip()
            if core and len(core) >= 3 and core in message:
                matched_indices.append(i)
            # 전략3(제거됨): 공통 단어("설치" 등)가 매칭되어 전체 행 변경되는 문제 방지

    # 매칭된 품목 없음 → LLM에게 위임 (패치 안 함)
    if not matched_indices and not all_pattern:
        return None

    patched_rows = []
    changed = 0
    for i, row in enumerate(existing_rows):
        if all_pattern or (i in matched_indices):
            patched_rows.append({**row, "quantity": new_qty})
            changed += 1
        else:
            patched_rows.append(row)

    if changed == 0:
        return None

    if all_pattern:
        scope = f"전체 {changed}개 품목"
    else:
        first_name = str(existing_rows[matched_indices[0]].get("item_name") or "")
        scope = f"'{first_name}' 포함 {changed}행"

    return {
        "changed": changed,
        "answer": f"{scope}의 수량을 {new_qty}개로 변경했습니다. 전체 {len(patched_rows)}행이 유지됩니다.",
        "table": {
            "tableType": table.get("tableType") or "MULTI_VENDOR_PRICE_COMPARISON",
            "tableName": table.get("tableName") or "업체별 단가 비교표",
            "columns": table.get("columns") or [],
            "rows": patched_rows,
            "tableJson": table.get("tableJson") or {},
        },
    }


async def answer_chat(message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    msg = (message or "").strip()
    if not msg:
        return _fallback_answer("", context)

    ctx = context or {}
    has_doc = _has_document(ctx)
    doc_analysis = ctx.get("analysis") or {}
    doc_type = doc_analysis.get("documentType") or doc_analysis.get("document_type") or ""
    table = ctx.get("table") or {}
    existing_rows = table.get("rows") or []
    row_count = len(existing_rows)
    file_profiles = doc_analysis.get("fileProfiles") or []
    file_names = [fp.get("fileName", "") for fp in file_profiles if fp.get("fileName")]

    if has_doc:
        logger.info(
            "[채팅 문서 컨텍스트 활용 중] 문서유형=%s | 표 행수=%d | 파일=%s | 질문=%s",
            doc_type or "미분류", row_count,
            ", ".join(file_names) if file_names else "정보없음",
            msg[:80],
        )
    else:
        logger.info("[채팅 문서 컨텍스트 없음] 질문=%s", msg[:80])

    # ── 룰 기반 처리 (LLM보다 먼저) ──────────────────────────────────────────

    # 1) 인라인 비교표 생성: 업체/품목/수량을 명시한 경우 → LLM 없이 바로 생성
    inline_table = _parse_vendor_table_request(msg)
    if inline_table:
        vendor_count = len((inline_table.get("tableJson") or {}).get("meta", {}).get("vendors") or [])
        item_count = len(inline_table.get("rows") or [])
        logger.info("[인라인 테이블 생성] 업체=%d 품목=%d", vendor_count, item_count)
        return {
            "llmUsed": False,
            "llmFallback": False,
            "model": "rule-inline-table",
            "newTable": inline_table,
            "answer": (
                f"업체 {vendor_count}개, 품목 {item_count}개 기준으로 단가 비교표를 생성했습니다. "
                "단가·금액을 직접 입력하거나 파일을 첨부하면 자동으로 채워집니다."
            ),
            "intent": "TABLE_CREATE",
            "needsFile": False,
            "action": "GENERATE_EXCEL",
            "targetFormat": "VENDOR_COMPARISON",
            "recommendedTab": "excel",
            "quickReplies": ["파일 첨부해서 단가 채우기", "엑셀 다운로드", "수량 변경"],
        }

    # 2) 특정 품목 수량 patch: 기존 행 유지하며 해당 품목만 수량 변경
    if existing_rows:
        patched = _try_patch_quantity(msg, existing_rows, table)
        if patched:
            logger.info("[수량 patch 적용] 변경 행=%d / 전체=%d", patched["changed"], len(existing_rows))
            return {
                "llmUsed": False,
                "llmFallback": False,
                "model": "rule-qty-patch",
                "newTable": patched["table"],
                "answer": patched["answer"],
                "intent": "TABLE_CREATE",
                "needsFile": False,
                "action": "GENERATE_EXCEL",
                "targetFormat": "VENDOR_COMPARISON",
                "recommendedTab": "excel",
                "quickReplies": ["엑셀 다운로드", "다른 품목 수량 변경", "업체 추가"],
            }

    # ── LLM 처리 ──────────────────────────────────────────────────────────────
    if not _chat_llm_enabled():
        return _fallback_answer(msg, context, "CHAT_LLM_ENABLED=false")

    cfg = get_llm_config()
    if not cfg.enabled:
        return _fallback_answer(msg, context, "LLM_ENABLED=false")

    try:
        prompt = _build_chat_prompt(msg, context)
        result = await call_llm_json(prompt, cfg)
        answer = str(result.get("answer") or "").strip()
        if not answer:
            raise RuntimeError("LLM 응답 JSON에 answer가 없습니다.")

        new_table = result.get("newTable") or None
        intent = result.get("intent") or _detect_intent(msg)
        target_format = result.get("targetFormat") or None
        if intent == "FORMAT_REQUEST" and not new_table and has_doc and target_format:
            new_table = _build_new_table_for_format(target_format, existing_rows)

        chat_result = {
            "answer": answer,
            "intent": intent,
            "needsFile": bool(result.get("needsFile", False)),
            "action": result.get("action") or "NONE",
            "targetFormat": target_format,
            "recommendedTab": result.get("recommendedTab") or None,
            "newTable": new_table,
            "quickReplies": result.get("quickReplies") if isinstance(result.get("quickReplies"), list) else ["이 문서 뭐야?", "단가 비교해줘"],
            "llmUsed": True,
            "llmFallback": False,
            "model": f"gemini:{cfg.model}",
            "llmMeta": result.get("_llm", {}),
        }
        logger.info("[채팅 LLM 응답] intent=%s action=%s targetFormat=%s newTable=%s",
                    chat_result["intent"], chat_result["action"], chat_result["targetFormat"],
                    "있음" if chat_result["newTable"] else "없음")
        return _guard_bad_repeated_answer(chat_result, msg, context)
    except Exception as exc:
        logger.warning("[채팅 LLM 실패 → 룰 기반 폴백] %s", str(exc)[:120])
        return _fallback_answer(msg, context, str(exc))
