from __future__ import annotations

from typing import Any, Dict, List, Optional
import re

LAYOUT_REGISTRY: List[Dict[str, Any]] = [
    {"layoutType": "VENDOR_COMPARISON_REVIEW_FORM", "designId": "VENDOR_COMPARE_REVIEW_FORM_V1", "name": "업체별 단가 비교 검토보고서", "documentKind": "비교검토보고서", "title": "업체별 단가 비교 검토보고서", "family": "COMPARE_REPORT", "scoreBase": 94, "keywords": ["업체별", "단가 비교", "단가비교", "비교 검토보고서", "검토보고서", "표준시장단가", "최저가", "최고가", "총괄 비교 결과", "문장형", "텍스트 전용", "서술형"], "reason": "표가 없는 서술형 비교 문서의 핵심 비교 결과, 업체별 금액, 검토 의견, 확인 필요 사항을 보고서 형태로 정리합니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "PURPOSE", "EXECUTIVE_SUMMARY", "VENDOR_SUMMARY", "KEY_FINDINGS", "REVIEW_OPINION", "ACTION_PLAN", "APPROVAL_BOX"]},
    {"layoutType": "VENDOR_COMPARISON_TABLE", "designId": "VENDOR_COMPARE_V1", "name": "업체별 단가 비교표", "documentKind": "업체비교표", "title": "업체별 단가 비교표", "family": "COMPARE_TABLE", "scoreBase": 92, "keywords": ["업체별", "회사별", "비교견적", "견적비교", "단가 비교", "단가비교", "가격비교", "최저가", "최고가", "견적서", "비교표", "업체 견적", "표준시장단가"], "reason": "업체별 단가·금액을 비교하는 문서에 적합합니다. 원문이 문장형이면 업체명·금액·차이율을 문장 기반으로 추출해 표로 정리합니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "COMPARISON_TABLE", "REVIEW_OPINION"]},
    {"layoutType": "ESTIMATE_REVIEW_FORM", "designId": "ESTIMATE_FORM_V1", "name": "견적 검토서", "documentKind": "견적검토서", "title": "견적 검토서", "family": "ESTIMATE", "scoreBase": 82, "keywords": ["견적서", "견적", "공급가", "합계", "거래조건", "납기", "견적 검토"], "reason": "견적 기본정보, 세부 내역, 합계, 검토 의견을 함께 정리하는 견적 검토 양식입니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "DETAIL_TABLE", "COST_SUMMARY", "REVIEW_OPINION"]},
    {"layoutType": "PRICE_SURVEY_TABLE", "designId": "PRICE_TABLE_V1", "name": "단가 조사표", "documentKind": "단가표", "title": "단가 조사표", "family": "PRICE_TABLE", "scoreBase": 80, "keywords": ["단가표", "표준시장단가표", "공종단가표", "가격표", "단가 조사", "공종코드", "노무비율"], "reason": "공종코드, 품명, 규격, 단위, 단가가 행/열 구조로 있는 자료를 정리하는 단가 조사 양식입니다.", "sections": ["DOCUMENT_HEADER", "PRICE_TABLE", "ATTACHMENT_NOTE"]},
    {"layoutType": "REPORT_FORM", "designId": "REPORT_FORM_V1", "name": "업무 보고서", "documentKind": "보고서", "title": "업무 보고서", "family": "REPORT", "scoreBase": 78, "keywords": ["보고서", "보고", "검토", "현황", "요약", "분석", "결과"], "reason": "보고 목적, 주요 검토 내용, 검토 결과, 후속 조치를 균형 있게 배치하는 서술형 보고서 양식입니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "PURPOSE", "EXECUTIVE_SUMMARY", "KEY_FINDINGS", "REVIEW_OPINION", "ACTION_PLAN", "APPROVAL_BOX"]},
    {"layoutType": "REVIEW_OPINION_FORM", "designId": "REVIEW_OPINION_FORM_V1", "name": "검토 의견서", "documentKind": "검토의견서", "title": "검토 의견서", "family": "REPORT", "scoreBase": 74, "keywords": ["검토의견", "검토", "의견", "확인", "적정", "부적정", "보완", "재확인"], "reason": "검토 결과와 보완 필요사항을 핵심 위주로 정리하는 내부 검토용 양식입니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "KEY_FINDINGS", "ISSUES", "REVIEW_OPINION", "ACTION_PLAN"]},
    {"layoutType": "INSPECTION_REPORT", "designId": "INSPECTION_REPORT_V1", "name": "현장 점검 보고서", "documentKind": "점검보고서", "title": "현장 점검 보고서", "family": "INSPECTION", "scoreBase": 72, "keywords": ["현장 점검", "점검보고서", "안전점검", "감리 점검", "하자 점검", "시정조치", "현장 확인"], "reason": "점검 개요, 주요 확인사항, 문제점, 조치 계획을 중심으로 정리하는 회사 보고서 양식입니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "INSPECTION_SUMMARY", "KEY_FINDINGS", "ISSUES", "ACTION_PLAN", "APPROVAL_BOX"]},
    {"layoutType": "MEETING_MINUTES", "designId": "MEETING_MINUTES_V1", "name": "회의록", "documentKind": "회의록", "title": "회의록", "family": "MEETING", "scoreBase": 76, "keywords": ["회의록", "회의", "안건", "참석자", "결정사항", "조치사항", "담당자"], "reason": "회의 개요, 안건, 결정사항, 후속 조치와 담당자를 분리해 관리하는 회의록 양식입니다.", "sections": ["DOCUMENT_HEADER", "MEETING_INFO", "AGENDA", "DISCUSSION", "DECISIONS", "ACTION_ITEMS"]},
    {"layoutType": "OFFICIAL_LETTER", "designId": "OFFICIAL_LETTER_V1", "name": "공문", "documentKind": "공문", "title": "공문", "family": "OFFICIAL", "scoreBase": 74, "keywords": ["공문", "수신", "참조", "시행", "발신", "회신", "제출", "붙임"], "reason": "수신/참조/제목/본문/붙임 구조를 갖춘 대외·대내 공문 양식입니다.", "sections": ["DOCUMENT_HEADER", "RECIPIENT_INFO", "SUBJECT", "BODY", "ATTACHMENT_NOTE", "SENDER"]},
    {"layoutType": "WORK_DAILY_REPORT", "designId": "WORK_DAILY_REPORT_V1", "name": "작업일보", "documentKind": "작업일보", "title": "작업일보", "family": "WORK_LOG", "scoreBase": 72, "keywords": ["작업일보", "작업내용", "투입인원", "장비", "금일작업", "명일작업"], "reason": "일일 작업내용, 인원, 장비, 특이사항을 정리하는 현장 업무 양식입니다.", "sections": ["DOCUMENT_HEADER", "PROJECT_INFO", "CURRENT_STATUS", "DETAIL_TABLE", "ISSUES", "ACTION_PLAN"]},
    {"layoutType": "BASIC_TABLE", "designId": "BASIC_TABLE_V1", "name": "기본 표 양식", "documentKind": "일반표", "title": "데이터 정리표", "family": "BASIC", "scoreBase": 55, "keywords": ["표", "목록", "내역", "데이터"], "reason": "문서 유형이 불명확할 때 원본 데이터를 안전하게 편집하는 기본 표 양식입니다.", "sections": ["DOCUMENT_HEADER", "DETAIL_TABLE"]},
]


def normalize_layout_for_renderer(layout_type: str = "") -> str:
    layout = str(layout_type or "").upper()
    if layout == "VENDOR_COMPARISON_TABLE":
        return "AI_GENERATED_DYNAMIC_VENDOR_TABLE"
    if layout == "PRICE_SURVEY_TABLE":
        return "PRICE_TABLE"
    if layout == "ESTIMATE_REVIEW_FORM":
        return "ESTIMATE_FORM"
    if layout in {"VENDOR_COMPARISON_REVIEW_FORM", "INSPECTION_REPORT", "REVIEW_OPINION_FORM", "WORK_DAILY_REPORT"}:
        return "REPORT_FORM"
    return layout or "BASIC_TABLE"


def _has_meaningful_context(text: str = "") -> bool:
    raw = str(text or "").strip()
    if not raw:
        return False
    if re.search(r"대기|아직 분석된 문서|문서 분석 대기|파일 분석 후", raw, re.I):
        return False
    return len(raw) >= 8


def _compact(text: str = "") -> str:
    return re.sub(r"\s+", "", str(text or "").lower())


def _includes_any(text: str = "", patterns: List[str] | tuple[str, ...] = ()) -> bool:
    raw = str(text or "").lower()
    packed = _compact(text)
    for pattern in patterns:
        token = str(pattern or "").lower()
        if token in raw or re.sub(r"\s+", "", token) in packed:
            return True
    return False


def _family_of(layout_type: str = "") -> str:
    for item in LAYOUT_REGISTRY:
        if item.get("layoutType") == layout_type:
            return str(item.get("family") or "BASIC")
    return "BASIC"


def _infer_user_output_intent(text: str = "") -> str:
    raw = str(text or "")
    if _includes_any(raw, ["표로", "표 형태", "표 형식", "엑셀", "그리드", "비교표", "테이블"]):
        return "TABLE"
    if _includes_any(raw, ["보고서", "보고 형식", "업무보고서", "검토보고서", "서술형", "문장형", "핵심 내용"]):
        return "REPORT"
    return "AUTO"


def _analyze_context(text: str = "") -> Dict[str, Any]:
    raw = str(text or "")
    upper = raw.upper()
    has_meeting = "MEETING" in upper or _includes_any(raw, ["회의록", "회의", "안건", "참석자", "결정사항"])
    has_official = "OFFICIAL" in upper or _includes_any(raw, ["공문", "수신", "참조", "시행", "발신", "회신"])
    has_compare = _includes_any(raw, ["업체별", "회사별", "업체 견적", "견적 수준", "비교견적", "견적비교", "단가 비교", "단가비교", "가격비교", "비교 결과", "최저가", "최고가"])
    has_unit_price = _includes_any(raw, ["표준시장단가", "공종코드", "단가", "견적금액", "총 견적금액"])
    has_report = _includes_any(raw, ["보고서", "검토보고서", "보고", "report", "서술형", "문장형", "텍스트 전용", "검토 의견"])
    has_real_table = _includes_any(raw, ["표 후보", "비교표", "표 구조", "row", "column", "행", "열", "컬럼"])
    has_inspection = _includes_any(raw, ["현장 점검", "점검보고서", "안전점검", "감리 점검", "하자 점검", "시정조치"])
    return {"raw": raw, "upper": upper, "hasMeeting": has_meeting, "hasOfficial": has_official, "hasCompare": has_compare, "hasUnitPrice": has_unit_price, "hasReport": has_report, "hasRealTable": has_real_table, "hasInspection": has_inspection, "userIntent": _infer_user_output_intent(raw)}


def infer_main_layout_type(text: str = "") -> str:
    ctx = _analyze_context(text)
    if ctx["hasMeeting"]:
        return "MEETING_MINUTES"
    if ctx["hasOfficial"]:
        return "OFFICIAL_LETTER"
    if ctx["hasCompare"] and ctx["hasUnitPrice"]:
        if ctx["userIntent"] == "TABLE":
            return "VENDOR_COMPARISON_TABLE"
        return "VENDOR_COMPARISON_REVIEW_FORM" if ctx["hasReport"] or not ctx["hasRealTable"] else "VENDOR_COMPARISON_TABLE"
    if ctx["hasCompare"]:
        return "VENDOR_COMPARISON_TABLE" if ctx["userIntent"] == "TABLE" or ctx["hasRealTable"] else "VENDOR_COMPARISON_REVIEW_FORM"
    if _includes_any(text, ["단가표", "표준시장단가표", "공종단가표", "노무비율"]):
        return "PRICE_SURVEY_TABLE"
    if ctx["hasInspection"]:
        return "INSPECTION_REPORT"
    if ctx["hasReport"]:
        return "REPORT_FORM"
    return "BASIC_TABLE"


def _matched_keyword_count(layout: Dict[str, Any], text: str = "") -> int:
    return sum(1 for keyword in layout.get("keywords", []) if _includes_any(text, [str(keyword)]))


def _compare_scores(layout_type: str = "", ctx: Dict[str, Any] | None = None, main_type: str = "") -> Optional[int]:
    ctx = ctx or {}
    table_wanted = ctx.get("userIntent") == "TABLE" or bool(ctx.get("hasRealTable"))
    report_wanted = ctx.get("userIntent") == "REPORT" or bool(ctx.get("hasReport")) or not bool(ctx.get("hasRealTable"))
    if main_type == "VENDOR_COMPARISON_TABLE":
        scores = {
            "VENDOR_COMPARISON_TABLE": 96,
            "VENDOR_COMPARISON_REVIEW_FORM": 91 if report_wanted else 88,
            "ESTIMATE_REVIEW_FORM": 82,
            "PRICE_SURVEY_TABLE": 78,
            "REPORT_FORM": 74,
            "REVIEW_OPINION_FORM": 68,
            "BASIC_TABLE": 55,
        }
        return scores.get(layout_type, 24)
    if main_type == "VENDOR_COMPARISON_REVIEW_FORM":
        scores = {
            "VENDOR_COMPARISON_REVIEW_FORM": 96,
            "VENDOR_COMPARISON_TABLE": 94 if table_wanted else 91,
            "REPORT_FORM": 84,
            "REVIEW_OPINION_FORM": 80,
            "ESTIMATE_REVIEW_FORM": 76,
            "PRICE_SURVEY_TABLE": 72,
            "BASIC_TABLE": 52,
        }
        return scores.get(layout_type, 22)
    return None


def score_layout(layout: Dict[str, Any], text: str = "", main_type: str = "") -> int:
    ctx = _analyze_context(text)
    layout_type = str(layout.get("layoutType") or "")
    matched = _matched_keyword_count(layout, text)
    compare_score = _compare_scores(layout_type, ctx, main_type)
    if compare_score is not None:
        return max(18, min(98, compare_score + min(2, matched)))

    base = 34
    main_family = _family_of(main_type)
    cand_family = _family_of(layout_type)
    if main_type == layout_type:
        base = 94
    elif main_family == cand_family and main_family != "BASIC":
        base = 78
    elif matched >= 2:
        base = 58
    elif matched == 1:
        base = 46

    if ctx["hasInspection"] and layout_type == "INSPECTION_REPORT":
        base = max(base, 92)
    if not ctx["hasInspection"] and layout_type == "INSPECTION_REPORT":
        base = min(base, 35)
    if not ctx["hasMeeting"] and layout_type == "MEETING_MINUTES":
        base = min(base, 24)
    if not ctx["hasOfficial"] and layout_type == "OFFICIAL_LETTER":
        base = min(base, 24)

    return max(18, min(98, round(base + min(6, matched * 2))))


def _build_reason(layout: Dict[str, Any], score: int, text: str = "", main_type: str = "") -> str:
    if layout.get("layoutType") == "VENDOR_COMPARISON_TABLE" and main_type in {"VENDOR_COMPARISON_REVIEW_FORM", "VENDOR_COMPARISON_TABLE"}:
        suffix = "" if _analyze_context(text)["hasRealTable"] else " 원문이 표가 아닌 문장형이면 문장 기반으로 업체명·금액·차이율을 추출합니다."
        return f"{layout.get('reason') or ''}{suffix}"
    if score < 45:
        return f"{layout.get('reason') or ''} 현재 문서와 직접 적합도는 낮습니다."
    return str(layout.get("reason") or "")


def build_layout_candidates(analysis: Dict[str, Any] | None = None, table: Dict[str, Any] | None = None, user_request: str = "") -> List[Dict[str, Any]]:
    analysis = analysis or {}
    table = table or {}
    columns = table.get("columns") or []
    column_text = " ".join(f"{c.get('label') or ''} {c.get('key') or ''}" for c in columns if isinstance(c, dict))
    text = " ".join(str(x) for x in [
        analysis.get("documentType"),
        analysis.get("document_type"),
        analysis.get("purpose"),
        analysis.get("summary"),
        analysis.get("businessPurpose"),
        analysis.get("business_purpose"),
        table.get("tableName"),
        table.get("table_name"),
        table.get("tableType"),
        table.get("table_type"),
        column_text,
        user_request,
    ] if x)
    if not _has_meaningful_context(text):
        return []
    main_type = infer_main_layout_type(text)
    scored: List[Dict[str, Any]] = []
    for layout in LAYOUT_REGISTRY:
        score = score_layout(layout, text, main_type)
        item = {
            "designId": layout["designId"],
            "name": layout["name"],
            "documentKind": layout["documentKind"],
            "layoutType": layout["layoutType"],
            "layout": normalize_layout_for_renderer(layout["layoutType"]),
            "title": layout["title"],
            "score": score,
            "reason": _build_reason(layout, score, text, main_type),
            "sections": layout["sections"],
            "sourceType": "LAYOUT_REGISTRY",
            "mainType": main_type,
        }
        if item["layoutType"] == main_type or score >= 65:
            scored.append(item)
    return sorted(scored, key=lambda item: item.get("score", 0), reverse=True)[:5]
