from __future__ import annotations

import re
from typing import Any, Dict, List

from app.services.unit_normalizer import clean_cell_text
from app.services.document_analyzer.table_utils import (
    compact_text,
    clean_number,
    to_number,
    DOCUMENT_TYPE_RULES,
)


# ---------------------------------------------------------------------------
# Document type detection helpers
# ---------------------------------------------------------------------------

def is_narrative_document(text: str) -> bool:
    compact = compact_text(text)
    narrative_markers = ["유스케이스", "usecase", "프로젝트개요", "actor정의", "mainflow", "alternativeflow", "businessrule", "kpi정의"]
    return sum(1 for marker in narrative_markers if marker in compact) >= 2


def is_reference_or_guideline_document(text: str) -> bool:
    compact = compact_text(text)
    markers = ["건축견적지침서", "지침서", "적용기준", "표준품셈", "품셈의정의", "적산및견적", "공사원가", "관계법령"]
    return sum(1 for marker in markers if compact_text(marker) in compact) >= 2


def is_standard_market_price_document(text: str) -> bool:
    compact = compact_text(text)
    markers = ["건설공사표준시장단가", "표준시장단가", "공종코드", "공종명칭", "노무비율"]
    return ("표준시장단가" in compact and "공종코드" in compact and "노무비율" in compact) or sum(1 for marker in markers if compact_text(marker) in compact) >= 3


def is_text_only_vendor_comparison_report(text: str) -> bool:
    compact = compact_text(text)
    has_compare_title = "업체별단가비교검토보고서" in compact or ("업체별" in compact and "단가비교" in compact and "검토보고서" in compact)
    has_text_only_policy = any(marker in compact for marker in ["텍스트전용", "문장형텍스트", "표형식자료를사용하지", "행열색상강조요약표등은모두제외", "문단형태로만기술"])
    has_vendor_totals = "총견적금액" in compact and "표준시장단가" in compact and "최저가" in compact
    return bool(has_compare_title and (has_text_only_policy or has_vendor_totals))


# ---------------------------------------------------------------------------
# Document profile
# ---------------------------------------------------------------------------

def infer_document_profile(text: str, user_request: str = "") -> Dict[str, Any]:
    """문서 유형을 키워드 하나로 과잉 분류하지 않고, 제목/구조 기반으로 보수적으로 판별한다."""
    lower = text.lower()
    compact = compact_text(text)

    if is_text_only_vendor_comparison_report(text):
        return {
            "documentType": "업체별 단가 비교 검토보고서",
            "purpose": "서술형 업체별 단가 비교 결과와 확인 필요 사항 검토",
            "confidence": 0.9,
        }

    if is_standard_market_price_document(text):
        return {
            "documentType": "표준시장단가표",
            "purpose": "공종별 표준시장단가 표 추출 및 단가 확인",
            "confidence": 0.9,
        }

    for doc_type, keywords in DOCUMENT_TYPE_RULES:
        score = sum(1 for kw in keywords if compact_text(kw) in compact or kw in lower)
        if score >= 2:
            return {
                "documentType": doc_type,
                "purpose": "문서 내용 분석 및 엑셀화 가능 여부 검토",
                "confidence": 0.86,
            }

    price_structural_score = 0
    for kw in ["품명", "품목", "규격", "수량", "단위", "단가", "금액", "공급가액", "합계"]:
        if kw in text:
            price_structural_score += 1
    request_price = any(word in (user_request or "") for word in ["단가", "견적", "비교", "가격"])
    if price_structural_score >= 5 and ("견적" in text or "단가" in text or request_price) and not is_reference_or_guideline_document(text):
        return {
            "documentType": "견적서/단가표",
            "purpose": "단가 및 금액 비교용 표 데이터 생성",
            "confidence": 0.82,
        }

    return {
        "documentType": "업무 문서",
        "purpose": "문서 내용 요약 및 표 데이터 추출 가능 여부 확인",
        "confidence": 0.68,
    }


# ---------------------------------------------------------------------------
# File profiles
# ---------------------------------------------------------------------------

def build_file_profiles(
    parsed_files: List[Dict[str, Any]],
    user_request: str = "",
    llm_intent: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """첨부파일별 유형/역할 요약을 만든다."""
    from app.services.document_analyzer.vendor_comparator import (
        _request_wants_company_comparison,
        _is_estimate_file,
        _is_standard_market_file,
        _extract_company_name,
    )
    from app.services.document_analyzer.table_utils import clean_number, to_number

    profiles: List[Dict[str, Any]] = []
    wants_compare = _request_wants_company_comparison(user_request, llm_intent)

    for index, file in enumerate(parsed_files or [], start=1):
        filename = str(file.get("originalName") or file.get("original_name") or file.get("filename") or f"파일{index}")
        text = str(file.get("extractedText") or file.get("extracted_text") or "")
        rows = [row for row in (file.get("parsedRows") or file.get("rows") or []) if isinstance(row, dict)]
        profile = infer_document_profile(text, user_request)
        company_name = _extract_company_name(filename, text, rows, index)
        page_count = int(file.get("pageCount") or file.get("page_count") or 0)
        char_count = len(text or "")
        row_count = len(rows or [])
        price_row_count = sum(
            1
            for row in rows
            if isinstance(row, dict)
            and clean_cell_text(row.get("item_name") or row.get("construction_code") or "")
            and any(to_number(row.get(key)) > 0 for key in ["vendor_unit_price", "unit_price", "amount", "standard_unit_price"])
        )

        document_type = str(profile.get("documentType") or "업무 문서")
        role = "SOURCE_DOCUMENT"
        role_label = "분석 대상 문서"
        confidence = float(profile.get("confidence") or 0.68)

        if wants_compare and _is_estimate_file(filename, text, rows, user_request=user_request, llm_intent=llm_intent):
            role = "COMPARE_TARGET"
            role_label = "비교 대상 견적서"
            document_type = "업체 견적서/단가표"
            confidence = max(confidence, 0.86)
        elif _is_standard_market_file(filename, text, rows, user_request=user_request, llm_intent=llm_intent):
            role = "REFERENCE_PRICE"
            role_label = "기준 단가 자료"
            document_type = "표준시장단가/기준단가 자료"
            confidence = max(confidence, 0.84)
        elif is_reference_or_guideline_document(text):
            role = "REFERENCE_GUIDELINE"
            role_label = "기준/지침 자료"
            document_type = "기준서/지침서"
            confidence = max(confidence, 0.8)

        summary_parts = [
            f"{page_count}페이지" if page_count else "페이지 미확인",
            f"표 후보 {row_count}행" if row_count else "표 후보 없음",
        ]
        if price_row_count:
            summary_parts.append(f"가격 행 {price_row_count}행")
        if company_name:
            summary_parts.append(f"업체명 {company_name}")

        profiles.append({
            "index": index,
            "fileName": filename,
            "companyName": company_name,
            "documentType": document_type,
            "role": role,
            "roleLabel": role_label,
            "pageCount": page_count,
            "charCount": char_count,
            "rowCount": row_count,
            "priceRowCount": price_row_count,
            "confidence": round(confidence, 4),
            "summary": " / ".join(summary_parts),
        })

    return profiles


# ---------------------------------------------------------------------------
# Key-value extraction
# ---------------------------------------------------------------------------

def extract_key_values_from_text(text: str) -> List[Dict[str, Any]]:
    patterns = [
        ("Use Case ID", r"Use\s*Case\s*ID\s*([^\n]+)"),
        ("Use Case 명", r"Use\s*Case\s*명\s*([^\n]+)"),
        ("업무 영역", r"업무\s*영역\s*([^\n]+)"),
        ("작성일", r"작성일\s*([0-9]{4}[-./][0-9]{2}[-./][0-9]{2}|[0-9]{4}[-./][0-9]{2}[-./][0-9]{1,2}|[^\n]{4,30})"),
        ("작성자", r"작성자\s*([^\n]+)"),
        ("우선순위", r"우선순위\s*([^\n]+)"),
        ("자동화 수준", r"자동화\s*수준\s*([^\n]+)"),
    ]
    result: List[Dict[str, Any]] = []
    seen = set()
    for label, pattern in patterns:
        m = re.search(pattern, text, re.I)
        if not m:
            continue
        value = re.sub(r"\s{2,}", " ", m.group(1).strip())[:160]
        value = re.split(r"\s+(?:Use\s*Case\s*명|업무\s*영역|작성일|작성자|관련\s*시스템|우선순위|자동화\s*수준|관련\s*KPI)", value)[0].strip()
        if value and (label, value) not in seen:
            result.append({"label": label, "value": value})
            seen.add((label, value))
    return result[:12]
