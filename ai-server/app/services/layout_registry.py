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
    wants_report = _includes_any(raw, [
        "보고서 형식", "보고서 형태", "보고서로", "업무보고서", "업무 보고서", "검토보고서", "검토 보고서",
        "보고서", "보고 형식", "보고 형태", "서술형", "문장형", "본문형", "핵심 내용", "보고용",
    ])
    wants_table = _includes_any(raw, [
        "표로", "표 형태", "표 형식", "표 양식", "표만", "비교표", "단가표", "조사표",
        "테이블", "그리드", "엑셀 표", "표 정리", "표 만들어", "표 생성",
    ])
    if wants_table and not wants_report:
        return "TABLE"
    if wants_table and re.search(r"표로|비교표|단가표|조사표|테이블|그리드|엑셀\s*표|표\s*(정리|생성|만들)", raw, re.I):
        return "TABLE"
    if wants_report:
        return "REPORT"
    return "AUTO"


TABLE_ONLY_LAYOUTS = {"VENDOR_COMPARISON_TABLE", "PRICE_SURVEY_TABLE", "BASIC_TABLE"}
REPORT_COMPATIBLE_LAYOUTS = {"REPORT_FORM", "REVIEW_OPINION_FORM", "INSPECTION_REPORT", "VENDOR_COMPARISON_REVIEW_FORM"}
TABLE_COMPATIBLE_LAYOUTS = {"VENDOR_COMPARISON_TABLE", "PRICE_SURVEY_TABLE", "BASIC_TABLE"}


def is_layout_allowed_for_intent(layout_type: str = "", intent: str = "AUTO", text: str = "") -> bool:
    layout = str(layout_type or "").upper()
    ctx = _analyze_context(text)
    if intent == "REPORT":
        if layout in TABLE_ONLY_LAYOUTS:
            return False
        if layout in REPORT_COMPATIBLE_LAYOUTS:
            return True
        if layout == "MEETING_MINUTES":
            return bool(ctx["hasMeeting"])
        if layout == "OFFICIAL_LETTER":
            return bool(ctx["hasOfficial"])
        if layout == "WORK_DAILY_REPORT":
            return _includes_any(text, ["작업일보", "작업내용", "금일작업", "명일작업"])
        return False
    if intent == "TABLE":
        return layout in TABLE_COMPATIBLE_LAYOUTS or layout == "ESTIMATE_REVIEW_FORM"
    return True


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
    return {
        "raw": raw,
        "upper": upper,
        "hasMeeting": has_meeting,
        "hasOfficial": has_official,
        "hasCompare": has_compare,
        "hasUnitPrice": has_unit_price,
        "hasReport": has_report,
        "hasRealTable": has_real_table,
        "hasInspection": has_inspection,
        "userIntent": _infer_user_output_intent(raw),
    }


def infer_main_layout_type(text: str = "", explicit_intent: str = "AUTO", user_request: str = "") -> str:
    ctx = _analyze_context(text)
    request_text = str(user_request or "")
    if ctx["hasMeeting"] and _includes_any(request_text or text, ["회의록", "회의록 형식"]):
        return "MEETING_MINUTES"
    if ctx["hasOfficial"] and _includes_any(request_text or text, ["공문", "공문 형식"]):
        return "OFFICIAL_LETTER"

    if explicit_intent == "REPORT":
        if ctx["hasInspection"] and _includes_any(request_text, ["점검 보고서", "현장 점검 보고서"]):
            return "INSPECTION_REPORT"
        if ctx["hasCompare"] and _includes_any(request_text, ["비교 검토보고서", "업체별 단가 비교 검토보고서"]):
            return "VENDOR_COMPARISON_REVIEW_FORM"
        return "REPORT_FORM"

    if explicit_intent == "TABLE":
        if ctx["hasCompare"]:
            return "VENDOR_COMPARISON_TABLE"
        if ctx["hasUnitPrice"] or _includes_any(text, ["단가표", "표준시장단가표", "공종단가표", "노무비율"]):
            return "PRICE_SURVEY_TABLE"
        return "BASIC_TABLE"

    if ctx["hasCompare"] and ctx["hasUnitPrice"]:
        return "VENDOR_COMPARISON_REVIEW_FORM" if ctx["hasReport"] or not ctx["hasRealTable"] else "VENDOR_COMPARISON_TABLE"
    if ctx["hasCompare"]:
        return "VENDOR_COMPARISON_TABLE" if ctx["hasRealTable"] else "VENDOR_COMPARISON_REVIEW_FORM"
    if _includes_any(text, ["단가표", "표준시장단가표", "공종단가표", "노무비율"]):
        return "PRICE_SURVEY_TABLE"
    if ctx["hasInspection"]:
        return "INSPECTION_REPORT"
    if ctx["hasReport"]:
        return "REPORT_FORM"
    return "BASIC_TABLE"


def _matched_keyword_count(layout: Dict[str, Any], text: str = "") -> int:
    return sum(1 for keyword in layout.get("keywords", []) if _includes_any(text, [str(keyword)]))


def _explicit_intent_score(layout_type: str = "", ctx: Dict[str, Any] | None = None, intent: str = "AUTO", main_type: str = "") -> Optional[int]:
    ctx = ctx or {}
    if intent == "REPORT":
        scores = {
            "REPORT_FORM": 88 if main_type == "REPORT_FORM" else 82,
            "REVIEW_OPINION_FORM": 80,
            "INSPECTION_REPORT": 86 if ctx.get("hasInspection") else 58,
            "VENDOR_COMPARISON_REVIEW_FORM": 88 if main_type == "VENDOR_COMPARISON_REVIEW_FORM" else (74 if ctx.get("hasCompare") else 56),
            "MEETING_MINUTES": 82 if ctx.get("hasMeeting") else 20,
            "OFFICIAL_LETTER": 82 if ctx.get("hasOfficial") else 20,
            "WORK_DAILY_REPORT": 54,
        }
        return scores.get(layout_type, 18)
    if intent == "TABLE":
        scores = {
            "VENDOR_COMPARISON_TABLE": 88 if ctx.get("hasCompare") else 64,
            "PRICE_SURVEY_TABLE": 82 if ctx.get("hasUnitPrice") else 62,
            "BASIC_TABLE": 66,
            "ESTIMATE_REVIEW_FORM": 60,
        }
        return scores.get(layout_type, 18)
    return None


def _compare_scores(layout_type: str = "", ctx: Dict[str, Any] | None = None, main_type: str = "", explicit_intent: str = "AUTO") -> Optional[int]:
    ctx = ctx or {}
    explicit_score = _explicit_intent_score(layout_type, ctx, explicit_intent, main_type)
    if explicit_score is not None:
        return explicit_score
    if main_type == "VENDOR_COMPARISON_TABLE":
        scores = {
            "VENDOR_COMPARISON_TABLE": 88,
            "VENDOR_COMPARISON_REVIEW_FORM": 76,
            "ESTIMATE_REVIEW_FORM": 70,
            "PRICE_SURVEY_TABLE": 68,
            "REPORT_FORM": 58,
            "REVIEW_OPINION_FORM": 54,
            "BASIC_TABLE": 52,
        }
        return scores.get(layout_type, 22)
    if main_type == "VENDOR_COMPARISON_REVIEW_FORM":
        scores = {
            "VENDOR_COMPARISON_REVIEW_FORM": 88,
            "REPORT_FORM": 78,
            "REVIEW_OPINION_FORM": 74,
            "VENDOR_COMPARISON_TABLE": 64,
            "ESTIMATE_REVIEW_FORM": 62,
            "PRICE_SURVEY_TABLE": 58,
            "BASIC_TABLE": 48,
        }
        return scores.get(layout_type, 22)
    return None


def score_layout(layout: Dict[str, Any], text: str = "", main_type: str = "", explicit_intent: str = "AUTO") -> int:
    ctx = _analyze_context(text)
    layout_type = str(layout.get("layoutType") or "")
    matched = _matched_keyword_count(layout, text)
    compare_score = _compare_scores(layout_type, ctx, main_type, explicit_intent)
    if compare_score is not None:
        return max(18, min(90, int(compare_score) + min(2, matched)))

    base = 32
    main_family = _family_of(main_type)
    cand_family = _family_of(layout_type)
    if main_type == layout_type:
        base = 86
    elif main_family == cand_family and main_family != "BASIC":
        base = 72
    elif matched >= 2:
        base = 56
    elif matched == 1:
        base = 44

    if ctx["hasInspection"] and layout_type == "INSPECTION_REPORT":
        base = max(base, 84)
    if not ctx["hasInspection"] and layout_type == "INSPECTION_REPORT":
        base = min(base, 34)
    if not ctx["hasMeeting"] and layout_type == "MEETING_MINUTES":
        base = min(base, 24)
    if not ctx["hasOfficial"] and layout_type == "OFFICIAL_LETTER":
        base = min(base, 24)
    return max(18, min(90, round(base + min(4, matched))))

def _build_reason(layout: Dict[str, Any], score: int, text: str = "", main_type: str = "", explicit_intent: str = "AUTO") -> str:
    if explicit_intent == "REPORT" and str(layout.get("layoutType") or "") in TABLE_ONLY_LAYOUTS:
        return f"{layout.get('reason') or ''} 보고서 요청에서는 표 전용 후보로 제외됩니다."
    if layout.get("layoutType") == "VENDOR_COMPARISON_TABLE" and main_type == "VENDOR_COMPARISON_TABLE":
        suffix = "" if _analyze_context(text)["hasRealTable"] else " 원문이 표가 아닌 문장형이면 문장 기반으로 업체명·금액·차이율을 추출합니다."
        return f"{layout.get('reason') or ''}{suffix}"
    if score < 45:
        return f"{layout.get('reason') or ''} 현재 문서와 직접 적합도는 낮습니다."
    return str(layout.get("reason") or "")


def build_layout_candidates(analysis: Dict[str, Any] | None = None, table: Dict[str, Any] | None = None, user_request: str = "") -> List[Dict[str, Any]]:
    analysis = analysis or {}
    table = table or {}
    parts: List[str] = [
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
    ]
    for col in table.get("columns") or []:
        if isinstance(col, dict):
            parts.append(f"{col.get('label') or ''} {col.get('key') or ''}")
    parts.append(user_request)
    text = " ".join(str(item) for item in parts if item)
    if not _has_meaningful_context(text):
        return []

    explicit_intent = _infer_user_output_intent(user_request)
    main_type = infer_main_layout_type(text, explicit_intent, user_request)
    scored: List[Dict[str, Any]] = []
    for layout in LAYOUT_REGISTRY:
        if not is_layout_allowed_for_intent(str(layout.get("layoutType") or ""), explicit_intent, text):
            continue
        score = score_layout(layout, text, main_type, explicit_intent)
        scored.append({
            "designId": layout["designId"],
            "name": layout["name"],
            "documentKind": layout["documentKind"],
            "layoutType": layout["layoutType"],
            "layout": normalize_layout_for_renderer(layout["layoutType"]),
            "title": layout["title"],
            "score": score,
            "reason": _build_reason(layout, score, text, main_type, explicit_intent),
            "sections": layout["sections"],
            "sourceType": "LAYOUT_REGISTRY",
            "mainType": main_type,
            "requestIntent": explicit_intent,
        })
    threshold = 55 if explicit_intent == "AUTO" else 50
    filtered = [item for item in scored if item["layoutType"] == main_type or int(item.get("score") or 0) >= threshold]
    filtered.sort(key=lambda x: int(x.get("score") or 0), reverse=True)
    return filtered[:5]
