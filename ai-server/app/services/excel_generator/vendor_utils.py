from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .utils import as_list, get_row_value, to_number


def comparable_company(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"주식회사|\(주\)|㈜|（주）", "", text)
    return re.sub(r"[\s._\-()（）\[\]{}·,]", "", text).lower()


def normalize_vendor_label(label: Any) -> str:
    return re.sub(r"\s*(단가|금액|견적가|견적단가|가격)$", "", str(label or "")).strip()


def infer_vendors(columns: List[Dict[str, Any]], rows: List[Dict[str, Any]], table_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    vendor_map: Dict[str, Dict[str, Any]] = {}

    def put(name: Any, patch: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        display = str(name or "").strip()
        key = comparable_company(display)
        if not display or not key or re.match(r"^(기준|표준|일반|최저|차이|수량|단가|금액|품명|규격)$", display):
            return None
        current = vendor_map.get(key, {"name": display, "compareKey": key, "index": len(vendor_map)})
        current.update(patch or {})
        current["name"] = current.get("name") or display
        vendor_map[key] = current
        return current

    for idx, vendor in enumerate(as_list((table_json or {}).get("meta", {}).get("vendors"))):
        if isinstance(vendor, dict):
            name = vendor.get("name") or vendor.get("vendorName") or vendor.get("label")
            put(name, {
                "index": idx,
                "nameKey": vendor.get("nameKey"),
                "unitPriceKey": vendor.get("unitPriceKey") or vendor.get("priceKey"),
                "amountKey": vendor.get("amountKey"),
                "quantityKey": vendor.get("quantityKey"),
            })
        else:
            put(vendor, {"index": idx})

    for col in columns or []:
        key = str(col.get("key") or "")
        label = str(col.get("label") or key)
        m = re.match(r"^(?:vendor|company|target)[_\-]?(\d+)[_\-]?(name|spec|quantity|qty|unit_price|price|amount)$", key, re.I)
        if m:
            raw_idx = int(m.group(1))
            zero_idx = raw_idx - 1 if raw_idx > 0 else raw_idx
            field = m.group(2).lower()
            name = ""
            for row in rows or []:
                name = row.get(f"vendor_{raw_idx}_name") or row.get(f"company_{raw_idx}_name") or ""
                if name:
                    break
            name = name or normalize_vendor_label(label)
            vendor = put(name, {"index": zero_idx})
            if not vendor:
                continue
            if field == "name": vendor["nameKey"] = key
            if field in ("unit_price", "price"): vendor["unitPriceKey"] = key
            if field == "amount": vendor["amountKey"] = key
            if field in ("quantity", "qty"): vendor["quantityKey"] = key
            continue
        if re.search(r"(단가|금액|견적가|견적단가|가격)$", label):
            name = normalize_vendor_label(label)
            vendor = put(name)
            if vendor:
                if label.endswith("금액"):
                    vendor["amountKey"] = key
                else:
                    vendor["unitPriceKey"] = key

    if not vendor_map:
        names = []
        for row in rows or []:
            name = str(row.get("vendor_name") or row.get("target_name") or row.get("company_name") or "").strip()
            if name and name not in names:
                names.append(name)
        for idx, name in enumerate(names):
            put(name, {"index": idx, "unitPriceKey": "vendor_unit_price", "amountKey": "amount"})

    return sorted(vendor_map.values(), key=lambda v: v.get("index", 999))


def get_vendor_value(row: Dict[str, Any], vendor: Dict[str, Any], field_key: str) -> Any:
    if field_key in ("target_name", "vendor_name", "company_name"):
        return vendor.get("name", "")
    if field_key in ("quantity", "qty"):
        return row.get(vendor.get("quantityKey") or "") or get_row_value(row, "quantity")
    if field_key in ("unit_price", "vendor_unit_price", "price"):
        key = vendor.get("unitPriceKey")
        if key and row.get(key) not in (None, ""):
            return row.get(key)
        maps = row.get("vendor_prices") or row.get("vendorPrices") or row.get("vendor_unit_prices") or {}
        if isinstance(maps, dict):
            for k, v in maps.items():
                if comparable_company(k) == comparable_company(vendor.get("name")):
                    return v
        if comparable_company(row.get("vendor_name")) == comparable_company(vendor.get("name")):
            return row.get("vendor_unit_price") or row.get("unit_price") or ""
        return row.get("vendor_unit_price") if not row.get("vendor_name") else ""
    if field_key in ("amount", "vendor_amount"):
        key = vendor.get("amountKey")
        if key and row.get(key) not in (None, ""):
            return row.get(key)
        maps = row.get("vendor_amounts") or row.get("vendorAmounts") or {}
        if isinstance(maps, dict):
            for k, v in maps.items():
                if comparable_company(k) == comparable_company(vendor.get("name")):
                    return v
        qty = to_number(get_vendor_value(row, vendor, "quantity"))
        price = to_number(get_vendor_value(row, vendor, "unit_price"))
        return int(qty * price) if qty and price else ""
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
