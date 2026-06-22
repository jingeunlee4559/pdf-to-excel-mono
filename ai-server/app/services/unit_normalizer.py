from __future__ import annotations

import re
from typing import Any, Dict

# 건설 표준시장단가/견적서에서 실제로 자주 쓰는 단위를 보수적으로 정규화한다.
# 원문 단위는 unit_original에 남기고, 화면/검증용 값만 unit_normalized로 표준화한다.
UNIT_ALIASES: dict[str, dict[str, Any]] = {
    "ea": {"aliases": ["ea", "개", "pcs", "pc", "piece", "매", "장", "대", "조", "개소", "개소당"], "label": "개", "group": "count", "risky": False},
    "place": {"aliases": ["개소"], "label": "개소", "group": "count", "risky": False},
    "set": {"aliases": ["set", "세트", "셋트"], "label": "SET", "group": "package", "risky": True},
    "box": {"aliases": ["box", "박스", "박", "bx"], "label": "BOX", "group": "package", "risky": True},
    "roll": {"aliases": ["roll", "롤", "rl"], "label": "롤", "group": "package", "risky": True},
    "bag": {"aliases": ["포", "봉", "bag", "부대"], "label": "포", "group": "package", "risky": True},
    "m": {"aliases": ["m", "meter", "metre", "미터", "ｍ"], "label": "m", "group": "length", "risky": False},
    "mm": {"aliases": ["mm", "밀리", "㎜"], "label": "mm", "group": "length", "risky": False},
    "cm": {"aliases": ["cm", "센치", "㎝"], "label": "cm", "group": "length", "risky": False},
    "km": {"aliases": ["km", "킬로", "㎞"], "label": "km", "group": "length", "risky": False},
    "m2": {"aliases": ["m2", "m^2", "㎡", "m²", "제곱미터", "헤베"], "label": "㎡", "group": "area", "risky": False},
    "py": {"aliases": ["평"], "label": "평", "group": "area", "risky": True},
    "m3": {"aliases": ["m3", "m^3", "㎥", "m³", "루베", "입방미터"], "label": "㎥", "group": "volume", "risky": False},
    "construction_m3": {"aliases": ["공m3", "공m^3", "공m³", "공㎥", "공 m3", "공 m³", "공 ㎥"], "label": "공㎥", "group": "construction_volume", "risky": False},
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
    "bon": {"aliases": ["본"], "label": "본", "group": "material_count", "risky": False},
    "w": {"aliases": ["w", "와트"], "label": "W", "group": "electric", "risky": False},
    "kw": {"aliases": ["kw", "킬로와트", "kwh"], "label": "kW", "group": "electric", "risky": False},
    "v": {"aliases": ["v", "볼트"], "label": "V", "group": "electric", "risky": False},
    "a": {"aliases": ["a", "암페어"], "label": "A", "group": "electric", "risky": False},
    "sq": {"aliases": ["sq", "㎟", "mm2", "mm²"], "label": "SQ", "group": "spec", "risky": False},
}

ALIAS_LOOKUP: dict[str, tuple[str, dict[str, Any]]] = {}
for key, data in UNIT_ALIASES.items():
    for alias in data["aliases"]:
        ALIAS_LOOKUP[re.sub(r"\s+", "", alias).lower()] = (key, data)

UNIT_TOKEN_PATTERN = re.compile(
    r"(?<![A-Za-z가-힣])(?:공\s*m\s*(?:3|³|\^3)|공\s*㎥|EA|PCS|PC|SET|BOX|ROLL|LOT|M/D|MD|HR|H|M\s*2|M\s*3|M\^2|M\^3|MM|CM|KM|KG|TON|KW|KWH|W|V|A|SQ|㎡|㎥|㎜|㎝|㎏|개소|개|매|장|대|조|본|식|일식|박스|박|롤|포|봉|부대|평|루베|리터|인|명|시간|일|공수)(?![A-Za-z가-힣])",
    re.IGNORECASE,
)

SPEC_TOKEN_PATTERN = re.compile(r"(?:[ΦØ∅]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:SQ|A|V|W|KW|mm|㎜))", re.IGNORECASE)


def repair_unit_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = text.replace("．", ".").replace("／", "/").replace("ｍ", "m")
    text = text.replace("㎥", "m3").replace("㎡", "m2").replace("㎜", "mm").replace("㎝", "cm").replace("㎏", "kg")
    text = text.replace("m²", "m2").replace("m³", "m3")
    # PDF 텍스트 추출에서 m\n2, 공m\n3, m 2처럼 지수가 분리되는 경우 복구
    text = re.sub(r"공\s*m\s*(?:\^?\s*)?3\b", "공m3", text, flags=re.I)
    text = re.sub(r"\bm\s*(?:\^?\s*)?2\b", "m2", text, flags=re.I)
    text = re.sub(r"\bm\s*(?:\^?\s*)?3\b", "m3", text, flags=re.I)
    # OCR/표 추출 잡음: 'nr 개소'처럼 단위 앞에 붙은 무의미 영문 제거
    text = re.sub(r"^[a-z]{1,3}\s+(?=개소$)", "", text, flags=re.I)
    text = re.sub(r"[()\[\]{}:：,，]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_unit(value: Any) -> str:
    return repair_unit_text(value)


def normalize_unit(value: Any, item_name: Any = "", spec: Any = "") -> Dict[str, Any]:
    """Return normalized unit metadata while preserving the original unit text."""
    original = _clean_unit(value)
    candidate = original

    if not candidate:
        joined = f"{item_name or ''} {spec or ''}"
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
            "unit_confidence": 0.97 if original else 0.72,
        }

    token_match = UNIT_TOKEN_PATTERN.search(candidate)
    if token_match:
        token_compact = re.sub(r"\s+", "", token_match.group(0)).lower()
        if token_compact in ALIAS_LOOKUP:
            _, data = ALIAS_LOOKUP[token_compact]
            return {
                "unit_original": original or token_match.group(0),
                "unit_normalized": data["label"],
                "unit_group": data["group"],
                "unit_risky": bool(data["risky"]),
                "unit_confidence": 0.9,
            }

    return {
        "unit_original": original,
        "unit_normalized": original,
        "unit_group": "unknown" if original else "missing",
        "unit_risky": False,
        "unit_confidence": 0.35 if original else 0.0,
    }


def clean_cell_text(value: Any) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def enrich_row_units(row: Dict[str, Any]) -> Dict[str, Any]:
    unit_value = row.get("unit") or row.get("unit_original") or row.get("단위")
    meta = normalize_unit(unit_value, item_name=row.get("item_name"), spec=row.get("spec"))
    enriched = dict(row)
    enriched["unit"] = meta["unit_normalized"] or str(unit_value or "")
    enriched["unit_original"] = meta["unit_original"]
    enriched["unit_normalized"] = meta["unit_normalized"]
    enriched["unit_group"] = meta["unit_group"]
    enriched["unit_confidence"] = meta["unit_confidence"]
    # 행별 비고에 '환산 기준' 문구를 자동 삽입하지 않는다.
    # 비교 단위 불일치 여부는 validate_rows에서 같은 품목/규격/업체 조건으로만 판단한다.
    return enriched
