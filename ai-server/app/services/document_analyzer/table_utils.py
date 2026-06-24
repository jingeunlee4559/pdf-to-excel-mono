from __future__ import annotations

import os
import re
import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Tuple

from app.services.unit_normalizer import clean_cell_text, enrich_row_units

logger = logging.getLogger("app.document_analyzer")

# ---------------------------------------------------------------------------
# Column / constant definitions (shared across modules)
# ---------------------------------------------------------------------------

DEFAULT_COLUMNS = [
    {"key": "vendor_name", "label": "업체명"},
    {"key": "item_name", "label": "품목명"},
    {"key": "spec", "label": "규격"},
    {"key": "quantity", "label": "수량"},
    {"key": "unit", "label": "단위"},
    {"key": "standard_unit_price", "label": "기준/표준단가"},
    {"key": "vendor_unit_price", "label": "업체 견적단가"},
    {"key": "unit_price", "label": "일반 단가"},
    {"key": "amount", "label": "금액"},
    {"key": "price_diff", "label": "차이"},
    {"key": "diff_rate", "label": "대비율"},
    {"key": "remark", "label": "비고"},
]

STANDARD_MARKET_PRICE_COLUMNS = [
    {"key": "construction_code", "label": "공종코드"},
    {"key": "item_name", "label": "공종명칭"},
    {"key": "spec", "label": "규격"},
    {"key": "unit", "label": "단위"},
    {"key": "unit_price", "label": "단가"},
    {"key": "labor_ratio", "label": "노무비율"},
    {"key": "remark", "label": "비고"},
]

REFERENCE_GUIDELINE_COLUMNS = [
    {"key": "section", "label": "구분/장절"},
    {"key": "basis_item", "label": "기준 항목"},
    {"key": "application_basis", "label": "적용 기준"},
    {"key": "calculation_method", "label": "계산/적용 방식"},
    {"key": "unit_price_basis", "label": "단가 기준"},
    {"key": "source_page", "label": "근거 페이지"},
    {"key": "remark", "label": "비고"},
]

TEXT_VENDOR_COMPARISON_COLUMNS = [
    {"key": "vendor_name", "label": "업체명"},
    {"key": "total_amount", "label": "총 견적금액"},
    {"key": "price_diff", "label": "표준단가 대비"},
    {"key": "diff_rate", "label": "대비율"},
    {"key": "remark", "label": "검토의견"},
]

TEXT_VENDOR_COMPARISON_TABLE_TYPE = "TEXT_VENDOR_COMPARISON_REPORT"
REFERENCE_TABLE_TYPES = {"REFERENCE_GUIDELINE_TABLE", "GUIDELINE_SUMMARY_TABLE"}
STANDARD_MARKET_TABLE_TYPES = {"STANDARD_MARKET_PRICE_TABLE"}
MULTI_VENDOR_COMPARE_TABLE_TYPE = "MULTI_VENDOR_PRICE_COMPARISON"

REFERENCE_TABLE_KEYWORDS = [
    "단가", "가격", "계약단가", "거래실례가격", "노임단가", "정부노임단가",
    "요율", "산정", "산출", "계산", "적용기준", "산정기준", "기준",
    "할증", "품셈", "경비", "노무비", "재료비", "자재", "전력비", "기본요금",
]

FIELD_ALIASES = {
    "construction_code": ["공종코드", "코드", "code"],
    "labor_ratio": ["노무비율", "노무 비율", "노무율", "labor"],
    "vendor_name": ["업체", "업체명", "거래처", "공급업체", "회사명", "상호", "시공사", "견적업체"],
    "item_name": ["품목", "품목명", "자재", "자재명", "내역", "공종", "작업명", "명칭", "품명", "공종명칭", "공종명"],
    "spec": ["규격", "사양", "모델", "크기", "치수", "규격명"],
    "quantity": ["수량", "물량", "개수", "qty", "수량산출", "소요량"],
    "unit": ["단위", "uom", "unit"],
    "standard_unit_price": ["표준단가", "기준단가", "시장단가", "표준시장단가", "기준가격"],
    "vendor_unit_price": ["견적단가", "견적가", "견적가격", "견적금액", "제안단가", "제안가", "제시단가", "제시가", "업체단가", "업체견적", "공급단가", "견적"],
    "unit_price": ["단가", "단위금액", "원가", "가격"],
    "price_diff": ["차이", "차액", "증감", "증감액", "차이금액"],
    "diff_rate": ["대비", "대비율", "비율", "증감률", "율", "%"],
    "amount": ["금액", "합계", "합계금액", "총금액", "공급가액", "금 액"],
    "remark": ["비고", "메모", "특이사항", "참고사항", "비 고"],
}

NUMBER_KEYS = {"quantity", "unit_price", "vendor_unit_price", "standard_unit_price", "amount", "supply_amount", "tax_amount", "price_diff"}
PRICE_COMPARE_WORDS = ["단가", "견적", "비교", "업체", "최저", "최고", "가격", "견적서"]
PRICE_VALUE_PRIORITY = ("vendor_unit_price", "unit_price", "amount")

DOCUMENT_TYPE_RULES = [
    ("표준시장단가표", ["건설공사표준시장단가", "표준시장단가", "공종코드", "노무비율"]),
    ("기준서/지침서", ["지침서", "적용기준", "표준품셈", "품셈", "적산", "공사원가", "건축견적지침서"]),
    ("Use Case 명세서", ["use case", "유스케이스", "use case id", "actor 정의", "main flow", "alternative flow"]),
    ("업무 프로세스 명세서", ["프로세스", "as-is", "to-be", "업무 흐름"]),
    ("요구사항 정의서", ["요구사항", "기능 요구", "비기능 요구", "요구사항 id"]),
    ("보고서", ["보고서", "kpi", "pain point", "기대 효과"]),
]

BUSINESS_TABLE_REQUIRED_KEYS = {"item_name", "quantity", "unit", "unit_price", "vendor_unit_price", "standard_unit_price", "amount", "vendor_name"}

GENERIC_FOCUS_TERMS = {
    "단가", "견적", "비교", "표준", "시장", "표준시장", "파일", "회사", "업체",
    "공종", "표", "분석", "엑셀", "문서", "자료", "자사양식", "비교표",
    "업체별", "회사별", "공종별", "견적서", "비교견적서", "단가비교",
    "업체비교", "회사비교", "업체별단가", "업체별비교", "업체별단가비교",
    "공종명칭", "공종코드", "규격", "수량", "단위", "금액", "최저", "작성자",
}

# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


# ---------------------------------------------------------------------------
# Parse logger / page limit
# ---------------------------------------------------------------------------

def _new_parse_logger(scope: str) -> Tuple[List[Dict[str, Any]], Callable[..., None]]:
    logs: List[Dict[str, Any]] = []
    capture_logs = _env_bool("RETURN_PARSE_LOGS", False)

    def write(level: str, message: str, **data: Any) -> None:
        clean_data = {k: v for k, v in data.items() if v is not None}
        suffix = " ".join(f"{key}={value}" for key, value in clean_data.items())
        text = f"[{scope}] {message}" + (f" {suffix}" if suffix else "")
        if capture_logs:
            logs.append({
                "time": datetime.now().isoformat(timespec="seconds"),
                "level": level.upper(),
                "message": text,
                "data": clean_data,
            })
        log_fn = getattr(logger, level.lower(), logger.info)
        log_fn(text)

    return logs, write


def _limit_pages(total_pages: int, env_name: str = "PDF_MAX_PAGES") -> int:
    limit = _env_int(env_name, 0)
    if limit <= 0:
        return total_pages
    return min(total_pages, limit)


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------

def compact_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def _company_compare_key(value: Any) -> str:
    return re.sub(r"[\s._\-()（）\[\]{}·,㈜]+|주식회사|\(주\)|（주）", "", str(value or "")).lower()


def _has_unbalanced_parenthesis(value: Any) -> bool:
    text = str(value or "")
    return text.count("(") != text.count(")") or text.count("[") != text.count("]") or text.endswith(("(", "[", "{"))


def _valid_focus_term(value: Any) -> bool:
    term = compact_text(value)
    if len(term) < 2:
        return False
    if term in GENERIC_FOCUS_TERMS:
        return False
    if any(term == generic or term.endswith(generic) and generic in {"비교표", "견적서"} for generic in GENERIC_FOCUS_TERMS):
        return False
    if _has_unbalanced_parenthesis(term):
        return False
    if re.fullmatch(r"[0-9, .]+(?:개|건|장|식|개사|업체|회사)?", str(value or "").strip()):
        return False
    return True


def source_has_value(source_text: str, value: Any) -> bool:
    """LLM이 만든 값이 실제 원문에 존재하는지 보수적으로 확인한다."""
    text = compact_text(source_text)
    raw = str(value or "").strip()
    if not raw:
        return True
    compact = compact_text(raw)
    if not compact:
        return True
    if compact in {"개", "개소", "본", "m", "m2", "m3", "㎡", "㎥", "공m3", "공㎥", "ea", "pcs", "box", "set", "lot", "식", "원", "-", "none", "null"}:
        return True
    if re.fullmatch(r"[0-9,\.\-]+", compact):
        digits = re.sub(r"[^0-9]", "", compact)
        return bool(digits) and digits in re.sub(r"[^0-9]", "", text)
    return compact in text


# ---------------------------------------------------------------------------
# Number utilities
# ---------------------------------------------------------------------------

def clean_number(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    cleaned = re.sub(r"[^0-9.,-]", "", text)
    return cleaned


def to_number(value: Any) -> float:
    cleaned = str(value or "").replace(",", "").strip()
    if not cleaned:
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Header normalisation
# ---------------------------------------------------------------------------

def _strip_header_unit_suffix(header: Any) -> str:
    text = clean_cell_text(header)
    text = re.sub(r"[\(\[\{]\s*(원|만원|천원|%|퍼센트|금액|price|krw)\s*[\)\]\}]", "", text, flags=re.I)
    return clean_cell_text(text)


def _field_alias_score(header: Any, aliases: List[str]) -> int:
    compact = compact_text(header)
    best = 0
    for alias in aliases:
        c_alias = compact_text(alias)
        if not c_alias:
            continue
        if compact == c_alias:
            best = max(best, 100 + len(c_alias))
        elif c_alias in compact:
            best = max(best, 50 + len(c_alias))
    return best


def _classify_header_role(header: Any) -> Dict[str, Any]:
    """헤더 역할을 분류한다. A회사/B회사 같은 특정 문자열을 조건으로 쓰지 않는다."""
    raw = clean_cell_text(header)
    compact = compact_text(_strip_header_unit_suffix(raw))
    if not compact:
        return {"role": "field", "source_header": raw, "confidence": 0.0}
    scored: List[Tuple[int, str]] = []
    for key, aliases in FIELD_ALIASES.items():
        score = _field_alias_score(compact, aliases)
        if score:
            scored.append((score, key))
    if any(term in compact for term in ["표준", "기준", "시장단가"]):
        scored.append((220, "standard_unit_price"))
    if any(term in compact for term in ["견적", "제안", "제시", "업체", "공급"]):
        scored.append((210, "vendor_unit_price"))
    if any(term in compact for term in ["차이", "차액", "증감"]):
        scored.append((205, "price_diff"))
    if "%" in raw or any(term in compact for term in ["대비", "비율", "증감률"]):
        scored.append((205, "diff_rate"))
    if scored:
        scored.sort(reverse=True)
        return {"role": scored[0][1], "source_header": raw, "confidence": min(scored[0][0] / 220, 1.0)}
    return {"role": compact or "field", "source_header": raw, "confidence": 0.0}


def _normalize_price_role_fallback(row: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(row, dict):
        return row
    if row.get("vendor_unit_price") and not row.get("unit_price"):
        row["unit_price"] = row.get("vendor_unit_price")
    if row.get("standard_unit_price") and row.get("vendor_unit_price"):
        row["source_price_role"] = "vendor_unit_price"
    elif row.get("vendor_unit_price"):
        row["source_price_role"] = "vendor_unit_price"
    elif row.get("unit_price"):
        row["source_price_role"] = "unit_price"
    elif row.get("amount"):
        row["source_price_role"] = "amount"
    return row


def normalize_header(header: Any) -> str:
    return str(_classify_header_role(header).get("role") or "field")


# ---------------------------------------------------------------------------
# rows_to_table / table_to_markdown
# ---------------------------------------------------------------------------

def rows_to_table(raw_rows: List[List[Any]], source_text: str = "", filename: str = "") -> List[Dict[str, Any]]:
    if not raw_rows:
        return []

    cleaned_rows: List[List[str]] = []
    for row in raw_rows:
        values = ["" if v is None else clean_cell_text(v) for v in row]
        while values and not values[-1]:
            values.pop()
        if any(values):
            cleaned_rows.append(values)
    if not cleaned_rows:
        return []

    header_idx = 0
    best_score = -1
    for idx, row in enumerate(cleaned_rows[:25]):
        joined = " ".join(map(str, row))
        score = 0
        for cell in row:
            if _classify_header_role(cell).get("confidence", 0) > 0:
                score += 1
        score += sum(1 for aliases in FIELD_ALIASES.values() for alias in aliases if alias.lower() in joined.lower())
        if score > best_score:
            best_score = score
            header_idx = idx
        if score >= 3:
            break

    if best_score < 2:
        return []

    raw_headers = cleaned_rows[header_idx]
    headers = [normalize_header(cell) for cell in raw_headers]
    for i in range(1, len(headers)):
        raw_cell = re.sub(r"\s+", "", str(raw_headers[i] or "")).lower()
        prev_raw = re.sub(r"\s+", "", str(raw_headers[i - 1] or "")).lower()
        if headers[i] in {"field", "가", "unit_price"} and raw_cell in {"가", "가격"} and (headers[i - 1] == "unit" or "단위" in prev_raw):
            headers[i] = "unit_price"

    normalized_headers: List[str] = []
    seen: Dict[str, int] = {}
    for col in headers:
        base = col or "field"
        seen[base] = seen.get(base, 0) + 1
        normalized_headers.append(base if seen[base] == 1 else f"{base}_{seen[base]}")

    rows: List[Dict[str, Any]] = []
    for raw in cleaned_rows[header_idx + 1 : header_idx + 151]:
        if not any(str(v or "").strip() for v in raw):
            continue
        item: Dict[str, Any] = {}
        for idx, (key, value) in enumerate(zip(normalized_headers, raw)):
            base_key = re.sub(r"_\d+$", "", key)
            if base_key in NUMBER_KEYS:
                item[key] = clean_number(value)
            elif base_key == "diff_rate":
                item[key] = clean_cell_text(value)
            else:
                item[key] = clean_cell_text(value)
            if idx < len(raw_headers):
                item.setdefault("_source_headers", {})[key] = raw_headers[idx]

        for key in list(item.keys()):
            if re.match(r"^vendor_unit_price_\d+$", key) and not item.get("vendor_unit_price"):
                item["vendor_unit_price"] = item.get(key)
            if re.match(r"^standard_unit_price_\d+$", key) and not item.get("standard_unit_price"):
                item["standard_unit_price"] = item.get(key)
            if re.match(r"^price_diff_\d+$", key) and not item.get("price_diff"):
                item["price_diff"] = item.get(key)
            if re.match(r"^diff_rate_\d+$", key) and not item.get("diff_rate"):
                item["diff_rate"] = item.get(key)

        item = _normalize_price_role_fallback(item)
        rows.append(enrich_row_units(item))
    return rows


def table_to_markdown(rows: List[Dict[str, Any]], max_rows: int = 40) -> str:
    if not rows:
        return ""
    preferred = ["vendor_name", "construction_code", "item_name", "spec", "quantity", "unit", "standard_unit_price", "vendor_unit_price", "unit_price", "amount", "price_diff", "diff_rate", "remark"]
    keys = [key for key in preferred if any(str(row.get(key, "")).strip() for row in rows)]
    if not keys:
        seen = []
        for row in rows[:max_rows]:
            for key in row.keys():
                if key.startswith("_"):
                    continue
                if key not in seen:
                    seen.append(key)
        keys = seen[:12] or [col["key"] for col in DEFAULT_COLUMNS]
    header = "| " + " | ".join(keys) + " |"
    sep = "| " + " | ".join(["---"] * len(keys)) + " |"
    body = []
    for row in rows[:max_rows]:
        body.append("| " + " | ".join(str(row.get(key, "")).replace("\n", " ")[:80] for key in keys) + " |")
    return "\n".join([header, sep, *body])


# ---------------------------------------------------------------------------
# prune_empty_columns / merge_standard_market_rows
# ---------------------------------------------------------------------------

def prune_empty_columns(columns: List[Dict[str, Any]], rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """값이 전혀 없는 컬럼은 응답에서 제외한다."""
    if not rows:
        return columns
    visible: List[Dict[str, Any]] = []
    for col in columns:
        key = col.get("key")
        if not key:
            continue
        if any(str(row.get(key, "")).strip() for row in rows):
            visible.append(col)
    return visible or columns


def merge_standard_market_rows(table_rows: List[Dict[str, Any]], text_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """pdfplumber 표 행과 PyMuPDF 텍스트 행을 같은 순서 기준으로 병합한다."""
    if not text_rows:
        return table_rows
    if not table_rows:
        return text_rows

    merged: List[Dict[str, Any]] = []
    total = max(len(table_rows), len(text_rows))
    for idx in range(total):
        base = dict(table_rows[idx]) if idx < len(table_rows) else {}
        extra = text_rows[idx] if idx < len(text_rows) else {}
        row = dict(base)
        for key in ["construction_code", "labor_ratio", "source_page"]:
            if not str(row.get(key, "")).strip() and str(extra.get(key, "")).strip():
                row[key] = extra.get(key)
        for key in ["item_name", "spec", "unit", "unit_price"]:
            if not str(row.get(key, "")).strip() and str(extra.get(key, "")).strip():
                row[key] = extra.get(key)
        row = enrich_row_units(row)
        merged.append(row)
    return merged


# ---------------------------------------------------------------------------
# validate_rows
# ---------------------------------------------------------------------------

def validate_rows(rows: List[Dict[str, Any]], table_type: str = "NORMAL_TABLE") -> List[Dict[str, Any]]:
    if table_type in {"IMAGE_TABLE", "GENERAL_TABLE", "OCR_TABLE", "REFERENCE_GUIDELINE_TABLE", "GUIDELINE_SUMMARY_TABLE", "STANDARD_MARKET_PRICE_TABLE", TEXT_VENDOR_COMPARISON_TABLE_TYPE}:
        return []

    issues: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows):
        qty = to_number(row.get("quantity"))
        unit_price = to_number(row.get("vendor_unit_price") or row.get("unit_price"))
        amount = to_number(row.get("amount"))
        if qty and unit_price and amount and abs(qty * unit_price - amount) > 1:
            issues.append({
                "rowIndex": idx,
                "issueType": "AMOUNT_MISMATCH",
                "severity": "WARNING",
                "fieldKey": "amount",
                "fieldLabel": "금액",
                "message": f"{idx + 1}행 금액이 수량×단가와 다릅니다. 계산값={qty * unit_price:,.0f}, 입력값={amount:,.0f}",
            })

        if table_type == "PRICE_COMPARISON" and not row.get("item_name") and not row.get("vendor_name"):
            issues.append({
                "rowIndex": idx,
                "issueType": "MISSING_KEY_FIELD",
                "severity": "WARNING",
                "fieldKey": "item_name",
                "fieldLabel": "품목명",
                "message": f"{idx + 1}행의 품목명 또는 업체명을 확인하세요.",
            })

        known_unit = compact_text(row.get("unit")) in {"개", "본", "식", "시간", "hr", "m", "m2", "m3", "㎡", "㎥", "공m3", "공㎥", "kg", "톤", "대", "장", "매", "조", "세트"}
        if table_type not in {MULTI_VENDOR_COMPARE_TABLE_TYPE, "PRICE_COMPARISON"} and row.get("unit") and not known_unit and float(row.get("unit_confidence") or 0) < 0.5:
            issues.append({
                "rowIndex": idx,
                "issueType": "UNIT_PARSE_LOW_CONFIDENCE",
                "severity": "INFO",
                "fieldKey": "unit",
                "fieldLabel": "단위",
                "message": f"{idx + 1}행 단위 '{row.get('unit_original') or row.get('unit')}' 인식값을 확인하세요.",
            })

    if table_type == "PRICE_COMPARISON":
        grouped: Dict[str, set] = {}
        vendor_count = sum(1 for row in rows if str(row.get("vendor_name") or "").strip())
        if vendor_count >= 2:
            for row in rows:
                item_key = str(row.get("item_name") or "").strip()
                spec_key = str(row.get("spec") or "").strip()
                if not item_key:
                    continue
                key = f"{item_key}|{spec_key}"
                grouped.setdefault(key, set()).add(str(row.get("unit_normalized") or row.get("unit") or "").strip())
            for key, units in grouped.items():
                real_units = {u for u in units if u}
                if len(real_units) >= 2:
                    item_name, spec = key.split("|", 1)
                    label = f"{item_name} / {spec}" if spec else item_name
                    issues.append({
                        "rowIndex": None,
                        "issueType": "UNIT_MISMATCH_BETWEEN_VENDORS",
                        "severity": "WARNING",
                        "fieldKey": "unit",
                        "fieldLabel": "단위",
                        "message": f"'{label}' 항목은 업체별 단위가 달라 직접 단가 비교 전에 환산 기준 확인이 필요합니다. 단위={', '.join(sorted(real_units))}",
                    })
    return issues
