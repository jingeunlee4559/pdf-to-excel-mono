from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .utils import as_list, get_row_value, to_number


_CORP_WORDS_RE = re.compile(r"주식회사|\(주\)|㈜|（주）|유한회사|합자회사|합명회사", re.I)


def comparable_company(value: Any) -> str:
    text = str(value or "")
    text = _CORP_WORDS_RE.sub("", text)
    return re.sub(r"[\s._\-()（）\[\]{}·ㆍ,/:]+", "", text).lower()


def normalize_vendor_label(label: Any) -> str:
    text = str(label or "").strip()
    text = re.sub(r"^(각각|각|기준으로|대상으로|업체명|회사명)\s*", "", text)
    text = re.sub(r"\s*(이|가)?\s*\d+\s*개\s*(업체|회사|개사).*?$", "", text)
    text = re.sub(r"\s*(단가|금액|견적가|견적단가|가격)$", "", text)
    text = text.strip(" ,·ㆍ/\t\r\n")
    return text.strip()


def is_bad_vendor_label(label: Any) -> bool:
    display = str(label or "").strip()
    compact = comparable_company(display)
    if not display or not compact:
        return True

    # 표 제목/헤더/요약 문구가 업체명으로 유입되는 경우 차단.
    # 예: "5개 업체 단가 비교 (대분류 EA)", "최저 업체", "전기공사_업체별단가...pdf"
    bad_patterns = [
        r"\d+\s*개\s*(업체|회사|개사)",
        r"업체\s*별", r"업체\s*단가", r"단가\s*비교", r"가격\s*비교", r"비교\s*견적", r"비교표", r"비교\s*자료",
        r"대분류|중분류|소분류|표준시장단가|표준\s*단가",
        r"최저|최고|차액|증감률|비고|작성자|작성일|견적일|견적일자|문서|파일|첨부",
        r"규격|수량|단위|단가|금액|품명|품목|공종|항목|NO\b|No\b",
        # 채팅 문장에서 품목명이 업체명으로 오인되는 케이스 차단
        r"설치|철거|해체|시공|공사|차단기|배전반|변압기|VCB|MDB",
    ]
    if any(re.search(p, display, re.I) for p in bad_patterns):
        return True
    if re.match(r"^(기준|표준|일반|최저|최고|차이|수량|단가|금액|품명|규격|품목|항목|단위|NO|No)$", display, re.I):
        return True
    # 너무 긴 문장은 업체명보다 설명/제목일 가능성이 큼.
    if len(display) > 30 and not re.search(r"(전기|설비|건설|시스템|일렉|기술|엔지|산업)", display):
        return True
    return False


def _dedupe_names(names: List[Any]) -> List[str]:
    result: List[str] = []
    seen = set()
    for name in names or []:
        if isinstance(name, dict):
            raw = name.get("name") or name.get("vendorName") or name.get("vendor_name") or name.get("label") or name.get("companyName") or name.get("company_name") or ""
        else:
            raw = name
        clean = normalize_vendor_label(raw)
        key = comparable_company(clean)
        if not key or is_bad_vendor_label(clean) or key in seen:
            continue
        result.append(clean)
        seen.add(key)
    return result


def _extract_request_vendor_names(text: Any) -> List[str]:
    """채팅 요청에서 업체명 목록을 추출한다.

    주 목적은 다운로드 엑셀 생성 시 컬럼 라벨("5개 업체 단가 비교")이 업체명으로
    오인되는 문제를 막고, 사용자가 실제 요청한 업체 순서를 보존하는 것이다.
    """
    source = str(text or "").strip()
    if not source:
        return []
    # 사용자가 업체 목록을 줄바꿈과 쉼표로 섞어 입력하는 경우
    # 예: "에이건설\n,비테크건설". 기존 [^\n] 정규식은 첫 업체를 누락시킬 수 있다.
    source = re.sub(r"\s*,\s*", ",", source)
    source = re.sub(r"[\r\n]+", " ", source)
    source = re.sub(r"\s+", " ", source).strip()

    candidates: List[str] = []

    # "한국전기, 대한전기설비, 전기기술, 스마트일렉 4개 업체" 형태
    for match in re.finditer(
        r"(?:각각|각)?\s*([^\n]{2,180}?)(?:이|가)?\s*\d+\s*개\s*(?:업체|회사|개사)",
        source,
        re.I,
    ):
        segment = match.group(1)
        # 문장 앞부분에 목적어가 붙는 경우 마지막 문장/절만 사용
        segment = re.split(r"(?:기준으로|대상으로|비교해서|비교하여|표로|보여줘|만들어줘)", segment)[-1]
        pieces = re.split(r"\s*,\s*|，|、|\s+및\s+|\s+그리고\s+|\s+와\s+|\s+과\s+", segment)
        candidates.extend(pieces)

    # "업체는 A, B, C" 형태 보완.
    # 단순 "업체"만 매칭하면 "4개업체를 진공차단기..."에서 품목명이 업체로 들어가므로
    # 은/는/명은/: 가 붙은 명시적 목록 표현만 허용한다.
    for match in re.finditer(r"(?:업체|회사|거래처|회사명)\s*(?:은|는|명은|명|[:：])\s*([^\n.。]{2,180})", source, re.I):
        segment = match.group(1)
        segment = re.split(r"(?:품목|공종|수량|단가|비교|표로|만들|기준|대상)", segment)[0]
        pieces = re.split(r"\s*,\s*|，|、|\s+및\s+|\s+그리고\s+|\s+와\s+|\s+과\s+", segment)
        candidates.extend(pieces)

    return _dedupe_names(candidates)


def _meta_vendor_objects(table_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    meta = (table_json or {}).get("meta") or {}
    sources = [
        meta.get("selectedVendors"),
        meta.get("selected_vendors"),
        meta.get("visibleVendors"),
        meta.get("visible_vendors"),
        meta.get("vendors"),
        (table_json or {}).get("vendors"),
    ]
    out: List[Dict[str, Any]] = []
    seen = set()
    for source in sources:
        for idx, vendor in enumerate(as_list(source)):
            if isinstance(vendor, dict):
                name = vendor.get("name") or vendor.get("vendorName") or vendor.get("vendor_name") or vendor.get("label") or vendor.get("companyName") or vendor.get("company_name")
                clean = normalize_vendor_label(name)
                key = comparable_company(clean)
                if not key or is_bad_vendor_label(clean) or key in seen:
                    continue
                patch = {
                    "index": int(vendor.get("index", len(out))) if str(vendor.get("index", "")).lstrip("-").isdigit() else len(out),
                    "name": clean,
                    "nameKey": vendor.get("nameKey"),
                    "unitPriceKey": vendor.get("unitPriceKey") or vendor.get("priceKey"),
                    "amountKey": vendor.get("amountKey"),
                    "quantityKey": vendor.get("quantityKey"),
                    "specKey": vendor.get("specKey"),
                }
            else:
                clean = normalize_vendor_label(vendor)
                key = comparable_company(clean)
                if not key or is_bad_vendor_label(clean) or key in seen:
                    continue
                patch = {"index": len(out), "name": clean}
            out.append(patch)
            seen.add(key)
        if out:
            # selectedVendors/visibleVendors가 있으면 그 목록을 우선 사용한다.
            break
    return out



def _column_vendor_objects(columns: List[Dict[str, Any]], rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """실제 표 컬럼/행에서 보이는 업체명과 vendor_N_* 키를 추론한다.

    request/meta가 일부만 남아 있거나 tableJson 저장이 누락된 경우에도
    현재 화면에 존재하는 업체 컬럼 수를 기준으로 자사양식 컬럼 누락을 방지한다.
    """
    by_index: Dict[int, Dict[str, Any]] = {}

    def merge(idx: int, name: Any = "", patch: Optional[Dict[str, Any]] = None) -> None:
        if idx < 0:
            return
        current = by_index.get(idx, {"index": idx})
        clean = normalize_vendor_label(name)
        if clean and not is_bad_vendor_label(clean):
            current["name"] = clean
        for k, v in (patch or {}).items():
            if v not in (None, ""):
                current[k] = v
        by_index[idx] = current

    for col in columns or []:
        key = str(col.get("key") or "")
        label = str(col.get("label") or key)
        m = re.match(r"^(?:vendor|company|target)[_\-]?(\d+)[_\-]?(name|spec|quantity|qty|unit_price|price|amount)$", key, re.I)
        if m:
            raw_idx = int(m.group(1))
            idx = raw_idx - 1 if raw_idx > 0 else raw_idx
            field = m.group(2).lower()
            patch: Dict[str, Any] = {}
            if field == "name": patch["nameKey"] = key
            if field == "spec": patch["specKey"] = key
            if field in ("quantity", "qty"): patch["quantityKey"] = key
            if field in ("unit_price", "price"): patch["unitPriceKey"] = key
            if field == "amount": patch["amountKey"] = key

            row_name = ""
            for row in rows or []:
                row_name = row.get(f"vendor_{raw_idx}_name") or row.get(f"company_{raw_idx}_name") or row.get(f"target_{raw_idx}_name") or ""
                if row_name:
                    break
            merge(idx, row_name or label, patch)
            continue

        if re.search(r"(단가|금액|견적가|견적단가|가격)$", label):
            name = normalize_vendor_label(label)
            if is_bad_vendor_label(name):
                continue
            idx = len(by_index)
            existing_idx = next((i for i, v in by_index.items() if comparable_company(v.get("name")) == comparable_company(name)), None)
            if existing_idx is not None:
                idx = existing_idx
            merge(idx, name, {"amountKey": key} if re.search(r"금액$", label) else {"unitPriceKey": key})

    # vendor_prices/vendor_amounts 맵의 키도 보이는 업체명 후보로 사용한다.
    if not by_index:
        map_names: List[str] = []
        for row in rows or []:
            for map_key in ("vendor_prices", "vendorPrices", "vendor_unit_prices", "vendor_amounts", "vendorAmounts"):
                maps = row.get(map_key)
                if isinstance(maps, dict):
                    map_names.extend(list(maps.keys()))
        for idx, name in enumerate(_dedupe_names(map_names)):
            merge(idx, name)

    return [v for _, v in sorted(by_index.items(), key=lambda item: item[0]) if v.get("name")]

def infer_vendors(columns: List[Dict[str, Any]], rows: List[Dict[str, Any]], table_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    vendor_map: Dict[str, Dict[str, Any]] = {}

    def put(name: Any, patch: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        display = normalize_vendor_label(name)
        key = comparable_company(display)
        if is_bad_vendor_label(display):
            return None
        current = vendor_map.get(key, {"name": display, "compareKey": key, "index": len(vendor_map)})
        merged = {**current, **(patch or {})}
        merged["name"] = display or merged.get("name") or current.get("name")
        merged["compareKey"] = key
        vendor_map[key] = merged
        return merged

    meta = (table_json or {}).get("meta") or {}
    request_text = (
        meta.get("userRequest") or meta.get("user_request") or meta.get("request") or
        (table_json or {}).get("userRequest") or (table_json or {}).get("user_request") or ""
    )

    request_names = _extract_request_vendor_names(request_text)
    meta_vendors = _meta_vendor_objects(table_json or {})
    meta_names = [v.get("name") for v in meta_vendors if v.get("name")]
    column_vendors = _column_vendor_objects(columns or [], rows or [])
    column_names = [v.get("name") for v in column_vendors if v.get("name")]

    # 우선순위:
    # 1) 채팅 요청에서 실제 표/메타 이상 개수로 업체명이 추출되면 요청 순서 우선
    # 2) 요청 파싱이 줄바꿈/쉼표 등으로 일부만 추출되면 meta 또는 현재 컬럼 기준 사용
    # 3) 모든 메타가 없으면 현재 컬럼 라벨/키 기준 사용
    authoritative = False
    max_known_count = max(len(meta_names), len(column_names))
    if request_names and len(request_names) >= max_known_count:
        for idx, name in enumerate(request_names):
            put(name, {"index": idx})
        authoritative = True
    elif meta_names and len(meta_names) >= len(column_names):
        for idx, vendor in enumerate(meta_vendors):
            put(vendor.get("name"), {**vendor, "index": idx})
        authoritative = True
    elif column_names:
        for idx, vendor in enumerate(column_vendors):
            put(vendor.get("name"), {**vendor, "index": idx})
        authoritative = True
    elif request_names:
        for idx, name in enumerate(request_names):
            put(name, {"index": idx})
        authoritative = True
    elif meta_names:
        for idx, vendor in enumerate(meta_vendors):
            put(vendor.get("name"), {**vendor, "index": idx})
        authoritative = True

    # vendor_N_* 형태의 컬럼키는 업체명 추가가 아니라 기존 업체 index에 키만 연결한다.
    for col in columns or []:
        key = str(col.get("key") or "")
        label = str(col.get("label") or key)
        m = re.match(r"^(?:vendor|company|target)[_\-]?(\d+)[_\-]?(name|spec|quantity|qty|unit_price|price|amount)$", key, re.I)
        if m:
            raw_idx = int(m.group(1))
            zero_idx = raw_idx - 1 if raw_idx > 0 else raw_idx
            field = m.group(2).lower()
            target = next((v for v in vendor_map.values() if int(v.get("index", -999)) == zero_idx), None)
            if not target and not authoritative:
                name = ""
                for row in rows or []:
                    name = row.get(f"vendor_{raw_idx}_name") or row.get(f"company_{raw_idx}_name") or ""
                    if name:
                        break
                name = name or normalize_vendor_label(label)
                target = put(name, {"index": zero_idx})
            if not target:
                continue
            if field == "name": target["nameKey"] = key
            if field == "spec": target["specKey"] = key
            if field in ("unit_price", "price"): target["unitPriceKey"] = key
            if field == "amount": target["amountKey"] = key
            if field in ("quantity", "qty"): target["quantityKey"] = key
            continue

        # 업체명 단가/금액 라벨 추론은 authoritative 목록이 없을 때만 신규 업체를 만든다.
        if not authoritative and re.search(r"(단가|금액|견적가|견적단가|가격)$", label):
            name = normalize_vendor_label(label)
            vendor = put(name)
            if vendor:
                if re.search(r"금액$", label):
                    vendor["amountKey"] = key
                else:
                    vendor["unitPriceKey"] = key

    # vendor_prices / vendor_amounts map에만 업체명이 있는 경우 보완.
    if not vendor_map:
        map_names: List[str] = []
        for row in rows or []:
            for map_key in ("vendor_prices", "vendorPrices", "vendor_unit_prices", "vendor_amounts", "vendorAmounts"):
                maps = row.get(map_key)
                if isinstance(maps, dict):
                    map_names.extend(list(maps.keys()))
        for idx, name in enumerate(_dedupe_names(map_names)):
            put(name, {"index": idx})

    if not vendor_map:
        names = []
        for row in rows or []:
            name = str(row.get("vendor_name") or row.get("target_name") or row.get("company_name") or "").strip()
            if name and name not in names:
                names.append(name)
        for idx, name in enumerate(names):
            put(name, {"index": idx, "unitPriceKey": "vendor_unit_price", "amountKey": "amount"})

    return sorted(vendor_map.values(), key=lambda v: int(v.get("index", 999)))


def _row_value_by_vendor_index(row: Dict[str, Any], vendor: Dict[str, Any], field_key: str) -> Any:
    """vendor_N_* / company_N_* / target_N_* 형태를 index 기준으로 직접 찾는다.

    자사양식 다운로드에서는 vendor 객체의 unitPriceKey가 누락되면
    첫 3개 업체만 채워지고 4번째 이후 업체 단가/금액이 빈칸으로 남을 수 있다.
    따라서 vendor.index를 기준으로 흔한 컬럼키를 직접 보완 탐색한다.
    """
    try:
        idx = int(vendor.get("index", -1))
    except Exception:
        idx = -1
    if idx < 0:
        return None
    one_based = idx + 1
    field_aliases = {
        "spec": ["spec", "specification", "규격"],
        "quantity": ["quantity", "qty", "수량"],
        "unit_price": ["unit_price", "price", "vendor_unit_price", "단가"],
        "amount": ["amount", "vendor_amount", "total_amount", "금액"],
    }
    aliases = field_aliases.get(field_key, [field_key])
    prefixes = [f"vendor_{one_based}", f"company_{one_based}", f"target_{one_based}", f"vendor{one_based}", f"company{one_based}", f"target{one_based}"]
    for prefix in prefixes:
        for alias in aliases:
            for key in (f"{prefix}_{alias}", f"{prefix}-{alias}"):
                if row.get(key) not in (None, ""):
                    return row.get(key)
    return None


def _scan_row_value_by_vendor_name(row: Dict[str, Any], vendor: Dict[str, Any], field_key: str) -> Any:
    """평탄화된 컬럼키/라벨에서 업체명+필드명을 스캔한다.

    예: '㈜스마트일렉 단가', '스마트일렉_금액', 'smart_amount'처럼
    정확한 unitPriceKey가 없어도 업체별 값을 찾기 위한 fallback이다.
    """
    vkey = comparable_company(vendor.get("name"))
    if not vkey:
        return None
    if field_key == "unit_price":
        include = ("unitprice", "unit_price", "price", "단가", "견적가", "견적단가")
        exclude = ("amount", "금액", "합계", "total")
    elif field_key == "amount":
        include = ("amount", "금액", "합계", "total")
        exclude = ()
    elif field_key == "quantity":
        include = ("quantity", "qty", "수량")
        exclude = ()
    elif field_key == "spec":
        include = ("spec", "specification", "규격")
        exclude = ()
    else:
        include = (field_key,)
        exclude = ()

    for raw_key, value in row.items():
        if value in (None, ""):
            continue
        key_text = str(raw_key or "")
        key_compact = comparable_company(key_text)
        key_lower = key_text.lower()
        if vkey not in key_compact:
            continue
        if not any(token.lower() in key_lower or token in key_text for token in include):
            continue
        if exclude and any(token.lower() in key_lower or token in key_text for token in exclude):
            continue
        return value
    return None


def get_vendor_value(row: Dict[str, Any], vendor: Dict[str, Any], field_key: str) -> Any:
    if field_key in ("target_name", "vendor_name", "company_name"):
        return vendor.get("name", "")

    if field_key in ("spec", "specification", "규격"):
        key = vendor.get("specKey")
        value = (row.get(key) if key else None)
        value = value if value not in (None, "") else _row_value_by_vendor_index(row, vendor, "spec")
        value = value if value not in (None, "") else _scan_row_value_by_vendor_name(row, vendor, "spec")
        return value if value not in (None, "") else get_row_value(row, "spec")

    if field_key in ("quantity", "qty"):
        key = vendor.get("quantityKey")
        value = row.get(key) if key else None
        value = value if value not in (None, "") else _row_value_by_vendor_index(row, vendor, "quantity")
        value = value if value not in (None, "") else _scan_row_value_by_vendor_name(row, vendor, "quantity")
        return value if value not in (None, "") else get_row_value(row, "quantity")

    if field_key in ("unit_price", "vendor_unit_price", "price"):
        key = vendor.get("unitPriceKey")
        if key and row.get(key) not in (None, ""):
            return row.get(key)

        value = _row_value_by_vendor_index(row, vendor, "unit_price")
        if value not in (None, ""):
            return value

        maps = row.get("vendor_prices") or row.get("vendorPrices") or row.get("vendor_unit_prices") or {}
        if isinstance(maps, dict):
            for k, v in maps.items():
                if comparable_company(k) == comparable_company(vendor.get("name")):
                    return v

        value = _scan_row_value_by_vendor_name(row, vendor, "unit_price")
        if value not in (None, ""):
            return value

        if comparable_company(row.get("vendor_name")) == comparable_company(vendor.get("name")):
            return row.get("vendor_unit_price") or row.get("unit_price") or ""
        # 단일 업체 행이 아닌 경우 vendor_unit_price를 임의로 모든 업체에 복사하지 않는다.
        return row.get("vendor_unit_price") if not row.get("vendor_name") and len([k for k in row.keys() if re.search(r"vendor_\d+_", str(k))]) == 0 else ""

    if field_key in ("amount", "vendor_amount", "total_amount"):
        # 수량 변경 후 기존 amountKey 값이 남아 있으면 금액이 틀어질 수 있으므로,
        # 가능한 경우 항상 현재 수량 × 현재 단가로 재계산한다.
        qty = to_number(get_vendor_value(row, vendor, "quantity"))
        price = to_number(get_vendor_value(row, vendor, "unit_price"))
        if qty and price:
            return int(qty * price)

        key = vendor.get("amountKey")
        if key and row.get(key) not in (None, ""):
            return row.get(key)

        value = _row_value_by_vendor_index(row, vendor, "amount")
        if value not in (None, ""):
            return value

        maps = row.get("vendor_amounts") or row.get("vendorAmounts") or {}
        if isinstance(maps, dict):
            for k, v in maps.items():
                if comparable_company(k) == comparable_company(vendor.get("name")):
                    return v

        value = _scan_row_value_by_vendor_name(row, vendor, "amount")
        if value not in (None, ""):
            return value
        return ""

    return row.get(field_key, "")


def lowest_vendor(row: Dict[str, Any], vendors: List[Dict[str, Any]]) -> Tuple[str, Any]:
    best_name = ""
    best_price = 0.0
    for vendor in vendors:
        price = to_number(get_vendor_value(row, vendor, "unit_price"))
        if price and (not best_price or price < best_price):
            best_name = vendor.get("name", "")
            best_price = price
    return best_name, int(best_price) if best_price else ""
