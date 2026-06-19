from __future__ import annotations

import re
from typing import Any, Dict, Optional

UNIT_ALIASES: dict[str, dict[str, Any]] = {
    "ea": {"aliases": ["ea", "개", "pcs", "pc", "piece", "매", "장", "대", "조", "set개"], "label": "개", "group": "count", "risky": False},
    "set": {"aliases": ["set", "세트", "셋트"], "label": "SET", "group": "package", "risky": True},
    "box": {"aliases": ["box", "박스", "박", "bx"], "label": "BOX", "group": "package", "risky": True},
    "roll": {"aliases": ["roll", "롤", "rl"], "label": "롤", "group": "package", "risky": True},
    "bag": {"aliases": ["포", "봉", "bag", "부대"], "label": "포", "group": "package", "risky": True},
    "m": {"aliases": ["m", "meter", "metre", "미터", "ｍ"], "label": "m", "group": "length", "risky": False},
    "mm": {"aliases": ["mm", "밀리", "㎜"], "label": "mm", "group": "length", "risky": False},
    "cm": {"aliases": ["cm", "센치", "㎝"], "label": "cm", "group": "length", "risky": False},
    "km": {"aliases": ["km", "킬로", "㎞"], "label": "km", "group": "length", "risky": False},
    "m2": {"aliases": ["m2", "㎡", "m²", "제곱미터", "헤베"], "label": "㎡", "group": "area", "risky": False},
    "py": {"aliases": ["평"], "label": "평", "group": "area", "risky": True},
    "m3": {"aliases": ["m3", "㎥", "m³", "루베", "입방미터"], "label": "㎥", "group": "volume", "risky": False},
    "l": {"aliases": ["l", "L", "리터", "ℓ"], "label": "L", "group": "volume", "risky": False},
    "kg": {"aliases": ["kg", "킬로", "키로", "㎏"], "label": "kg", "group": "weight", "risky": False},
    "g": {"aliases": ["g", "그램"], "label": "g", "group": "weight", "risky": False},
    "ton": {"aliases": ["ton", "톤", "t"], "label": "ton", "group": "weight", "risky": False},
    "person": {"aliases": ["인", "명", "man", "인원"], "label": "인", "group": "labor", "risky": False},
    "md": {"aliases": ["md", "m/d", "man-day", "공수", "인일"], "label": "MD", "group": "labor", "risky": False},
    "hr": {"aliases": ["hr", "h", "hour", "시간"], "label": "시간", "group": "time", "risky": False},
    "day": {"aliases": ["일", "day"], "label": "일", "group": "time", "risky": False},
    "lot": {"aliases": ["lot", "롯트"], "label": "LOT", "group": "lump_sum", "risky": True},
    "lump": {"aliases": ["식", "일식"], "label": "식", "group": "lump_sum", "risky": True},
    "bon": {"aliases": ["본"], "label": "본", "group": "material_count", "risky": True},
    "w": {"aliases": ["w", "와트"], "label": "W", "group": "electric", "risky": False},
    "kw": {"aliases": ["kw", "킬로와트"], "label": "kW", "group": "electric", "risky": False},
    "v": {"aliases": ["v", "볼트"], "label": "V", "group": "electric", "risky": False},
    "a": {"aliases": ["a", "암페어"], "label": "A", "group": "electric", "risky": False},
    "sq": {"aliases": ["sq", "㎟", "mm2", "mm²"], "label": "SQ", "group": "spec", "risky": False},
}

ALIAS_LOOKUP: dict[str, tuple[str, dict[str, Any]]] = {}
for key, data in UNIT_ALIASES.items():
    for alias in data["aliases"]:
        ALIAS_LOOKUP[alias.lower()] = (key, data)

UNIT_TOKEN_PATTERN = re.compile(
    r"(?<![A-Za-z가-힣])(?:EA|PCS|PC|SET|BOX|ROLL|LOT|M/D|MD|HR|H|M2|M3|MM|CM|KM|KG|TON|KW|W|V|A|SQ|㎡|㎥|㎜|㎝|㎏|개|매|장|대|조|본|식|일식|박스|박|롤|포|봉|부대|평|루베|리터|인|명|시간|일|공수)(?![A-Za-z가-힣])",
    re.IGNORECASE,
)

SPEC_TOKEN_PATTERN = re.compile(r"(?:[ΦØ]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:SQ|A|V|W|KW|mm|㎜))", re.IGNORECASE)


def _clean_unit(value: Any) -> str:
    text = str(value or "").strip()
    text = text.replace("．", ".").replace("／", "/")
    text = re.sub(r"[()\[\]{}:：,，]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_unit(value: Any, item_name: Any = "", spec: Any = "") -> Dict[str, Any]:
    """Return normalized unit metadata while preserving the original unit text."""
    original = _clean_unit(value)
    candidate = original

    if not candidate:
        joined = f"{item_name or ''} {spec or ''}"
        # 규격(Φ100, 2.5SQ 등)은 단위가 아니라 spec에 남기는 편이 안전하다.
        without_specs = SPEC_TOKEN_PATTERN.sub(" ", joined)
        match = UNIT_TOKEN_PATTERN.search(without_specs)
        candidate = match.group(0) if match else ""

    compact = re.sub(r"\s+", "", candidate).lower()
    if compact in ALIAS_LOOKUP:
        _, data = ALIAS_LOOKUP[compact]
        return {
            "unit_original": original or candidate,
            "unit_normalized": data["label"],
            "unit_group": data["group"],
            "unit_risky": bool(data["risky"]),
            "unit_confidence": 0.95 if original else 0.72,
        }

    # 단위 컬럼에 숫자가 같이 들어온 경우: "10 EA" 같은 값을 보정한다.
    token_match = UNIT_TOKEN_PATTERN.search(candidate)
    if token_match:
        token = token_match.group(0).lower()
        if token in ALIAS_LOOKUP:
            _, data = ALIAS_LOOKUP[token]
            return {
                "unit_original": original or token_match.group(0),
                "unit_normalized": data["label"],
                "unit_group": data["group"],
                "unit_risky": bool(data["risky"]),
                "unit_confidence": 0.86,
            }

    return {
        "unit_original": original,
        "unit_normalized": original,
        "unit_group": "unknown" if original else "missing",
        "unit_risky": bool(original),
        "unit_confidence": 0.35 if original else 0.0,
    }


def enrich_row_units(row: Dict[str, Any]) -> Dict[str, Any]:
    unit_value = row.get("unit") or row.get("unit_original") or row.get("단위")
    meta = normalize_unit(unit_value, item_name=row.get("item_name"), spec=row.get("spec"))
    enriched = dict(row)
    enriched["unit"] = meta["unit_normalized"] or str(unit_value or "")
    enriched["unit_original"] = meta["unit_original"]
    enriched["unit_normalized"] = meta["unit_normalized"]
    enriched["unit_group"] = meta["unit_group"]
    enriched["unit_confidence"] = meta["unit_confidence"]
    if meta["unit_risky"]:
        reason = "환산 기준이 없으면 단가 직접 비교가 어려운 단위입니다."
        prev = str(enriched.get("remark") or "").strip()
        if reason not in prev:
            enriched["remark"] = f"{prev} / {reason}".strip(" /")
    return enriched
