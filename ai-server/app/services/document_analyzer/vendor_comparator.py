from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.services.unit_normalizer import clean_cell_text, enrich_row_units
from app.services.document_analyzer.table_utils import (
    compact_text,
    clean_number,
    to_number,
    _env_int,
    _company_compare_key,
    _valid_focus_term,
    GENERIC_FOCUS_TERMS,
    PRICE_VALUE_PRIORITY,
    MULTI_VENDOR_COMPARE_TABLE_TYPE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_compare_key(label: str, index: int, suffix: str = "unit_price") -> str:
    raw = compact_text(label) or f"vendor{index}"
    m = re.search(r"([A-Za-z0-9]+)회사", str(label or ""), re.I)
    if m:
        base = f"company_{m.group(1).lower()}"
    else:
        base = re.sub(r"[^A-Za-z0-9]+", "_", raw).strip("_").lower() or f"vendor_{index}"
    return f"{base}_{suffix}"


def _extract_company_name(filename: str, text: str = "", rows: List[Dict[str, Any]] | None = None, index: int = 1) -> str:
    """원문/행/파일명에서 실제 업체명을 추출한다."""
    source = f"{filename}\n{text[:1800]}"
    label_patterns = [
        r"업체명\s*[:：]?\s*([^\n\r\t]{1,80})",
        r"회사명\s*[:：]?\s*([^\n\r\t]{1,80})",
        r"상호\s*[:：]?\s*([^\n\r\t]{1,80})",
        r"공급자\s*[:：]?\s*([^\n\r\t]{1,80})",
        r"견적업체\s*[:：]?\s*([^\n\r\t]{1,80})",
    ]
    for pattern in label_patterns:
        m = re.search(pattern, source)
        if m:
            value = clean_cell_text(m.group(1))
            value = re.split(r"\s{2,}|\t|사업자|대표|견적일자|주소|전화|연락처|TEL|Fax|FAX", value)[0].strip()
            if value:
                return value[:40]

    for row in rows or []:
        value = clean_cell_text(row.get("vendor_name") or row.get("company_name") or "")
        if value:
            return value[:40]

    for line in [line.strip() for line in source.splitlines()[:30] if line.strip()]:
        m = re.search(r"[^\s·:\-]{1,30}\s*[·:\-]\s*([㈜\(\)가-힣A-Za-z0-9\s&._-]{2,70})", line)
        if m:
            value = clean_cell_text(m.group(1))
            if value and not any(skip in compact_text(value) for skip in ["건설공사견적서", "표준시장단가비교용"]):
                return value[:40]

    stem = Path(filename or f"업체{index}").stem.strip()
    parts = [clean_cell_text(part) for part in re.split(r"[_\-]+", stem) if clean_cell_text(part)]
    if parts:
        return parts[0][:40]
    return stem[:40] or f"업체{index}"


def _request_wants_company_comparison(user_request: str, llm_intent: Dict[str, Any] | None = None) -> bool:
    request = compact_text(user_request)
    intent_name = ""
    if isinstance(llm_intent, dict):
        intent_name = str(llm_intent.get("intent") or "").strip().upper()
    if intent_name == "COMPANY_COMPARISON":
        return True
    comparison_terms = ["회사별", "업체별", "거래처별", "견적비교", "단가비교", "비교표"]
    if any(term in request for term in comparison_terms):
        return True
    if "비교" in request and any(term in request for term in ["회사", "업체", "견적", "단가", "가격", "금액"]):
        return True
    company_mentioned = bool(re.search(r"[A-Za-z]\s*회사", str(user_request or ""), re.I))
    company_mentioned = company_mentioned or any(term in request for term in ["에이건설", "비테크건설", "씨엔씨종합건설", "대동종합건설", "이엔지건설", "건설㈜", "종합건설"])
    return company_mentioned and any(term in request for term in ["단가", "견적", "표", "수량", "기준", "금액", "가격"])


def _request_wants_standard_price(user_request: str, llm_intent: Dict[str, Any] | None = None) -> bool:
    request = compact_text(user_request)
    explicit_terms = ["표준시장단가", "표준시장", "표준단가", "기준단가", "시장단가", "표준가"]
    if any(term in request for term in explicit_terms):
        return True
    if isinstance(llm_intent, dict) and llm_intent.get("requiresStandardPrice") is True:
        return any(term in request for term in explicit_terms)
    return False


def _prune_standard_price_from_compare_table(table: Dict[str, Any], include_standard_price: bool) -> Dict[str, Any]:
    if include_standard_price or not isinstance(table, dict):
        return table
    hide_keys = {"standard_unit_price", "lowest_vs_standard"}
    next_table = dict(table)
    next_table["columns"] = [col for col in (table.get("columns") or []) if col.get("key") not in hide_keys]
    next_rows = []
    for row in table.get("rows") or []:
        if not isinstance(row, dict):
            next_rows.append(row)
            continue
        next_row = {k: v for k, v in row.items() if k not in hide_keys}
        next_rows.append(next_row)
    next_table["rows"] = next_rows
    meta = dict(next_table.get("meta") or {})
    meta["standardPriceHidden"] = True
    meta["standardPriceDisplayPolicy"] = "사용자가 표준시장단가/기준단가를 명시 요청할 때만 표시"
    next_table["meta"] = meta
    return next_table


def _row_has_price_value(row: Dict[str, Any]) -> bool:
    return any(to_number(row.get(key)) > 0 for key in ["vendor_unit_price", "unit_price", "amount", "standard_unit_price"])


def _get_vendor_price_text(row: Dict[str, Any]) -> str:
    """업체 비교에 사용할 가격을 가져온다. standard_unit_price는 업체 가격으로 사용하지 않는다."""
    for key in PRICE_VALUE_PRIORITY:
        value = clean_number(row.get(key) or "")
        if value:
            return value
    return ""


def _is_standard_market_file(filename: str, text: str, rows: List[Dict[str, Any]] | None = None, user_request: str = "", llm_intent: Dict[str, Any] | None = None) -> bool:
    rows = rows or []
    compact = compact_text(f"{filename}\n{text[:5000]}")
    standard_markers = sum(1 for marker in ["건설공사표준시장단가", "표준시장단가", "공종코드", "공종명칭", "노무비율"] if compact_text(marker) in compact)
    estimate_markers = sum(1 for marker in ["견적서", "견적", "업체명", "회사명", "공급가액", "합계금액"] if compact_text(marker) in compact)
    price_rows = sum(1 for row in rows if isinstance(row, dict) and clean_cell_text(row.get("item_name") or row.get("construction_code") or "") and _row_has_price_value(row))

    if _request_wants_company_comparison(user_request, llm_intent) and price_rows >= 2:
        return standard_markers >= 4 and estimate_markers == 0
    return standard_markers >= 3 and estimate_markers == 0


def _is_estimate_file(filename: str, text: str, rows: List[Dict[str, Any]], user_request: str = "", llm_intent: Dict[str, Any] | None = None) -> bool:
    compact = compact_text(f"{filename}\n{text[:4000]}")
    has_estimate_word = any(word in compact for word in ["견적서", "견적", "업체명", "회사명", "합계금액", "공사견적"])
    has_price_rows = sum(1 for row in rows if isinstance(row, dict) and _row_has_price_value(row) and str(row.get("item_name") or row.get("construction_code") or "").strip()) >= 2
    if _request_wants_company_comparison(user_request, llm_intent) and has_price_rows:
        return True
    if _is_standard_market_file(filename, text, rows, user_request=user_request, llm_intent=llm_intent):
        return False
    return bool(has_estimate_word or has_price_rows)


def _row_match_key(row: Dict[str, Any]) -> str:
    code = compact_text(row.get("construction_code"))
    item = compact_text(row.get("item_name"))
    spec = compact_text(row.get("spec"))
    unit = compact_text(row.get("unit_normalized") or row.get("unit"))
    if item or spec or unit:
        return f"code:{code}|item:{item}|spec:{spec}|unit:{unit}" if code else f"text:{item}|{spec}|{unit}"
    return f"code:{code}" if code else "text:||"


def _row_relaxed_key(row: Dict[str, Any]) -> str:
    return f"{compact_text(row.get('item_name'))}|{compact_text(row.get('spec'))}"


def _row_item_key(row: Dict[str, Any]) -> str:
    return compact_text(row.get("item_name"))


def _find_reference_row(company_row: Dict[str, Any], reference_rows: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    if not reference_rows:
        return None
    code = compact_text(company_row.get("construction_code"))
    if code:
        for ref in reference_rows:
            if compact_text(ref.get("construction_code")) == code:
                return ref
    relaxed = _row_relaxed_key(company_row)
    if relaxed != "|":
        for ref in reference_rows:
            if _row_relaxed_key(ref) == relaxed:
                return ref
    item = _row_item_key(company_row)
    unit = clean_cell_text(company_row.get("unit_normalized") or company_row.get("unit"))
    if item:
        candidates = [ref for ref in reference_rows if _row_item_key(ref) == item]
        if unit:
            same_unit = [ref for ref in candidates if clean_cell_text(ref.get("unit_normalized") or ref.get("unit")) == unit]
            if same_unit:
                return same_unit[0]
        if candidates:
            return candidates[0]
    return None


def _extract_focus_terms(
    user_request: str,
    company_rows: List[Dict[str, Any]],
    reference_rows: List[Dict[str, Any]],
    llm_terms: List[str] | None = None,
) -> List[str]:
    """사용자 요청에서 비교 대상 품목을 추출한다."""
    raw_request = str(user_request or "")
    req = compact_text(raw_request)
    if not req:
        return []

    row_names = []
    seen_names = set()
    for row in [*company_rows, *reference_rows]:
        name = clean_cell_text(row.get("item_name") or "")
        key = compact_text(name)
        if key and key not in seen_names:
            row_names.append((name, key))
            seen_names.add(key)

    exact_terms = [key for _name, key in row_names if len(key) >= 2 and key in req and _valid_focus_term(key)]
    if exact_terms:
        return sorted(set(exact_terms), key=len, reverse=True)

    candidates: List[str] = []

    def add_candidate(value: Any) -> None:
        term = compact_text(value)
        if not _valid_focus_term(term):
            return
        if term in GENERIC_FOCUS_TERMS:
            return
        if term not in req:
            if not any(term in name_key or name_key in term for _name, name_key in row_names if name_key):
                return
        candidates.append(term)

    for term in llm_terms or []:
        add_candidate(term)

    for token in re.split(r"[,，/\\n]+", raw_request):
        token = token.strip()
        for m in re.finditer(r"([가-힣A-Za-z0-9·./_\-]+(?:\([^\)]+\))?)", token):
            add_candidate(m.group(1))

    stop_words = {
        "표", "표로", "비교", "비교표", "파일", "각각", "다시", "만들어", "만들어서",
        "기준", "회사", "업체", "자료", "문서", "보고", "봐서", "해줘", "해줄래", "정리",
        "추가", "이것도", "저것도", "나오게", "보여줘", "첨부", "분석", "업체별", "회사별",
        "단가", "견적", "견적서", "비교견적서", "자사양식", "엑셀"
    }
    for m in re.finditer(r"([가-힣A-Za-z0-9·./()_\-]{2,40})(?:만|를|을|로|기준|비교|표|나오게|보여줘|추가|포함|같이|함께)", raw_request):
        term = compact_text(m.group(1))
        if term not in stop_words and not any(sw in term for sw in ["파일보고", "다시비교", "표로만들"]):
            add_candidate(term)

    row_key_set = {key for _name, key in row_names}
    exact_again = [term for term in candidates if term in row_key_set]
    if exact_again:
        return sorted(set(exact_again), key=len, reverse=True)

    return sorted(set(candidates), key=len, reverse=True)


def _filter_rows_by_focus(rows: List[Dict[str, Any]], focus_terms: List[str]) -> List[Dict[str, Any]]:
    terms = [term for term in (focus_terms or []) if _valid_focus_term(term)]
    if not terms:
        return rows

    row_item_keys = {compact_text(row.get("item_name")) for row in rows if compact_text(row.get("item_name"))}
    exact_terms = {term for term in terms if term in row_item_keys}

    filtered: List[Dict[str, Any]] = []
    for row in rows:
        item = compact_text(row.get("item_name"))
        code = compact_text(row.get("construction_code"))
        spec = compact_text(row.get("spec"))
        haystack = compact_text(" ".join([str(row.get("item_name") or ""), str(row.get("construction_code") or ""), str(row.get("spec") or "")]))
        if exact_terms:
            if item in exact_terms or code in exact_terms:
                filtered.append(row)
        elif any(term in haystack or haystack in term or term == spec for term in terms):
            filtered.append(row)
    return filtered


def _format_price_diff(company_price: float, standard_price: float) -> str:
    if not company_price or not standard_price:
        return ""
    diff = company_price - standard_price
    pct = (diff / standard_price) * 100 if standard_price else 0
    sign = "+" if diff > 0 else ""
    return f"{sign}{diff:,.0f} ({sign}{pct:.1f}%)"


def _extract_requested_quantity(user_request: str = "", llm_intent: Dict[str, Any] | None = None) -> Tuple[str, str]:
    """사용자가 지정한 수량을 추출한다."""
    text = str(user_request or "")

    def valid_match(match: re.Match) -> Tuple[str, str] | None:
        qty = clean_number(match.group("qty"))
        unit = str(match.groupdict().get("unit") or "").strip()
        if not qty:
            return None
        after = text[match.end(): match.end() + 12]
        before = text[max(0, match.start() - 8): match.start()]
        if re.match(r"\s*(업체|회사|파일|문서|자료|개사)", after):
            return None
        if re.search(r"(업체|회사|파일|문서)\s*$", before):
            return None
        return qty, unit

    patterns = [
        r"각\s*(?P<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?\s*씩?",
        r"(?P<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)\s*씩",
        r"수량\s*[:=]?\s*(?P<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?",
        r"(?P<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?\s*(?:기준|으로|만큼|수량)",
        r"(?P<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)"
    ]
    for pattern in patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            found = valid_match(m)
            if found:
                return found

    if isinstance(llm_intent, dict):
        for key in ("quantity", "requestedQuantity", "requested_quantity", "qty"):
            raw = llm_intent.get(key)
            if isinstance(raw, dict):
                value = raw.get("value") or raw.get("quantity") or raw.get("qty")
                unit = str(raw.get("unit") or "").strip()
                if value not in (None, ""):
                    return clean_number(value), unit
            elif raw not in (None, ""):
                return clean_number(raw), ""
    return "", ""


def _dedupe_vendor_sources(vendor_sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """같은 회사가 이전 작업 파일과 새 파일에 중복 포함되면 한 회사로 합친다."""
    ordered: List[str] = []
    by_key: Dict[str, Dict[str, Any]] = {}
    for source in vendor_sources or []:
        key = _company_compare_key(source.get("name")) or compact_text(source.get("name"))
        if not key:
            continue
        if key not in by_key:
            ordered.append(key)
            by_key[key] = {**source, "rows": []}
        current = by_key[key]
        current["name"] = source.get("name") or current.get("name")
        current["filename"] = source.get("filename") or current.get("filename")
        row_map = {_row_match_key(row): row for row in current.get("rows") or []}
        for row in source.get("rows") or []:
            row_map[_row_match_key(row)] = row
        current["rows"] = list(row_map.values())
    return [by_key[key] for key in ordered]


def _clean_item_display(value: Any) -> str:
    """PDF 셀 줄바꿈으로 분리된 공종명을 화면/엑셀에 보기 좋게 정리한다."""
    text = clean_cell_text(value)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*([()])\s*", r"\1", text)
    text = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", text)
    text = re.sub(r"(?<=P\.P)\s+(?=마대)", "", text, flags=re.I)
    return text.strip()


def _strip_company_alias_prefix(value: Any) -> str:
    text = clean_cell_text(value)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^\s*[A-Za-z]\s*회사\s*[·ㆍ:：\-–—]*\s*", "", text, flags=re.I)
    text = re.sub(r"^\s*[A-Za-z]\s*회사(?=㈜|\(주\)|주식회사|[가-힣A-Za-z0-9])\s*", "", text, flags=re.I)
    return text.strip()


def _clean_vendor_label_display(value: Any) -> str:
    text = clean_cell_text(value)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"([A-Za-z])\s*회사", r"\1회사", text)
    text = re.sub(r"㈜\s+", "㈜", text)
    text = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", text)
    text = re.sub(r"([A-Za-z]회사)(?=[가-힣㈜])", r"\1 ", text)
    text = _strip_company_alias_prefix(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip()


def _has_vendor_like_price_columns(row: Dict[str, Any]) -> bool:
    return bool(_collect_dynamic_vendor_columns([row]))


def _vendor_column_canonical_key(label: Any, key: Any) -> str:
    joined = f"{label or ''} {key or ''}"
    alias = re.search(r"([A-Za-z])\s*회사", str(joined or ""), re.I)
    if alias:
        return f"company_{alias.group(1).lower()}"
    display = _clean_vendor_label_display(joined)
    canonical = compact_text(display)
    canonical = re.sub(r"(?:단가|금액|견적가|견적단가|업체견적단가)$", "", canonical)
    return canonical or compact_text(key or "")


def _vendor_column_sort_key(canonical: str, first_index: int) -> Tuple[int, int]:
    m = re.match(r"company_([a-z])$", canonical or "")
    if m:
        return (ord(m.group(1)) - ord("a"), first_index)
    return (1000 + first_index, first_index)


def _collect_dynamic_vendor_columns(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """한 파일 안의 업체 단가 컬럼을 감지하고, 깨진 중복 컬럼은 같은 업체로 묶는다."""
    reserved = {
        "no", "no.", "number", "construction_code", "item_name", "spec", "quantity", "unit",
        "standard_unit_price", "vendor_unit_price", "unit_price", "amount", "price_diff", "diff_rate",
        "labor_ratio", "remark", "unit_original", "unit_normalized", "unit_group", "unit_confidence",
        "request_quantity", "field", "이", "e회이엔설",
    }
    groups: Dict[str, Dict[str, Any]] = {}
    column_position = 0
    for row_index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            continue
        source_headers = row.get("_source_headers") if isinstance(row.get("_source_headers"), dict) else {}
        for key, value in row.items():
            if key.startswith("_") or key in reserved or re.sub(r"_\d+$", "", key) in reserved:
                continue
            if to_number(value) <= 0:
                continue
            header = _clean_vendor_label_display(source_headers.get(key) or key)
            compact_header = compact_text(header)
            compact_key = compact_text(key)
            semantic_stop = ["표준", "기준", "최저", "최고", "합계", "소계", "수량", "단위", "규격", "공종", "코드", "노무", "차이", "대비", "금액합계"]
            looks_like_vendor = bool(compact_header or compact_key)
            if any(stop in compact_header for stop in semantic_stop) or any(stop in compact_key for stop in semantic_stop):
                looks_like_vendor = False
            if not looks_like_vendor:
                continue
            canonical = _vendor_column_canonical_key(header, key)
            if not canonical:
                continue
            if canonical not in groups:
                groups[canonical] = {
                    "canonical": canonical,
                    "key": key,
                    "label": header or key,
                    "aliases": [],
                    "valueCount": 0,
                    "firstIndex": column_position,
                    "labelScore": 0,
                }
                column_position += 1
            group = groups[canonical]
            if key not in group["aliases"]:
                group["aliases"].append(key)
            group["valueCount"] += 1
            score = 0
            if re.search(r"[A-Za-z]\s*회사", header, re.I):
                score += 100
            if "㈜" in header or "건설" in header:
                score += 20
            score += min(len(compact_header), 40)
            if score > group.get("labelScore", 0):
                group["label"] = header or group["label"]
                group["key"] = key
                group["labelScore"] = score

    result = list(groups.values())
    has_alias_groups = any(re.match(r"company_[a-z]$", str(item.get("canonical") or ""), re.I) for item in result)
    if has_alias_groups:
        result = [item for item in result if re.match(r"company_[a-z]$", str(item.get("canonical") or ""), re.I)]
    result.sort(key=lambda item: _vendor_column_sort_key(str(item.get("canonical") or ""), int(item.get("firstIndex") or 0)))
    return result


def _vendor_label_search_terms(label: Any, key: Any = "", aliases: List[Any] | None = None) -> List[str]:
    raw_values = [str(label or ""), str(key or "")]
    raw_values.extend([str(item or "") for item in (aliases or [])])
    pieces: List[str] = []
    stopwords = {
        "회사", "업체", "단가", "금액", "견적", "견적가", "견적단가", "업체견적단가",
        "표준", "기준", "최저", "최고", "요청", "수량", "단위", "규격", "공종", "코드", "일반",
        "전기", "설비", "기술", "건설", "종합", "시스템", "이엔지", "엔지니어링", "주식회사",
    }
    for raw in raw_values:
        if not raw:
            continue
        cleaned = clean_cell_text(raw)
        cleaned = re.sub(r"\s*(단가|금액|견적가|견적단가|업체견적단가)$", "", cleaned)
        cleaned = _strip_company_alias_prefix(cleaned)
        no_corp = re.sub(r"주식회사|\(주\)|㈜|（주）|유한회사|합자회사|합명회사", " ", cleaned)
        for candidate in [cleaned, no_corp]:
            token = compact_text(candidate)
            if token and len(token) >= 2 and token not in stopwords:
                pieces.append(token)
        for piece in re.split(r"[\s·ㆍ/()\[\]{},._\-]+", no_corp):
            token = compact_text(piece)
            if token and len(token) >= 2 and token not in stopwords:
                pieces.append(token)
        alias = re.search(r"([A-Za-z])\s*회사", raw, re.I)
        if alias:
            pieces.append(compact_text(alias.group(0)))
    return list(dict.fromkeys(pieces))


def _requested_vendor_count(user_request: str) -> int | None:
    text = str(user_request or "")
    patterns = [
        r"(?:회사|업체|거래처)\s*(?P<count>[0-9]{1,2})\s*개",
        r"(?P<count>[0-9]{1,2})\s*개\s*(?:회사|업체|거래처)",
        r"(?P<count>[0-9]{1,2})\s*(?:개사|개 업체|개 회사)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            try:
                count = int(m.group("count"))
                if 1 <= count <= 50:
                    return count
            except Exception:
                pass
    korean_counts = {"한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5}
    for word, count in korean_counts.items():
        if re.search(fr"{word}\s*(?:개\s*)?(?:회사|업체|거래처)", text):
            return count
    return None


def _request_vendor_terms_from_message(user_request: str) -> List[str]:
    text = str(user_request or "")
    if not text.strip():
        return []
    cleaned = re.sub(r"(비교해서|비교해줘|비교|단가|금액|수량|각각|기준|표|정리|만들어줘|해줄래|해줘|보여줘|보여줄래|추가|제외|빼줘|삭제|제거|회사|업체|거래처|개사|개씩|개)", " ", text)
    cleaned = re.sub(r"[0-9]+\s*(?:개|개씩|개사|회사|업체)?", " ", cleaned)
    parts = re.split(r"[,，/\n\t]+|\s{2,}", cleaned)
    tokens: List[str] = []
    stop = {"이", "그", "저", "현재", "문서", "파일", "첨부", "전체", "항목", "공종", "기준", "으로", "로", "만", "그리고", "랑", "와", "과", "및", "기중차단기", "몰드변압기", "설치"}
    for part in parts:
        part = part.strip()
        if not part:
            continue
        for piece in re.split(r"\s+(?:랑|와|과|및)\s+|\s+", part):
            token = compact_text(piece)
            if token and len(token) >= 2 and token not in stop and not _looks_like_work_item_term(token):
                tokens.append(token)
        joined = compact_text(part)
        if joined and len(joined) >= 3 and joined not in stop and not _looks_like_work_item_term(joined):
            tokens.append(joined)
    for m in re.finditer(r"[A-Za-z]\s*회사", text):
        tokens.append(compact_text(m.group(0)))
    return list(dict.fromkeys(tokens))


_TEXT_WORK_ITEM_HINTS = ("설치", "포설", "배선", "조립", "제작", "철거", "교체", "시공", "공사", "공종", "항목")


def _looks_like_work_item_term(term: str) -> bool:
    token = compact_text(term)
    if not token:
        return False
    return any(hint in token for hint in _TEXT_WORK_ITEM_HINTS)


def _strip_corp_prefix(name: str) -> str:
    value = clean_cell_text(name)
    value = re.sub(r"^(?:㈜|\(주\)|주식회사)\s*", "", value)
    value = re.sub(r"\s*(?:㈜)$", "", value)
    return value.strip()


def _text_report_vendor_match_terms(vendor: Dict[str, Any]) -> List[str]:
    name = clean_cell_text(vendor.get('name'))
    alias = clean_cell_text(vendor.get('alias'))
    stripped = _strip_corp_prefix(name)
    terms = [compact_text(name), compact_text(stripped), compact_text(alias)]
    if stripped and name != stripped:
        terms.append(compact_text(f"㈜{stripped}"))
        terms.append(compact_text(f"(주){stripped}"))
    return [term for term in dict.fromkeys(terms) if term and len(term) >= 2]


def _request_has_explicit_vendor_mention(vendor_columns: List[Dict[str, Any]], user_request: str) -> bool:
    compact_request = compact_text(user_request)
    if not compact_request:
        return False
    if _request_vendor_terms_from_message(user_request):
        return True
    for col in vendor_columns or []:
        terms = _vendor_label_search_terms(col.get("label"), col.get("key"), col.get("aliases") or [])
        for term in terms:
            if term and len(term) >= 2 and term in compact_request:
                return True
    return False


def _vendor_column_matches_request(col: Dict[str, Any], request_terms: List[str], compact_request: str) -> bool:
    terms = _vendor_label_search_terms(col.get("label"), col.get("key"), col.get("aliases") or [])
    for term in terms:
        if not term or len(term) < 2:
            continue
        if compact_request and term in compact_request:
            return True
        for req in request_terms:
            if not req or len(req) < 2:
                continue
            if term in req or req in term:
                return True
    return False


def _filter_vendor_columns_by_request(vendor_columns: List[Dict[str, str]], user_request: str) -> List[Dict[str, str]]:
    request = str(user_request or "")
    compact_request = compact_text(request)
    exclude_fragments = re.split(r"(?:말고|빼고|제외하고|제외|빼줘|삭제|제거)", request, maxsplit=1)
    compact_exclude = compact_text(exclude_fragments[0]) if len(exclude_fragments) > 1 else ""
    requested_count = _requested_vendor_count(request)
    request_terms = _request_vendor_terms_from_message(request)
    selected: List[Dict[str, str]] = []

    for col in vendor_columns or []:
        terms = _vendor_label_search_terms(col.get("label"), col.get("key"), col.get("aliases") or [])
        if compact_exclude and any(term and term in compact_exclude for term in terms):
            continue
        if _vendor_column_matches_request(col, request_terms, compact_request):
            selected.append(col)

    if selected:
        deduped: List[Dict[str, str]] = []
        seen = set()
        for col in selected:
            ident = col.get("canonical") or col.get("key") or col.get("label")
            if ident in seen:
                continue
            seen.add(ident)
            deduped.append(col)
        return deduped[:requested_count] if requested_count else deduped

    has_explicit_vendor_text = bool(request_terms)
    if requested_count and not has_explicit_vendor_text:
        return vendor_columns[:requested_count]
    if has_explicit_vendor_text:
        return []
    return vendor_columns


def _requested_company_terms(user_request: str) -> List[str]:
    text = str(user_request or "")
    tokens = []
    cleaned = re.sub(r"(비교|단가|금액|수량|회사|업체|개|각각|으로|로|만|해줘|보여줘|추가|제외|빼줘|표|만들어줘)", " ", text)
    for piece in re.split(r"[\s,，/]+", cleaned):
        token = compact_text(piece)
        if token and len(token) >= 2:
            tokens.append(token)
    return list(dict.fromkeys(tokens))


def _get_dynamic_vendor_price(row: Dict[str, Any], col: Dict[str, Any]) -> str:
    keys = []
    key = col.get("key")
    if key:
        keys.append(str(key))
    for alias in col.get("aliases") or []:
        alias_key = str(alias or "")
        if alias_key and alias_key not in keys:
            keys.append(alias_key)
    for candidate_key in keys:
        value = clean_number(row.get(candidate_key) or "")
        if value:
            return value
    return ""


def _repair_page_split_item_names(rows: List[Dict[str, Any]], vendor_columns: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """페이지 경계 때문에 분리된 품목명을 병합한다."""
    repaired: List[Dict[str, Any]] = []
    idx = 0
    while idx < len(rows):
        row = dict(rows[idx])
        next_row = rows[idx + 1] if idx + 1 < len(rows) and isinstance(rows[idx + 1], dict) else None
        if next_row:
            current_item = _clean_item_display(row.get("item_name"))
            next_item = _clean_item_display(next_row.get("item_name"))
            current_has_prices = any(to_number(_get_dynamic_vendor_price(row, col)) > 0 for col in vendor_columns) or to_number(row.get("standard_unit_price")) > 0
            next_has_code_or_prices = bool(clean_cell_text(next_row.get("construction_code"))) or any(to_number(_get_dynamic_vendor_price(next_row, col)) > 0 for col in vendor_columns) or to_number(next_row.get("standard_unit_price")) > 0
            if current_has_prices and current_item and next_item and not next_has_code_or_prices:
                if next_item.startswith("대(") or next_item.startswith("(") or compact_text(current_item + next_item) in compact_text(f"{current_item}{next_item}"):
                    row["item_name"] = _clean_item_display(f"{current_item} {next_item}")
                    idx += 2
                    repaired.append(row)
                    continue
        if row.get("item_name"):
            row["item_name"] = _clean_item_display(row.get("item_name"))
        repaired.append(row)
        idx += 1
    return repaired


# ---------------------------------------------------------------------------
# build_single_file_multi_vendor_price_comparison
# ---------------------------------------------------------------------------

def build_single_file_multi_vendor_price_comparison(
    parsed_files: List[Dict[str, Any]],
    user_request: str = "",
    llm_intent: Dict[str, Any] | None = None,
) -> Dict[str, Any] | None:
    """단일 PDF/엑셀 안에 여러 업체 단가 컬럼이 가로로 들어간 비교표를 생성한다."""
    if not parsed_files:
        return None
    request = str(user_request or "")
    if not _request_wants_company_comparison(request, llm_intent):
        return None
    include_standard_price = _request_wants_standard_price(request, llm_intent)

    target_file = None
    target_rows: List[Dict[str, Any]] = []
    target_vendor_columns: List[Dict[str, str]] = []
    for file in parsed_files:
        rows = [enrich_row_units(dict(row)) for row in (file.get("parsedRows") or file.get("rows") or []) if isinstance(row, dict)]
        vendor_columns = _collect_dynamic_vendor_columns(rows)
        if len(vendor_columns) >= 2:
            target_file = file
            target_rows = rows
            target_vendor_columns = vendor_columns
            break
    if not target_file or len(target_vendor_columns) < 2:
        return None

    selected_vendor_columns = _filter_vendor_columns_by_request(target_vendor_columns, request)
    explicit_vendor_request = _request_has_explicit_vendor_mention(target_vendor_columns, request)
    if not selected_vendor_columns and not explicit_vendor_request:
        selected_vendor_columns = target_vendor_columns

    target_rows = _repair_page_split_item_names(target_rows, target_vendor_columns)

    if not selected_vendor_columns:
        return {
            "tableName": "업체별 단가 비교표",
            "tableType": MULTI_VENDOR_COMPARE_TABLE_TYPE,
            "columns": [
                {"key": "item_name", "label": "공종명칭"},
                {"key": "remark", "label": "비고"},
            ],
            "rows": [{
                "item_name": "요청 업체",
                "remark": "사용자가 입력한 업체명과 일치하는 원본 업체 컬럼을 찾지 못했습니다.",
            }],
            "meta": {
                "sourceMode": "single_file_multi_vendor",
                "vendorCount": 0,
                "vendors": [],
                "allVendors": [{"name": _clean_vendor_label_display(col["label"]), "columnKey": col["key"]} for col in target_vendor_columns],
                "requestedCompanyTerms": _requested_company_terms(request),
                "requestedVendorCount": _requested_vendor_count(request),
                "standardPriceShown": include_standard_price,
                "standardPriceHidden": not include_standard_price,
            },
        }

    llm_terms: List[str] = []
    if isinstance(llm_intent, dict):
        raw_terms = llm_intent.get("targetKeywords") or llm_intent.get("target_keywords") or []
        if isinstance(raw_terms, list):
            llm_terms = [str(term) for term in raw_terms if str(term or "").strip()]
    focus_terms = _extract_focus_terms(request, target_rows, [], llm_terms=llm_terms)
    request_quantity, request_quantity_unit = _extract_requested_quantity(request, llm_intent)

    all_candidate_rows: List[Dict[str, Any]] = []
    for row in target_rows:
        if not clean_cell_text(row.get("item_name") or row.get("construction_code")):
            continue
        if str(row.get("no.") or row.get("no") or "").strip().startswith("소"):
            continue
        if not any(to_number(_get_dynamic_vendor_price(row, col)) > 0 for col in target_vendor_columns):
            continue
        all_candidate_rows.append(row)

    candidate_rows = list(all_candidate_rows)
    if focus_terms:
        candidate_rows = _filter_rows_by_focus(candidate_rows, focus_terms)

    def build_output(rows_for_output: List[Dict[str, Any]], vendor_cols: List[Dict[str, Any]]) -> Tuple[List[Dict[str, str]], List[Dict[str, Any]], List[Dict[str, Any]]]:
        columns: List[Dict[str, str]] = [
            {"key": "construction_code", "label": "공종코드"},
            {"key": "item_name", "label": "공종명칭"},
            {"key": "spec", "label": "규격"},
            {"key": "quantity", "label": "요청 수량"},
            {"key": "unit", "label": "단위"},
        ]
        if include_standard_price:
            columns.append({"key": "standard_unit_price", "label": "표준시장단가"})

        vendor_key_map: Dict[str, Dict[str, str]] = {}
        vendor_meta: List[Dict[str, Any]] = []
        for idx, col in enumerate(vendor_cols, start=1):
            clean_label = _clean_vendor_label_display(col.get("label") or col.get("key") or f"업체{idx}")
            unit_price_key = _safe_compare_key(clean_label, idx, "unit_price")
            amount_key = _safe_compare_key(clean_label, idx, "amount")
            vendor_key_map[col["key"]] = {"unitPriceKey": unit_price_key, "amountKey": amount_key, "label": clean_label}
            vendor_meta.append({
                "name": clean_label,
                "index": idx - 1,
                "sourceColumnKey": col.get("key"),
                "unitPriceKey": unit_price_key,
                "amountKey": amount_key,
                "canonical": col.get("canonical"),
            })
            columns.append({"key": unit_price_key, "label": f"{clean_label} 단가"})
            columns.append({"key": amount_key, "label": f"{clean_label} 금액"})

        columns.extend([
            {"key": "lowest_vendor", "label": "최저 업체"},
            {"key": "lowest_unit_price", "label": "최저 단가"},
            {"key": "lowest_amount", "label": "최저 금액"},
        ])
        if include_standard_price:
            columns.append({"key": "lowest_vs_standard", "label": "최저-표준 차이"})
        columns.append({"key": "remark", "label": "비고"})

        output_rows: List[Dict[str, Any]] = []
        for row in rows_for_output:
            standard_price = to_number(row.get("standard_unit_price"))
            out: Dict[str, Any] = {
                "construction_code": clean_cell_text(row.get("construction_code") or ""),
                "item_name": _clean_item_display(row.get("item_name") or ""),
                "spec": clean_cell_text(row.get("spec") or ""),
                "quantity": request_quantity or clean_number(row.get("quantity") or ""),
                "request_quantity": request_quantity or clean_number(row.get("quantity") or ""),
                "unit": clean_cell_text(row.get("unit_normalized") or row.get("unit") or request_quantity_unit or ""),
                "remark": "",
            }
            if include_standard_price:
                out["standard_unit_price"] = clean_number(row.get("standard_unit_price") or "")
            vendor_prices: List[Tuple[float, str]] = []
            qty_value = to_number(out.get("quantity"))
            for col in vendor_cols:
                price_text = _get_dynamic_vendor_price(row, col)
                key_info = vendor_key_map[col["key"]]
                out[key_info["unitPriceKey"]] = price_text
                price = to_number(price_text)
                if price:
                    amount = price * qty_value if qty_value else 0
                    out[key_info["amountKey"]] = f"{amount:,.0f}" if amount else ""
                    vendor_prices.append((price, key_info["label"]))
                else:
                    out[key_info["amountKey"]] = ""
            if vendor_prices:
                lowest_price, lowest_vendor = min(vendor_prices, key=lambda item: item[0])
                out["lowest_vendor"] = lowest_vendor
                out["lowest_unit_price"] = f"{lowest_price:,.0f}"
                out["lowest_amount"] = f"{lowest_price * qty_value:,.0f}" if qty_value else ""
                if include_standard_price:
                    out["lowest_vs_standard"] = _format_price_diff(lowest_price, standard_price)
            output_rows.append(out)
        return columns, output_rows, vendor_meta

    if not candidate_rows:
        return {
            "tableName": "업체별 단가 비교표",
            "tableType": MULTI_VENDOR_COMPARE_TABLE_TYPE,
            "columns": [
                {"key": "item_name", "label": "공종명칭"},
                {"key": "remark", "label": "비고"},
            ],
            "rows": [{
                "item_name": ", ".join(focus_terms) if focus_terms else "요청 공종",
                "remark": "요청한 공종/업체 조건과 일치하는 단가 행을 찾지 못했습니다.",
            }],
            "meta": {
                "sourceMode": "single_file_multi_vendor",
                "vendorCount": len(selected_vendor_columns),
                "vendors": [{"name": _clean_vendor_label_display(col["label"]), "columnKey": col["key"]} for col in selected_vendor_columns],
                "allVendors": [{"name": _clean_vendor_label_display(col["label"]), "columnKey": col["key"]} for col in target_vendor_columns],
                "focusTerms": focus_terms,
            },
        }

    columns, result_rows, selected_vendor_meta = build_output(candidate_rows, selected_vendor_columns)
    all_columns, all_rows, all_vendor_meta = build_output(all_candidate_rows, target_vendor_columns)

    return {
        "tableName": "업체별 단가 비교표",
        "tableType": MULTI_VENDOR_COMPARE_TABLE_TYPE,
        "columns": columns,
        "rows": result_rows,
        "meta": {
            "sourceMode": "single_file_multi_vendor",
            "sourceFileName": str(target_file.get("originalName") or target_file.get("original_name") or ""),
            "vendorCount": len(selected_vendor_columns),
            "vendors": selected_vendor_meta,
            "allVendors": all_vendor_meta,
            "allColumns": all_columns,
            "allRows": all_rows,
            "focusTerms": focus_terms,
            "requestedCompanyTerms": _requested_company_terms(request),
            "requestedVendorCount": _requested_vendor_count(request),
            "standardPriceShown": include_standard_price,
            "standardPriceHidden": not include_standard_price,
        },
    }


# ---------------------------------------------------------------------------
# build_multi_vendor_price_comparison
# ---------------------------------------------------------------------------

def build_multi_vendor_price_comparison(
    parsed_files: List[Dict[str, Any]],
    user_request: str = "",
    llm_intent: Dict[str, Any] | None = None,
    include_all_rows: bool = True,
) -> Dict[str, Any] | None:
    from app.services.document_analyzer.table_utils import (
        prune_empty_columns,
        merge_standard_market_rows,
    )
    from app.services.document_analyzer.text_extractor import extract_standard_market_rows_from_text
    from app.services.document_analyzer.table_utils import _normalize_price_role_fallback

    if len(parsed_files or []) < 2:
        return None
    request = str(user_request or "")
    include_standard_price = _request_wants_standard_price(request, llm_intent)
    wants_compare = any(word in request for word in ["비교", "단가", "최저", "견적", "업체", "회사"])
    if not wants_compare:
        return None

    reference_rows: List[Dict[str, Any]] = []
    vendor_sources: List[Dict[str, Any]] = []
    for idx, file in enumerate(parsed_files, start=1):
        filename = str(file.get("originalName") or file.get("original_name") or "")
        text = str(file.get("extractedText") or file.get("extracted_text") or "")
        rows = [enrich_row_units(dict(row)) for row in (file.get("parsedRows") or file.get("rows") or []) if isinstance(row, dict)]
        if _is_estimate_file(filename, text, rows, user_request=request, llm_intent=llm_intent):
            company = _extract_company_name(filename, text, rows, idx)
            vendor_rows: List[Dict[str, Any]] = []
            for row in rows:
                if not str(row.get("item_name") or "").strip():
                    continue
                if not _get_vendor_price_text(row):
                    continue
                next_row = dict(row)
                next_row["vendor_name"] = company
                next_row["source_file_name"] = filename
                vendor_rows.append(enrich_row_units(_normalize_price_role_fallback(next_row)))
            if vendor_rows:
                vendor_sources.append({"name": company, "filename": filename, "rows": vendor_rows})
            continue
        if _is_standard_market_file(filename, text, rows, user_request=request, llm_intent=llm_intent):
            text_rows = extract_standard_market_rows_from_text(text)
            if rows:
                rows = [row for row in rows if str(row.get("item_name") or "").strip() and str(row.get("unit_price") or row.get("standard_unit_price") or "").strip()]
                reference_rows.extend(merge_standard_market_rows(rows, text_rows))
            else:
                reference_rows.extend(text_rows)
            continue

    vendor_sources = _dedupe_vendor_sources(vendor_sources)

    if len(vendor_sources) < 2:
        return None

    all_vendor_rows = [row for source in vendor_sources for row in source["rows"]]
    llm_terms = []
    if isinstance(llm_intent, dict):
        raw_terms = llm_intent.get("targetKeywords") or llm_intent.get("target_keywords") or []
        if isinstance(raw_terms, list):
            llm_terms = [str(term) for term in raw_terms if str(term or "").strip()]
    focus_terms = _extract_focus_terms(request, all_vendor_rows, reference_rows, llm_terms=llm_terms)
    request_quantity, request_quantity_unit = _extract_requested_quantity(request, llm_intent)

    all_columns_for_meta: List[Dict[str, Any]] = []
    all_rows_for_meta: List[Dict[str, Any]] = []
    if include_all_rows and focus_terms:
        full_table = build_multi_vendor_price_comparison(
            parsed_files,
            user_request="업체별 단가 비교표",
            llm_intent=None,
            include_all_rows=False,
        )
        if full_table:
            all_columns_for_meta = list(full_table.get("columns") or [])
            all_rows_for_meta = list(full_table.get("rows") or [])
    if focus_terms:
        for source in vendor_sources:
            source["rows"] = _filter_rows_by_focus(source["rows"], focus_terms)
        vendor_sources = [source for source in vendor_sources if source.get("rows")]
        reference_rows = _filter_rows_by_focus(reference_rows, focus_terms)
        if len(vendor_sources) < 2:
            return {
                "tableName": "업체별 단가 비교표",
                "tableType": MULTI_VENDOR_COMPARE_TABLE_TYPE,
                "columns": [
                    {"key": "item_name", "label": "공종명칭"},
                    {"key": "remark", "label": "비고"},
                ],
                "rows": [{
                    "item_name": ", ".join(focus_terms),
                    "remark": "요청한 공종이 2개 이상 업체 견적서에서 동시에 확인되지 않아 비교표를 만들 수 없습니다.",
                }],
                "meta": {
                    "vendorCount": len(vendor_sources),
                    "vendors": [{"name": item["name"], "filename": item["filename"]} for item in vendor_sources],
                    "referenceRows": len(reference_rows),
                    "focusTerms": focus_terms,
                    "standardPriceShown": include_standard_price,
                    "standardPriceHidden": not include_standard_price,
                    "allColumns": all_columns_for_meta,
                    "allRows": all_rows_for_meta,
                },
            }

    groups: Dict[str, Dict[str, Any]] = {}
    for source in vendor_sources:
        for row in source["rows"]:
            key = _row_match_key(row)
            if key in {"text:||", "text:|"}:
                continue
            group = groups.setdefault(key, {"sample": row, "vendors": {}, "sourceFiles": set()})
            group["vendors"][source["name"]] = row
            group["sourceFiles"].add(source["filename"])
    if not groups:
        return None

    columns: List[Dict[str, str]] = [
        {"key": "construction_code", "label": "공종코드"},
        {"key": "item_name", "label": "공종명칭"},
        {"key": "spec", "label": "규격"},
        {"key": "quantity", "label": "요청 수량"},
        {"key": "unit", "label": "단위"},
    ]
    if include_standard_price:
        columns.append({"key": "standard_unit_price", "label": "표준시장단가"})
    vendor_key_map: Dict[str, str] = {}
    for idx, source in enumerate(vendor_sources, start=1):
        key = _safe_compare_key(source["name"], idx, "unit_price")
        vendor_key_map[source["name"]] = key
        columns.append({"key": key, "label": f"{source['name']} 단가"})
    columns.extend([
        {"key": "lowest_vendor", "label": "최저 업체"},
        {"key": "lowest_unit_price", "label": "최저 단가"},
    ])
    if include_standard_price:
        columns.append({"key": "lowest_vs_standard", "label": "최저-표준 차이"})
    columns.extend([
        {"key": "labor_ratio", "label": "노무비율"},
        {"key": "remark", "label": "비고"},
    ])

    result_rows: List[Dict[str, Any]] = []
    for _, group in sorted(groups.items(), key=lambda kv: (str(kv[1]["sample"].get("item_name") or ""), str(kv[1]["sample"].get("spec") or ""))):
        sample = group["sample"]
        ref = _find_reference_row(sample, reference_rows)
        standard_price = to_number(sample.get("standard_unit_price") or "") or (to_number(ref.get("unit_price")) if ref else 0.0)
        unit = clean_cell_text(sample.get("unit_normalized") or sample.get("unit") or (ref or {}).get("unit") or "")
        out: Dict[str, Any] = {
            "construction_code": clean_cell_text(sample.get("construction_code") or (ref or {}).get("construction_code") or ""),
            "item_name": clean_cell_text(sample.get("item_name") or (ref or {}).get("item_name") or ""),
            "spec": clean_cell_text(sample.get("spec") or (ref or {}).get("spec") or ""),
            "quantity": request_quantity or clean_number(sample.get("quantity") or ""),
            "request_quantity": request_quantity or clean_number(sample.get("quantity") or ""),
            "unit": unit,
            "labor_ratio": clean_cell_text((ref or {}).get("labor_ratio") or sample.get("labor_ratio") or ""),
            "remark": "",
        }
        if include_standard_price:
            out["standard_unit_price"] = clean_number(sample.get("standard_unit_price") or (ref or {}).get("unit_price") or "")
        vendor_prices: List[Tuple[float, str]] = []
        units = {unit} if unit else set()
        for source in vendor_sources:
            vendor = source["name"]
            vrow = group["vendors"].get(vendor)
            col_key = vendor_key_map[vendor]
            if not vrow:
                out[col_key] = ""
                continue
            price_text = _get_vendor_price_text(vrow)
            out[col_key] = price_text
            price = to_number(price_text)
            if price:
                vendor_prices.append((price, vendor))
            vunit = clean_cell_text(vrow.get("unit_normalized") or vrow.get("unit") or "")
            if vunit:
                units.add(vunit)
        if vendor_prices:
            lowest_price, lowest_vendor = min(vendor_prices, key=lambda item: item[0])
            out["lowest_vendor"] = lowest_vendor
            out["lowest_unit_price"] = f"{lowest_price:,.0f}"
            if include_standard_price:
                out["lowest_vs_standard"] = _format_price_diff(lowest_price, standard_price)
        else:
            out["lowest_vendor"] = ""
            out["lowest_unit_price"] = ""
            if include_standard_price:
                out["lowest_vs_standard"] = ""
        remarks = []
        if request_quantity and request_quantity_unit and unit and compact_text(request_quantity_unit) not in compact_text(unit) and compact_text(unit) not in compact_text(request_quantity_unit):
            remarks.append(f"요청 수량 단위 확인 필요: {request_quantity}{request_quantity_unit} / 원문 단위 {unit}")
        if len([u for u in units if u]) >= 2:
            remarks.append(f"단위 확인 필요: {', '.join(sorted(units))}")
        if reference_rows and not ref:
            remarks.append("기준자료 행 미매칭")
        out["remark"] = " / ".join(remarks)
        result_rows.append(out)
        if len(result_rows) >= _env_int("MULTI_COMPARE_MAX_ROWS", 300):
            break

    if not result_rows:
        return None
    columns = prune_empty_columns(columns, result_rows)
    if not all_rows_for_meta:
        all_rows_for_meta = result_rows
    if not all_columns_for_meta:
        all_columns_for_meta = columns
    meta_vendors = []
    for vendor_index, item in enumerate(vendor_sources, start=1):
        name = item["name"]
        meta_vendors.append({
            "name": name,
            "filename": item.get("filename"),
            "index": vendor_index - 1,
            "unitPriceKey": vendor_key_map.get(name),
            "priceKey": vendor_key_map.get(name),
        })

    return {
        "tableName": "업체별 단가 비교표",
        "tableType": MULTI_VENDOR_COMPARE_TABLE_TYPE,
        "columns": columns,
        "rows": result_rows,
        "meta": {
            "vendorCount": len(vendor_sources),
            "vendors": meta_vendors,
            "referenceRows": len(reference_rows),
            "focusTerms": focus_terms,
            "standardPriceShown": include_standard_price,
            "standardPriceHidden": not include_standard_price,
            "allColumns": all_columns_for_meta,
            "allRows": all_rows_for_meta,
        },
    }
