from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from app.services.unit_normalizer import clean_cell_text, enrich_row_units
from app.services.document_analyzer.table_utils import (
    compact_text,
    clean_number,
    to_number,
    _env_int,
    _valid_focus_term,
    REFERENCE_TABLE_KEYWORDS,
    TEXT_VENDOR_COMPARISON_COLUMNS,
    TEXT_VENDOR_COMPARISON_TABLE_TYPE,
    MULTI_VENDOR_COMPARE_TABLE_TYPE,
)
from app.services.document_analyzer.vendor_comparator import (
    _safe_compare_key,
    _request_vendor_terms_from_message,
    _requested_vendor_count,
    _text_report_vendor_match_terms,
    _extract_requested_quantity,
)


# ---------------------------------------------------------------------------
# Text page splitting / line cleaning
# ---------------------------------------------------------------------------

def _split_text_pages(text: str) -> List[Dict[str, Any]]:
    """PyMuPDF/pdfplumber가 붙인 [page N / T] 마커 기준으로 페이지를 나눈다."""
    if not text:
        return []
    pattern = re.compile(r"\[page\s+(\d+)\s*/\s*(\d+)(?:\s+OCR)?\]", re.I)
    matches = list(pattern.finditer(text))
    if not matches:
        return [{"page": None, "text": text}]
    pages: List[Dict[str, Any]] = []
    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        pages.append({"page": int(match.group(1)), "pageCount": int(match.group(2)), "text": text[start:end]})
    return pages


def _clean_line(value: Any, limit: int = 220) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip(" -·•\t")
    return clean[:limit]


# ---------------------------------------------------------------------------
# Standard market text parsing
# ---------------------------------------------------------------------------

def _coalesce_standard_market_lines(page_text: str) -> List[str]:
    lines = [_clean_line(line, 260) for line in str(page_text or '').splitlines()]
    lines = [line for line in lines if line]
    merged: List[str] = []
    code_re = re.compile(r"^[A-Z]{1,3}\d{3}\.\d{5}\b")
    tail_re = re.compile(r"\s(?:\d|공?m\s*[23]|[㎡㎥]|개|본|식|시간|hr|ton|kg|개소)\s+[0-9]{1,3}(?:,[0-9]{3})+\s+\d{1,3}(?:\.\d+)?%\s*$", re.I)

    idx = 0
    while idx < len(lines):
        line = lines[idx]
        if not code_re.match(line):
            idx += 1
            continue
        buf = [line]
        j = idx + 1
        while j < len(lines) and len(buf) < 7:
            candidate = " ".join(buf)
            if tail_re.search(candidate):
                break
            nxt = lines[j]
            if code_re.match(nxt) or nxt.startswith("【") or nxt.startswith("■") or "공종코드" in nxt:
                break
            buf.append(nxt)
            j += 1
        merged.append(" ".join(buf))
        idx = max(j, idx + 1)
    return merged


def _split_standard_market_body(body: str) -> Tuple[str, str, str, str, str]:
    tail = re.search(
        r"(?P<unit>공\s*m\s*[23]|공㎥|m\s*[23]|㎡|㎥|개소|개|본|식|시간|hr|ton|kg|m|대|조|매|장)\s+"
        r"(?P<price>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,})\s+"
        r"(?P<labor>\d{1,3}(?:\.\d+)?%)\s*$",
        body,
        re.I,
    )
    if not tail:
        return "", "", "", "", ""

    prefix = body[:tail.start()].strip()
    unit = tail.group("unit")
    price = tail.group("price")
    labor = tail.group("labor")

    spec_marker = re.search(r"(?=\b(?:H|B|L|D)\s*=|[ℓøØφΦ∅]|\bType\b|\bTYPE\b|\d|[-–])", prefix)
    if spec_marker and spec_marker.start() > 0:
        item_name = prefix[:spec_marker.start()].strip()
        spec = prefix[spec_marker.start():].strip()
    else:
        parts = prefix.rsplit(" ", 1)
        item_name = parts[0].strip() if len(parts) > 1 else prefix.strip()
        spec = parts[1].strip() if len(parts) > 1 else "-"

    item_name = re.sub(r"\s+", " ", item_name).strip()
    spec = re.sub(r"\s+", " ", spec).strip() or "-"
    return item_name, spec, unit, price, labor


def extract_standard_market_rows_from_text(text: str, max_rows: int | None = None) -> List[Dict[str, Any]]:
    """표준시장단가 문서 전용 텍스트 파서."""
    limit = max_rows if max_rows and max_rows > 0 else _env_int("PDF_TABLE_MAX_ROWS", 500)
    if limit <= 0:
        limit = 10**9

    rows: List[Dict[str, Any]] = []
    seen: set = set()
    row_re = re.compile(r"^(?P<code>[A-Z]{1,3}\d{3}\.\d{5})\s+(?P<body>.+)$")
    for page in _split_text_pages(text):
        page_no = page.get("page")
        for line in _coalesce_standard_market_lines(str(page.get("text") or "")):
            match = row_re.match(line)
            if not match:
                continue
            code = match.group("code").strip()
            body = match.group("body").strip()
            item_name, spec, unit, price, labor = _split_standard_market_body(body)
            if not price or not labor:
                continue
            key = compact_text(f"{code}|{item_name}|{spec}|{unit}|{price}|{labor}")
            if key in seen:
                continue
            seen.add(key)
            row = enrich_row_units({
                "construction_code": code,
                "item_name": clean_cell_text(item_name),
                "spec": clean_cell_text(spec),
                "unit": clean_cell_text(unit),
                "unit_price": clean_number(price),
                "labor_ratio": clean_cell_text(labor),
                "source_page": f"p.{page_no}" if page_no else "",
            })
            rows.append(row)
            if len(rows) >= limit:
                return rows
    return rows


# ---------------------------------------------------------------------------
# Reference guideline
# ---------------------------------------------------------------------------

def _looks_like_section_heading(line: str) -> bool:
    line = _clean_line(line, 120)
    if not line or len(line) > 90:
        return False
    if re.match(r"^(?:제\s*\d+\s*[장절]|\d+(?:\.\d+){0,4}(?:[-ㅡ]\d+)?\.?)\s*[^0-9=]{1,70}$", line):
        return True
    if re.match(r"^[가-힣A-Za-z][가-힣A-Za-z0-9\s/·()\-'\[\]]{1,50}$", line) and any(k in line for k in ["기준", "단가", "방법", "요령", "할증", "품셈"]):
        return True
    return False


def _find_section_heading(lines: List[str], index: int) -> str:
    for back in range(index, max(-1, index - 18), -1):
        if back < 0:
            break
        candidate = _clean_line(lines[back], 120)
        if _looks_like_section_heading(candidate):
            return candidate
    return "본문 기준"


def extract_reference_guideline_rows(text: str, user_request: str = "", max_rows: int | None = None) -> List[Dict[str, Any]]:
    """기준서/지침서 문서를 '기준 항목 표'로 변환한다."""
    from app.services.document_analyzer.doc_profiler import is_reference_or_guideline_document

    if not is_reference_or_guideline_document(text):
        return []
    max_rows = max_rows or max(_env_int("REFERENCE_TABLE_MAX_ROWS", 120), 20)
    request = compact_text(user_request)
    focus_price = any(k in request for k in ["단가", "가격", "견적", "비교", "원가"])
    focus_table = any(k in request for k in ["표", "테이블", "정리", "엑셀", "양식"])
    keywords = ["단가", "가격", "계약단가", "거래실례가격", "노임단가", "정부노임단가", "기본요금"] if focus_price else REFERENCE_TABLE_KEYWORDS
    if not focus_table and not focus_price:
        keywords = ["적용기준", "산정기준", "계산", "단가", "가격", "요율"]

    rows: List[Dict[str, Any]] = []
    seen: set = set()
    for page in _split_text_pages(text):
        page_no = page.get("page")
        raw_lines = [line for line in str(page.get("text") or "").splitlines()]
        lines = [_clean_line(line) for line in raw_lines]
        for idx, line in enumerate(lines):
            if not line or len(line) < 5:
                continue
            if not any(keyword in line for keyword in keywords):
                continue

            section = _find_section_heading(lines, idx)
            context_parts = [line]
            for next_idx in range(idx + 1, min(len(lines), idx + 3)):
                nxt = lines[next_idx]
                if not nxt or _looks_like_section_heading(nxt):
                    break
                if len(" ".join(context_parts)) < 180:
                    context_parts.append(nxt)
            basis = _clean_line(" ".join(context_parts), 260)
            calculation = ""
            if re.search(r"[=*×xX]|곱|나누|계산|산출|적용|가산|공제|요율|%", basis):
                calculation = basis
            unit_basis = basis if any(k in basis for k in ["단가", "가격", "요금", "노임", "거래실례"]) else ""
            row_key = compact_text(f"{page_no}|{section}|{basis[:120]}")
            if row_key in seen:
                continue
            seen.add(row_key)
            rows.append({
                "section": section,
                "basis_item": section if section != "본문 기준" else basis[:40],
                "application_basis": basis,
                "calculation_method": calculation,
                "unit_price_basis": unit_basis,
                "source_page": f"p.{page_no}" if page_no else "",
                "remark": "기준서 원문 키워드 기반 추출",
            })
            if len(rows) >= max_rows:
                return rows

    if not rows:
        for page in _split_text_pages(text):
            page_no = page.get("page")
            for line in [_clean_line(v) for v in str(page.get("text") or "").splitlines()]:
                if _looks_like_section_heading(line) and any(k in line for k in ["기준", "단가", "계산", "산출", "품셈"]):
                    row_key = compact_text(f"{page_no}|{line}")
                    if row_key in seen:
                        continue
                    seen.add(row_key)
                    rows.append({
                        "section": line,
                        "basis_item": line,
                        "application_basis": line,
                        "calculation_method": "",
                        "unit_price_basis": line if any(k in line for k in ["단가", "가격", "요금"]) else "",
                        "source_page": f"p.{page_no}" if page_no else "",
                        "remark": "기준서 장절 제목 기반 추출",
                    })
                    if len(rows) >= max_rows:
                        return rows
    return rows


# ---------------------------------------------------------------------------
# Text-only vendor comparison report
# ---------------------------------------------------------------------------

def extract_text_vendor_total_rows(text: str) -> List[Dict[str, Any]]:
    """서술형 업체별 비교보고서의 총괄 비교 문장에서 업체 총액 행만 보수적으로 추출한다."""
    text = _normalize_report_text(text)
    rows: List[Dict[str, Any]] = []
    seen = set()
    section_match = re.search(r"3\.\s*총괄\s*비교\s*결과(?P<section>.*?)(?:\n\s*4\.|4\.\s*세부)", text, re.S)
    source_text = section_match.group("section") if section_match else text[:12000]
    patterns = [
        re.compile(
            r"(?P<vendor>(?:[A-Z]회사\s*)?(?:㈜|\(주\)|주식회사)?[가-힣A-Za-z0-9·ㆍ]+(?:전기|설비|시스템|일렉|기술)?(?:㈜)?)"
            r"(?:의)?\s*(?:총\s*)?견적금액은\s*(?P<amount>[0-9]{1,3}(?:,[0-9]{3})+)원"
            r"(?P<context>.{0,180}?)(?:비교하면|대비)\s*(?P<diff>[+\-]?[0-9]{1,3}(?:,[0-9]{3})+)원\s*,\s*(?P<rate>[+\-]?[0-9]+(?:\.\d+)?)%",
            re.S,
        ),
        re.compile(
            r"(?P<vendor>(?:[A-Z]회사\s*)?(?:㈜|\(주\)|주식회사)?[가-힣A-Za-z0-9·ㆍ]+(?:전기|설비|시스템|일렉|기술)?(?:㈜)?)"
            r"(?:가|이|은|는)?\s*(?P<amount>[0-9]{1,3}(?:,[0-9]{3})+)원으로(?P<context>.{0,180}?)(?:대비|비교하여|비교하면)\s*(?P<diff>[+\-]?[0-9]{1,3}(?:,[0-9]{3})+)원\s*,\s*(?P<rate>[+\-]?[0-9]+(?:\.\d+)?)%",
            re.S,
        ),
    ]
    for pattern in patterns:
        for m in pattern.finditer(source_text):
            vendor = clean_cell_text(m.group("vendor"))
            vendor = re.sub(r"^[A-Z]회사\s*", "", vendor).strip()
            vendor = re.sub(r"(의|가|이|은|는)$", "", vendor).strip()
            amount = clean_number(m.group("amount"))
            diff = clean_number(m.group("diff"))
            rate = f"{m.group('rate')}%"
            key = compact_text(f"{vendor}{amount}{diff}{rate}")
            if not vendor or key in seen:
                continue
            seen.add(key)
            context = _clean_line(m.group("context"), limit=120)
            remark = "가격 측면 우선 검토 대상" if "가장 낮" in context or "우선 검토" in context else "공종별 편차 및 조건 재확인 필요"
            rows.append({
                "vendor_name": vendor,
                "total_amount": amount,
                "price_diff": diff,
                "diff_rate": rate,
                "remark": remark,
            })
    return rows[:20]


def _extract_requested_quantity_value(user_request: str) -> Tuple[str, str]:
    """사용자 요청의 작업 수량을 추출한다."""
    text = str(user_request or "")
    patterns = [
        r"(?:각\s*)?(?:수량|량)\s*(?:은|는|:)?\s*(?P<qty>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>개|대|식|m|M|EA|ea|본|장|조)?",
        r"(?P<qty>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>개|대|식|m|M|EA|ea|본|장|조)\s*(?:씩|로)?(?!\s*(?:업체|회사|거래처|개사))",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return clean_number(m.group('qty')), (m.groupdict().get('unit') or '').strip()
    return "", ""


def _extract_requested_item_terms(user_request: str) -> List[str]:
    """사용자 요청에서 공종/품목명으로 보이는 토큰을 추출한다."""
    text = str(user_request or "")
    if not text.strip():
        return []
    terms: List[str] = []
    for m in re.finditer(r"[가-힣A-Za-z0-9·ㆍ()]+(?:\s+[가-힣A-Za-z0-9·ㆍ()]+)*?\s*(?:설치|포설|배선|조립|제작|철거|교체|시공)", text):
        term = compact_text(m.group(0))
        if len(term) >= 3:
            terms.append(term)
    cleaned = re.sub(r"(비교|단가|금액|수량|각|업체|회사|견적|표|정리|만들어|해줘|해줄래|그리고|랑|와|과|별로|기준|개|대|식|로|으로)", " ", text)
    cleaned = re.sub(r"[0-9]+(?:\.[0-9]+)?", " ", cleaned)
    for piece in re.split(r"[\s,，/]+", cleaned):
        token = compact_text(piece)
        if len(token) >= 4 and not any(stop in token for stop in ["대한전기", "파워시스템", "한국전기", "스마트일렉", "전기기술"]):
            terms.append(token)
    return list(dict.fromkeys(terms))


def _extract_text_report_vendor_master(text: str) -> List[Dict[str, Any]]:
    """서술형 비교보고서의 업체 기본사항에서 A/B/C/D/E 업체명을 추출한다."""
    text = _normalize_report_text(text)
    vendors: List[Dict[str, Any]] = []
    seen = set()
    section_match = re.search(r"2\.\s*업체\s*기본사항(?P<section>.*?)(?:\n\s*3\.|3\.\s*총괄)", text, re.S)
    source = section_match.group('section') if section_match else text[:8000]
    pattern = re.compile(r"(?P<alias>[A-Z])회사\s+(?P<name>(?:㈜|\(주\)|주식회사)?[가-힣A-Za-z0-9·ㆍ]+(?:㈜)?)")
    for m in pattern.finditer(source):
        alias = f"{m.group('alias').upper()}회사"
        name = clean_cell_text(m.group('name'))
        name = re.sub(r"(의|가|이|은|는)$", "", name).strip()
        key = compact_text(name)
        if not name or key in seen:
            continue
        seen.add(key)
        vendors.append({"alias": alias, "name": name, "compareKey": key})
    return vendors


def _select_text_report_vendors(text: str, user_request: str) -> List[Dict[str, Any]]:
    all_vendors = _extract_text_report_vendor_master(text)
    if not all_vendors:
        return []
    request_terms = _request_vendor_terms_from_message(user_request)
    compact_request = compact_text(user_request)
    selected: List[Dict[str, Any]] = []

    for vendor in all_vendors:
        vendor_terms = _text_report_vendor_match_terms(vendor)
        if compact_request and any(term and term in compact_request for term in vendor_terms):
            selected.append(vendor)
            continue
        for req in request_terms:
            if any(req and term and (req in term or term in req) for term in vendor_terms):
                selected.append(vendor)
                break

    if selected:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for vendor in selected:
            ident = compact_text(vendor.get('name') or vendor.get('alias'))
            if ident in seen:
                continue
            seen.add(ident)
            deduped.append(vendor)
        return deduped

    requested_count = _requested_vendor_count(user_request)
    has_vendor_like_text = bool(request_terms)
    if requested_count and not has_vendor_like_text:
        return all_vendors[:requested_count]
    return all_vendors


def _split_item_name_and_spec(item_text: str) -> Tuple[str, str]:
    item = clean_cell_text(item_text)
    m = re.match(r"(?P<name>.*?)(?:\s+(?P<spec>[0-9][0-9A-Za-z.,/×xX㎡㎥㎜㎝㎏kKmMvVaA\- ]+))$", item)
    if m and m.group('name').strip():
        return clean_cell_text(m.group('name')), clean_cell_text(m.group('spec'))
    return item, ""


def _normalize_report_text(text: str) -> str:
    """[page N/T] 마커와 반복 문서 헤더를 제거해 정규식 매칭을 안정화한다."""
    # [page N / T] 마커와 바로 뒤 문서 제목 행을 제거
    cleaned = re.sub(r'\[page\s+\d+\s*/\s*\d+\]\s*(?:\n[^\n]{0,150})?', ' ', text, flags=re.I)
    # 다양한 형태의 반복 보고서 헤더 제거 (공백/밑줄/연도 변형 포함)
    cleaned = re.sub(
        r'전기공사[\s_]*업체별[\s_]*단가[\s_]*비교[\s_]*(?:검토보고서|검토\s*보고서)[가-힣A-Za-z0-9\-_ ]{0,50}',
        '',
        cleaned,
        flags=re.I,
    )
    # 연속 공백 정리
    cleaned = re.sub(r'[ \t]{3,}', ' ', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned


def extract_text_vendor_item_rows(text: str, user_request: str = "") -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """표가 없는 비교보고서에서 공종별 최저/최고 견적 문장을 행으로 추출한다."""
    text = _normalize_report_text(text)
    selected_vendors = _select_text_report_vendors(text, user_request)
    requested_terms = _extract_requested_item_terms(user_request)
    request_qty, request_unit = _extract_requested_quantity_value(user_request)
    # 요청 품목 용어 컴팩트 변환 (빈 문자열 제거)
    compact_terms = [ct for ct in (compact_text(t) for t in requested_terms) if ct]
    seen = set()
    page_break = r"(?:\s*)?"
    vendor_pat = r"(?:[A-Z]회사\s*)?(?:㈜|\(주\)|주식회사)?[가-힣A-Za-z0-9·ㆍ]+(?:㈜)?"
    pattern = re.compile(
        r"공종코드\s*(?P<code>[A-Z]{2}[0-9]{3}\.[0-9]{5})\s*항목은\s*"
        r"(?P<item>[^에]{1,80}?)에\s*관한\s*단가\s*검토\s*건이다\.\s*"
        r"적용\s*단위는\s*(?P<unit>[^\s\.]+)이고\s*표준시장단가는\s*(?P<std>[0-9]{1,3}(?:,[0-9]{3})+)원이다\.\s*"
        r"이번\s*비교에서\s*최저\s*견적은\s*(?P<low_vendor>" + vendor_pat + r")의" + page_break + r"\s*(?P<low_price>[0-9]{1,3}(?:,[0-9]{3})+)원이며,\s*"
        r"최고\s*견적은\s*(?P<high_vendor>" + vendor_pat + r")의" + page_break + r"\s*(?P<high_price>[0-9]{1,3}(?:,[0-9]{3})+)원이다\."
        r"(?P<context>.{0,500}?)"
        r"(?=공종코드\s*[A-Z]{2}[0-9]{3}\.|[가-힣A-Za-z0-9·ㆍ()]+\s*\([A-Z]{2}[0-9]{2}\*\)에 대한 검토 의견|$)",
        re.S,
    )

    def _build_row(m: re.Match) -> Dict[str, Any] | None:
        full_item = clean_cell_text(m.group('item'))
        item_name, spec = _split_item_name_and_spec(full_item)
        low_vendor = re.sub(r"^[A-Z]회사\s*", "", clean_cell_text(m.group('low_vendor'))).strip()
        high_vendor = re.sub(r"^[A-Z]회사\s*", "", clean_cell_text(m.group('high_vendor'))).strip()
        low_vendor = re.sub(r"(의|가|이|은|는)$", "", low_vendor).strip()
        high_vendor = re.sub(r"(의|가|이|은|는)$", "", high_vendor).strip()
        low_price = clean_number(m.group('low_price'))
        high_price = clean_number(m.group('high_price'))
        direct_vendor_map = {compact_text(low_vendor): low_price, compact_text(high_vendor): high_price}
        vendors_for_row = selected_vendors or [
            {"name": low_vendor, "compareKey": compact_text(low_vendor)},
            {"name": high_vendor, "compareKey": compact_text(high_vendor)},
        ]
        vendor_prices: Dict[str, Any] = {}
        vendor_amounts: Dict[str, Any] = {}
        for vendor in vendors_for_row:
            name = clean_cell_text(vendor.get('name'))
            c_name = compact_text(name)
            matched_price = next(
                (price for direct_name, price in direct_vendor_map.items() if c_name and direct_name and (c_name in direct_name or direct_name in c_name)),
                "",
            )
            vendor_prices[name] = matched_price if matched_price else "원문 미기재"
            if request_qty and matched_price:
                vendor_amounts[name] = int(float(request_qty) * to_number(matched_price))
            elif request_qty:
                vendor_amounts[name] = "원문 미기재"
        code = clean_cell_text(m.group('code'))
        key = compact_text(f"{code}{full_item}{low_vendor}{high_vendor}")
        if key in seen:
            return None
        seen.add(key)
        remark_parts = []
        if request_unit and clean_cell_text(m.group('unit')) and compact_text(request_unit) != compact_text(m.group('unit')):
            remark_parts.append(f"단위 확인: 원문 {clean_cell_text(m.group('unit'))} / 요청 {request_unit}")
        return enrich_row_units({
            "construction_code": code,
            "item_name": item_name,
            "spec": spec,
            "quantity": request_qty or "",
            "unit": clean_cell_text(m.group('unit')),
            "standard_unit_price": clean_number(m.group('std')),
            "lowest_vendor": low_vendor,
            "highest_vendor": high_vendor,
            "vendor_prices": vendor_prices,
            "vendor_amounts": vendor_amounts,
            "remark": " / ".join(remark_parts),
        })

    filtered_rows: List[Dict[str, Any]] = []
    all_rows: List[Dict[str, Any]] = []
    for m in pattern.finditer(text):
        row = _build_row(m)
        if row is None:
            continue
        all_rows.append(row)
        if compact_terms:
            ci = compact_text(row.get("item_name", "") + row.get("spec", ""))
            if any(ct in ci or ci in ct for ct in compact_terms):
                filtered_rows.append(row)

    # compact_terms가 있지만 실제 매칭이 없으면 전체 행 반환 (업체명·동사 등이 잘못 추출된 경우 방어)
    rows = filtered_rows if filtered_rows else all_rows
    return rows[:80], selected_vendors


def build_text_vendor_comparison_item_table(text: str, user_request: str = "") -> Dict[str, Any] | None:
    from app.services.document_analyzer.doc_profiler import is_text_only_vendor_comparison_report

    if not is_text_only_vendor_comparison_report(text):
        return None
    rows, selected_vendors = extract_text_vendor_item_rows(text, user_request=user_request)
    if not rows:
        return None

    vendor_names: List[str] = []
    for vendor in selected_vendors or []:
        name = clean_cell_text(vendor.get('name'))
        if name and name not in vendor_names:
            vendor_names.append(name)
    if not vendor_names:
        for row in rows:
            for name in (row.get('vendor_prices') or {}).keys():
                clean_name = clean_cell_text(name)
                if clean_name and clean_name not in vendor_names:
                    vendor_names.append(clean_name)

    vendors_meta = []
    vendor_columns: List[Dict[str, Any]] = []
    for idx, name in enumerate(vendor_names):
        unit_price_key = _safe_compare_key(name, idx + 1, "unit_price")
        amount_key = _safe_compare_key(name, idx + 1, "amount")
        vendors_meta.append({
            "index": idx,
            "name": name,
            "vendorName": name,
            "label": name,
            "unitPriceKey": unit_price_key,
            "amountKey": amount_key,
        })
        vendor_columns.extend([
            {"key": unit_price_key, "label": f"{name} 단가"},
            {"key": amount_key, "label": f"{name} 금액"},
        ])

    flattened_rows: List[Dict[str, Any]] = []
    for row in rows:
        out = dict(row)
        vendor_prices = row.get('vendor_prices') or {}
        vendor_amounts = row.get('vendor_amounts') or {}
        for meta in vendors_meta:
            name = meta["name"]
            out[meta["unitPriceKey"]] = vendor_prices.get(name, "")
            out[meta["amountKey"]] = vendor_amounts.get(name, "")
        flattened_rows.append(out)

    return {
        "tableName": "서술형 업체별 단가 비교표",
        "tableType": MULTI_VENDOR_COMPARE_TABLE_TYPE,
        "columns": [
            {"key": "construction_code", "label": "공종코드"},
            {"key": "item_name", "label": "품목명"},
            {"key": "spec", "label": "규격"},
            {"key": "quantity", "label": "수량"},
            {"key": "unit", "label": "단위"},
            {"key": "standard_unit_price", "label": "표준단가"},
            *vendor_columns,
            {"key": "lowest_vendor", "label": "원문 최저업체"},
            {"key": "highest_vendor", "label": "원문 최고업체"},
            {"key": "remark", "label": "비고"},
        ],
        "rows": flattened_rows,
        "meta": {
            "sourceMode": "text_only_vendor_comparison_item_rows",
            "vendors": vendors_meta,
            "templateLayoutMode": "COMPACT_VENDOR_GROUPS",
            "notice": "표가 없는 보고서에서 공종별 최저/최고 견적 문장을 추출했습니다. 요청 업체 단가가 원문에 직접 없으면 원문 미기재로 표시합니다.",
            "requestedText": user_request or "",
        },
    }


def build_text_vendor_comparison_summary_table(text: str, user_request: str = "") -> Dict[str, Any] | None:
    from app.services.document_analyzer.doc_profiler import is_text_only_vendor_comparison_report

    if not is_text_only_vendor_comparison_report(text):
        return None
    rows = extract_text_vendor_total_rows(text)
    return {
        "tableName": "서술형 업체별 단가 비교 요약",
        "tableType": TEXT_VENDOR_COMPARISON_TABLE_TYPE,
        "columns": TEXT_VENDOR_COMPARISON_COLUMNS,
        "rows": rows,
        "meta": {
            "sourceMode": "text_only_vendor_comparison_report",
            "notice": "표가 없는 보고서에서 총괄 업체별 금액만 추출했습니다. 개별 공종 단가는 원문에 명시된 범위에서만 확인해야 합니다.",
            "requestedText": user_request or "",
        },
    }
