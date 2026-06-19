from __future__ import annotations

import csv
import io
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from fastapi import UploadFile

from app.services.llm_client import call_local_llm_json, get_llm_config
from app.services.storage_service import save_upload_file, validate_storage_path
from app.services.unit_normalizer import enrich_row_units

DEFAULT_COLUMNS = [
    {"key": "vendor_name", "label": "업체명"},
    {"key": "item_name", "label": "품목명"},
    {"key": "spec", "label": "규격"},
    {"key": "quantity", "label": "수량"},
    {"key": "unit", "label": "단위"},
    {"key": "unit_price", "label": "단가"},
    {"key": "amount", "label": "금액"},
    {"key": "remark", "label": "비고"},
]

FIELD_ALIASES = {
    "vendor_name": ["업체", "업체명", "거래처", "공급업체", "회사명", "상호", "시공사", "견적업체"],
    "item_name": ["품목", "품목명", "자재", "자재명", "내역", "공종", "작업명", "명칭", "품명"],
    "spec": ["규격", "사양", "모델", "크기", "치수", "규격명"],
    "quantity": ["수량", "물량", "개수", "qty", "수량산출", "소요량"],
    "unit": ["단위", "uom", "unit"],
    "unit_price": ["단가", "견적단가", "단위금액", "원가", "가격"],
    "amount": ["금액", "합계", "합계금액", "총금액", "공급가액", "금 액"],
    "remark": ["비고", "메모", "특이사항", "참고사항", "비 고"],
}

NUMBER_KEYS = {"quantity", "unit_price", "amount", "supply_amount", "tax_amount"}
PRICE_COMPARE_WORDS = ["단가", "견적", "비교", "업체", "최저", "최고", "가격", "견적서"]



DOCUMENT_TYPE_RULES = [
    ("Use Case 명세서", ["use case", "유스케이스", "use case id", "actor 정의", "main flow", "alternative flow"]),
    ("업무 프로세스 명세서", ["프로세스", "as-is", "to-be", "업무 흐름"]),
    ("요구사항 정의서", ["요구사항", "기능 요구", "비기능 요구", "요구사항 id"]),
    ("보고서", ["보고서", "kpi", "pain point", "기대 효과"]),
]

BUSINESS_TABLE_REQUIRED_KEYS = {"item_name", "quantity", "unit", "unit_price", "amount", "vendor_name"}


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def source_has_value(source_text: str, value: Any) -> bool:
    """LLM이 만든 값이 실제 원문에 존재하는지 보수적으로 확인한다."""
    text = compact_text(source_text)
    raw = str(value or "").strip()
    if not raw:
        return True
    compact = compact_text(raw)
    if not compact:
        return True
    # 너무 일반적인 단어/단위는 근거 검증 대상으로 보지 않는다.
    if compact in {"개", "m", "ea", "pcs", "box", "set", "lot", "식", "원", "-", "none", "null"}:
        return True
    # 숫자는 구분자를 제거하고 확인한다.
    if re.fullmatch(r"[0-9,\.\-]+", compact):
        digits = re.sub(r"[^0-9]", "", compact)
        return bool(digits) and digits in re.sub(r"[^0-9]", "", text)
    return compact in text


def infer_document_profile(text: str, user_request: str = "") -> Dict[str, Any]:
    """문서 유형을 키워드 하나로 과잉 분류하지 않고, 제목/구조 기반으로 보수적으로 판별한다."""
    lower = text.lower()
    compact = compact_text(text)

    for doc_type, keywords in DOCUMENT_TYPE_RULES:
        score = sum(1 for kw in keywords if compact_text(kw) in compact or kw in lower)
        if score >= 2:
            return {
                "documentType": doc_type,
                "purpose": "문서 내용 분석 및 엑셀화 가능 여부 검토",
                "confidence": 0.86,
            }

    # 견적서/단가표는 단순히 본문에 '견적서'라는 예시 단어가 있다는 이유만으로 분류하지 않는다.
    price_structural_score = 0
    for kw in ["품명", "품목", "규격", "수량", "단위", "단가", "금액", "공급가액", "합계"]:
        if kw in text:
            price_structural_score += 1
    request_price = any(word in (user_request or "") for word in ["단가", "견적", "비교", "가격"])
    if price_structural_score >= 5 and ("견적" in text or "단가" in text or request_price):
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
        # 다음 항목까지 한 줄로 붙은 PDF 추출물을 완화한다.
        value = re.split(r"\s+(?:Use\s*Case\s*명|업무\s*영역|작성일|작성자|관련\s*시스템|우선순위|자동화\s*수준|관련\s*KPI)", value)[0].strip()
        if value and (label, value) not in seen:
            result.append({"label": label, "value": value})
            seen.add((label, value))
    return result[:12]


def is_business_row_supported(row: Dict[str, Any], source_text: str) -> bool:
    """LLM/규칙 파서가 만든 행이 원문 근거를 갖는 실제 업무 표 행인지 확인한다."""
    if not row:
        return False
    meaningful = {k: str(row.get(k) or "").strip() for k in BUSINESS_TABLE_REQUIRED_KEYS if str(row.get(k) or "").strip()}
    if not meaningful:
        return False

    # 품목명/업체명/규격/금액 중 하나 이상은 원문에 있어야 한다.
    anchor_keys = ["item_name", "vendor_name", "spec", "amount", "unit_price"]
    anchor_values = [row.get(k) for k in anchor_keys if str(row.get(k) or "").strip()]
    if not anchor_values:
        return False
    return any(source_has_value(source_text, v) for v in anchor_values)


def filter_grounded_rows(rows: List[Dict[str, Any]], source_text: str) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if is_business_row_supported(row, source_text):
            filtered.append(row)
    return filtered


def is_narrative_document(text: str) -> bool:
    compact = compact_text(text)
    narrative_markers = ["유스케이스", "usecase", "프로젝트개요", "actor정의", "mainflow", "alternativeflow", "businessrule", "kpi정의"]
    return sum(1 for marker in narrative_markers if marker in compact) >= 2


def normalize_header(header: Any) -> str:
    compact = re.sub(r"\s+", "", str(header or "")).lower()
    for key, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if re.sub(r"\s+", "", alias).lower() in compact:
                return key
    return compact or "field"


def clean_number(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    # 숫자, 음수, 소수, 천 단위 구분자만 남긴다. 원/₩ 등은 제거한다.
    cleaned = re.sub(r"[^0-9.,-]", "", text)
    # 1,000.00 형태는 유지하고, 1.000,00 같은 유럽식은 운영 범위 밖이므로 원문 확인 대상으로 둔다.
    return cleaned


def to_number(value: Any) -> float:
    cleaned = str(value or "").replace(",", "").strip()
    if not cleaned:
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def rows_to_table(raw_rows: List[List[Any]]) -> List[Dict[str, Any]]:
    if not raw_rows:
        return []

    cleaned_rows = []
    for row in raw_rows:
        values = ["" if v is None else str(v).strip() for v in row]
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
        score = sum(1 for aliases in FIELD_ALIASES.values() for alias in aliases if alias.lower() in joined.lower())
        if score > best_score:
            best_score = score
            header_idx = idx
        if score >= 3:
            break

    headers = [normalize_header(cell) for cell in cleaned_rows[header_idx]]
    normalized_headers = []
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
        for key, value in zip(normalized_headers, raw):
            if key in NUMBER_KEYS:
                item[key] = clean_number(value)
            else:
                item[key] = str(value or "").strip()
        rows.append(enrich_row_units(item))
    return rows


def table_to_markdown(rows: List[Dict[str, Any]], max_rows: int = 40) -> str:
    if not rows:
        return ""
    keys = [col["key"] for col in DEFAULT_COLUMNS if any(str(row.get(col["key"], "")).strip() for row in rows)]
    if not keys:
        keys = [col["key"] for col in DEFAULT_COLUMNS]
    header = "| " + " | ".join(keys) + " |"
    sep = "| " + " | ".join(["---"] * len(keys)) + " |"
    body = []
    for row in rows[:max_rows]:
        body.append("| " + " | ".join(str(row.get(key, "")).replace("\n", " ")[:80] for key in keys) + " |")
    return "\n".join([header, sep, *body])


def read_xlsx(content: bytes) -> Tuple[str, List[Dict[str, Any]]]:
    try:
        from openpyxl import load_workbook
    except Exception:
        return "", []

    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    all_rows: List[List[Any]] = []
    text_lines: List[str] = []
    for ws in wb.worksheets[:5]:
        text_lines.append(f"[sheet {ws.title}]")
        sheet_rows: List[List[Any]] = []
        for row in ws.iter_rows(values_only=True):
            values = ["" if v is None else str(v) for v in row]
            if any(v.strip() for v in values):
                sheet_rows.append(values)
                all_rows.append(values)
                text_lines.append("\t".join(values))
            if len(sheet_rows) >= 200:
                break
    return "\n".join(text_lines), rows_to_table(all_rows)


def _read_pdf_with_pypdf(content: bytes) -> Tuple[str, int | None]:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        page_texts = []
        for idx, page in enumerate(reader.pages[:50]):
            page_texts.append(f"[page {idx + 1}]\n" + (page.extract_text() or ""))
        return "\n\n".join(page_texts), len(reader.pages)
    except Exception:
        return "", None


def _read_pdf_tables_with_pdfplumber(content: bytes) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        import pdfplumber
    except Exception:
        return rows

    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages[:30]:
                for table in page.extract_tables() or []:
                    parsed = rows_to_table(table)
                    rows.extend(parsed)
                    if len(rows) >= 200:
                        return rows[:200]
    except Exception:
        return rows
    return rows


def _read_pdf_with_pymupdf(content: bytes) -> str:
    try:
        import fitz  # PyMuPDF
    except Exception:
        return ""
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        parts = []
        for idx, page in enumerate(doc[:50]):
            parts.append(f"[page {idx + 1} blocks]\n" + page.get_text("text", sort=True))
        return "\n\n".join(parts)
    except Exception:
        return ""


def read_pdf(content: bytes) -> Tuple[str, List[Dict[str, Any]], int | None]:
    text, page_count = _read_pdf_with_pypdf(content)
    rows = _read_pdf_tables_with_pdfplumber(content)
    if len(text.strip()) < 80:
        fallback_text = _read_pdf_with_pymupdf(content)
        if len(fallback_text.strip()) > len(text.strip()):
            text = fallback_text
    return text, rows, page_count


def read_docx(content: bytes) -> Tuple[str, List[Dict[str, Any]]]:
    try:
        from docx import Document

        doc = Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        raw_rows: List[List[Any]] = []
        for table in doc.tables:
            for row in table.rows:
                values = [cell.text.strip() for cell in row.cells]
                raw_rows.append(values)
        table_lines = ["\t".join(map(str, row)) for row in raw_rows]
        return "\n".join(paragraphs + table_lines), rows_to_table(raw_rows)
    except Exception:
        return "", []


def decode_text(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def parse_delimited_text(text: str) -> List[Dict[str, Any]]:
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return []

    sample = "\n".join(lines[:30])
    delimiter_candidates = ["\t", ",", "|", ";"]
    delimiter = max(delimiter_candidates, key=lambda d: sample.count(d))
    if sample.count(delimiter) < 2:
        spaced_rows = [re.split(r"\s{2,}", line.strip()) for line in lines if len(re.split(r"\s{2,}", line.strip())) >= 3]
        return rows_to_table(spaced_rows) if len(spaced_rows) >= 2 else []

    reader = csv.reader(lines, delimiter=delimiter)
    raw_rows = [row for row in reader]
    return rows_to_table(raw_rows)


def infer_rows_from_text(text: str, filename: str) -> List[Dict[str, Any]]:
    """텍스트에서 업무 표 행을 보수적으로 추정한다.

    이전 버전처럼 본문에 숫자나 '견적서'라는 단어가 일부 있다는 이유로 임의 행을 만들지 않는다.
    표 형태가 명확하지 않으면 빈 배열을 반환하고, 분석 요약/확인 필요로 처리한다.
    """
    table_rows = parse_delimited_text(text)
    table_rows = filter_grounded_rows(table_rows, text)
    if table_rows:
        return table_rows

    if is_narrative_document(text):
        return []

    rows: List[Dict[str, Any]] = []
    # 예: 품목명 규격 수량 단위 단가 금액 형태가 한 줄에 존재할 때만 추정한다.
    line_pattern = re.compile(
        r"(?P<item>[가-힣A-Za-z0-9()\[\]#/+\-.\s]{2,40})\s+"
        r"(?P<spec>[A-Za-z0-9가-힣ΦØ㎡㎥㎜㎝㎏./*xX\-\s]{0,30})\s+"
        r"(?P<qty>[0-9]+(?:\.[0-9]+)?)\s*"
        r"(?P<unit>EA|PCS|SET|BOX|LOT|M|m|개|식|본|장|대|조|롤|포|kg|KG|㎡|㎥)?\s+"
        r"(?P<unit_price>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,})\s+"
        r"(?P<amount>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,})"
    )
    for line in text.splitlines()[:1000]:
        if not line.strip():
            continue
        m = line_pattern.search(line)
        if not m:
            continue
        row = enrich_row_units({
            "vendor_name": "",
            "item_name": m.group("item").strip(),
            "spec": m.group("spec").strip(),
            "quantity": clean_number(m.group("qty")),
            "unit": (m.group("unit") or "").strip(),
            "unit_price": clean_number(m.group("unit_price")),
            "amount": clean_number(m.group("amount")),
            "remark": "텍스트 행에서 추정",
        })
        if is_business_row_supported(row, text):
            rows.append(row)
        if len(rows) >= 100:
            break
    return rows


def validate_rows(rows: List[Dict[str, Any]], table_type: str = "NORMAL_TABLE") -> List[Dict[str, Any]]:
    issues = []
    for idx, row in enumerate(rows):
        qty = to_number(row.get("quantity"))
        unit_price = to_number(row.get("unit_price"))
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
        if not row.get("item_name") and not row.get("vendor_name"):
            issues.append({
                "rowIndex": idx,
                "issueType": "MISSING_KEY_FIELD",
                "severity": "WARNING",
                "fieldKey": "item_name",
                "fieldLabel": "품목명",
                "message": f"{idx + 1}행의 품목명 또는 업체명을 확인하세요.",
            })
        if row.get("unit_group") in {"package", "lump_sum", "material_count", "unknown"}:
            issues.append({
                "rowIndex": idx,
                "issueType": "UNIT_REVIEW_REQUIRED",
                "severity": "WARNING",
                "fieldKey": "unit",
                "fieldLabel": "단위",
                "message": f"{idx + 1}행 단위 '{row.get('unit_original') or row.get('unit')}'는 환산 기준이 없으면 직접 단가 비교가 어렵습니다.",
            })

    if table_type == "PRICE_COMPARISON":
        grouped: Dict[str, set[str]] = {}
        for row in rows:
            item_key = str(row.get("item_name") or "").strip()
            if not item_key:
                continue
            grouped.setdefault(item_key, set()).add(str(row.get("unit_normalized") or row.get("unit") or "").strip())
        for item_name, units in grouped.items():
            real_units = {u for u in units if u}
            if len(real_units) >= 2:
                issues.append({
                    "rowIndex": None,
                    "issueType": "UNIT_MISMATCH_BETWEEN_VENDORS",
                    "severity": "WARNING",
                    "fieldKey": "unit",
                    "fieldLabel": "단위",
                    "message": f"'{item_name}' 품목은 업체별 단위가 달라 직접 단가 비교 전에 환산 기준 확인이 필요합니다. 단위={', '.join(sorted(real_units))}",
                })
    return issues


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[TRUNCATED]"


def should_call_llm(user_request: str, combined_text: str, rows: List[Dict[str, Any]], file_count: int, table_type: str) -> bool:
    cfg = get_llm_config()
    if not cfg.enabled or cfg.provider != "ollama":
        return False
    if not combined_text.strip():
        return False
    if cfg.use_mode == "always":
        return True
    if cfg.use_mode == "off":
        return False
    request_text = user_request or ""
    if table_type == "PRICE_COMPARISON":
        return True
    if file_count >= 2:
        return True
    if not rows:
        return True
    if any(word in request_text for word in ["단가", "비교", "업체", "표", "엑셀", "자사", "양식"]):
        return True
    return False


def build_llm_prompt(user_request: str, output_mode: str, template_id: str | None, combined_text: str, rows: List[Dict[str, Any]]) -> str:
    cfg = get_llm_config()
    markdown_table = table_to_markdown(rows, max_rows=50)
    compact_rows = json.dumps(rows[:80], ensure_ascii=False)
    text_part = _truncate(combined_text, cfg.context_chars)
    return f"""
너는 건설/전기/설비 업무 문서를 엑셀화하기 위한 문서 구조화 엔진이다.
반드시 JSON 객체 1개만 반환한다. 설명문, 마크다운, 코드블록은 금지한다.

[사용자 요청]
{user_request or '문서를 분석해서 표로 만들어줘'}

[산출 방식]
output_mode={output_mode or 'FREE_FORM'}
template_id={template_id or ''}

[기존 규칙 파서 표 후보]
{markdown_table or '(표 후보 없음)'}

[표 후보 JSON]
{compact_rows}

[PDF/문서 추출 텍스트]
{text_part}

[반환 JSON 스키마]
{{
  "analysis": {{
    "documentType": "단가 비교 자료|견적서|거래명세서|업무 문서|기타 중 하나 또는 적절한 한글명",
    "purpose": "문서 데이터 엑셀화 목적",
    "summary": "핵심 분석 결과 1~3문장. 추측 금지. 확인 필요 사항 명시.",
    "confidence": 0.0,
    "keyValues": [{{"label": "문서 유형", "value": "..."}}]
  }},
  "table": {{
    "tableName": "문서 표 후보",
    "tableType": "PRICE_COMPARISON 또는 NORMAL_TABLE",
    "columns": [
      {{"key":"vendor_name","label":"업체명"}},
      {{"key":"item_name","label":"품목명"}},
      {{"key":"spec","label":"규격"}},
      {{"key":"quantity","label":"수량"}},
      {{"key":"unit","label":"단위"}},
      {{"key":"unit_price","label":"단가"}},
      {{"key":"amount","label":"금액"}},
      {{"key":"remark","label":"비고"}}
    ],
    "rows": [
      {{
        "vendor_name":"",
        "item_name":"",
        "spec":"",
        "quantity":"",
        "unit":"",
        "unit_original":"",
        "unit_normalized":"",
        "unit_price":"",
        "amount":"",
        "remark":""
      }}
    ]
  }},
  "issues": [
    {{"rowIndex":0,"issueType":"CHECK_REQUIRED","severity":"WARNING","fieldKey":"unit","fieldLabel":"단위","message":"확인 필요 사유"}}
  ]
}}

[중요 규칙]
1. 원문에 없는 업체명/품목명/규격/수량/단위/단가/금액을 절대 만들어내지 말 것.
2. 문서가 유스케이스 명세서, 보고서, 요구사항서, 설명 문서이면 견적서/단가표로 분류하지 말고 table.rows는 빈 배열로 둔다.
3. 본문에 예시로 "견적서", "단가표"라는 단어가 있어도 실제 제목/표 구조가 아니면 견적서로 판단하지 않는다.
4. 실제 표 행이 없으면 rows를 만들지 말고 issues에 TABLE_NOT_FOUND 또는 NO_BUSINESS_TABLE을 추가한다.
5. 단위는 원문 단위를 unit_original에 보존하고, EA/개/PCS는 개, M/미터는 m, BOX/박스는 BOX, LOT는 LOT, 식은 식으로 정규화한다.
6. BOX, SET, LOT, 식, 본, 롤, 포처럼 환산 기준이 필요한 단위는 issues에 UNIT_REVIEW_REQUIRED를 추가한다.
7. 수량×단가와 금액이 다르면 AMOUNT_MISMATCH issue를 추가한다.
8. 업체별 단위가 다른 단가 비교는 최저가를 확정하지 말고 확인 필요로 둔다.
9. 행/열이 애매하면 추측하지 말고 rows에 넣지 않는다.
""".strip()


def normalize_llm_result(llm_result: Dict[str, Any], fallback_rows: List[Dict[str, Any]], fallback_table_type: str, source_text: str, user_request: str = "") -> Tuple[Dict[str, Any], Dict[str, Any], List[Dict[str, Any]]]:
    analysis = llm_result.get("analysis") if isinstance(llm_result.get("analysis"), dict) else {}
    table = llm_result.get("table") if isinstance(llm_result.get("table"), dict) else {}
    if not table and isinstance(llm_result.get("tables"), list) and llm_result["tables"]:
        table = llm_result["tables"][0]

    rows = table.get("rows") if isinstance(table.get("rows"), list) else fallback_rows
    normalized_rows = []
    for row in rows[:250]:
        if not isinstance(row, dict):
            continue
        clean_row = {key: (clean_number(value) if key in NUMBER_KEYS else str(value or "").strip()) for key, value in row.items()}
        enriched = enrich_row_units(clean_row)
        if is_business_row_supported(enriched, source_text):
            normalized_rows.append(enriched)

    # LLM이 원문에 없는 예시 행을 생성한 경우 제거하고, 근거 있는 규칙 파서 행만 fallback으로 사용한다.
    if not normalized_rows:
        normalized_rows = filter_grounded_rows(fallback_rows, source_text)

    table_type = table.get("tableType") or table.get("table_type") or fallback_table_type
    if table_type not in {"PRICE_COMPARISON", "NORMAL_TABLE"}:
        table_type = fallback_table_type
    if not normalized_rows:
        table_type = "NORMAL_TABLE"

    normalized_table = {
        "tableName": table.get("tableName") or table.get("table_name") or "문서 표 후보",
        "tableType": table_type,
        "columns": table.get("columns") if isinstance(table.get("columns"), list) else DEFAULT_COLUMNS,
        "rows": normalized_rows,
    }

    profile = infer_document_profile(source_text, user_request)
    inferred_doc_type = profile["documentType"]
    llm_doc_type = str(analysis.get("documentType") or analysis.get("document_type") or "").strip()
    # narrative 문서인데 LLM이 견적서/단가표로 과잉 분류한 경우 원문 기반 판별을 우선한다.
    if is_narrative_document(source_text) or (llm_doc_type in {"견적서", "단가 비교 자료", "견적서/단가표"} and not normalized_rows):
        doc_type = inferred_doc_type
    else:
        doc_type = llm_doc_type or inferred_doc_type or ("단가 비교 자료" if table_type == "PRICE_COMPARISON" else "업무 문서")

    key_values = analysis.get("keyValues") if isinstance(analysis.get("keyValues"), list) else []
    grounded_key_values = []
    for kv in key_values[:20]:
        if not isinstance(kv, dict):
            continue
        label = str(kv.get("label") or "").strip()
        value = str(kv.get("value") or "").strip()
        if label and value and source_has_value(source_text, value):
            grounded_key_values.append({"label": label, "value": value})
    # 원문에서 안정적으로 뽑을 수 있는 메타값을 보강한다.
    for kv in extract_key_values_from_text(source_text):
        if kv not in grounded_key_values:
            grounded_key_values.append(kv)

    summary = str(analysis.get("summary") or "").strip()
    if not summary or ("견적" in summary and not normalized_rows and is_narrative_document(source_text)):
        if normalized_rows:
            summary = f"문서에서 표 후보 {len(normalized_rows)}행을 추출했습니다. 추출값은 원문 근거 기준으로 확인이 필요합니다."
        else:
            summary = "업로드 문서는 설명/명세 중심 문서로 보이며, 견적 단가표 형태의 품목·수량·단가 행은 확인되지 않았습니다."

    normalized_analysis = {
        "documentType": doc_type,
        "purpose": analysis.get("purpose") or profile.get("purpose") or "문서 데이터 엑셀화",
        "summary": summary,
        "confidence": min(float(analysis.get("confidence") or profile.get("confidence") or 0.7), 0.88),
        "keyValues": grounded_key_values[:20],
        "llmMeta": llm_result.get("_llm", {}),
    }

    issues = llm_result.get("issues") if isinstance(llm_result.get("issues"), list) else []
    normalized_issues = []
    for issue in issues[:100]:
        if not isinstance(issue, dict):
            continue
        normalized_issues.append({
            "rowIndex": issue.get("rowIndex") if issue.get("rowIndex") is not None else None,
            "issueType": issue.get("issueType") or "CHECK_REQUIRED",
            "severity": issue.get("severity") or "WARNING",
            "fieldKey": issue.get("fieldKey") or issue.get("field") or None,
            "fieldLabel": issue.get("fieldLabel") or None,
            "message": issue.get("message") or "LLM 분석 결과 확인이 필요합니다.",
            "suggestedValue": issue.get("suggestedValue") or None,
        })

    return normalized_analysis, normalized_table, normalized_issues


async def analyze_uploads(files: List[UploadFile], user_request: str, output_mode: str, template_id: str | None) -> Dict[str, Any]:
    parsed_files = []
    all_rows: List[Dict[str, Any]] = []
    combined_text_parts = []

    for file in files:
        saved = await save_upload_file(file, "documents")
        target_path = validate_storage_path(saved["filePath"])
        content = target_path.read_bytes()
        suffix = target_path.suffix.lower()
        text = ""
        rows: List[Dict[str, Any]] = []
        page_count = None

        if suffix in {".xlsx", ".xlsm"}:
            text, rows = read_xlsx(content)
        elif suffix == ".pdf":
            text, rows, page_count = read_pdf(content)
        elif suffix == ".docx":
            text, rows = read_docx(content)
        elif suffix in {".txt", ".csv", ".tsv", ".md", ".json"}:
            text = decode_text(content)
        else:
            text = decode_text(content)

        if not rows:
            rows = infer_rows_from_text(text, saved["originalName"] or "file")
        rows = [enrich_row_units(row) for row in rows]
        all_rows.extend(rows)
        combined_text_parts.append(text)
        parsed_files.append({
            **saved,
            "pageCount": page_count,
            "page_count": page_count,
            "extractedText": text,
            "extracted_text": text,
            "pages": [],
        })

    combined_text = "\n\n".join(combined_text_parts)
    all_rows = filter_grounded_rows(all_rows, combined_text)
    profile = infer_document_profile(combined_text, user_request)
    wants_price_compare = any(word in (user_request or "") for word in ["단가", "비교", "가격", "견적"])
    has_price_rows = bool(all_rows) and profile.get("documentType") in {"견적서/단가표"}
    table_type = "PRICE_COMPARISON" if (wants_price_compare and bool(all_rows)) or has_price_rows else "NORMAL_TABLE"
    document_type = profile.get("documentType") or ("단가 비교 자료" if table_type == "PRICE_COMPARISON" else "업무 문서")

    model_name = "lite-rule-parser-no-ocr"
    prompt_version = "lite-v3-pdf-table-unit-rule"
    llm_used = False
    llm_error = ""
    analysis = {
        "documentType": document_type,
        "purpose": profile.get("purpose") or "문서 데이터 엑셀화",
        "summary": (
            f"첨부 파일 {len(files)}개에서 텍스트와 표 후보 {len(all_rows)}행을 추출했습니다. "
            f"요청 내용은 '{user_request}'이며, 산출 방식은 {output_mode}입니다. "
            "원문에 근거가 없는 품목·금액·단가는 생성하지 않습니다."
        ),
        "confidence": profile.get("confidence") if profile else (0.86 if all_rows else 0.58),
        "keyValues": [
            *extract_key_values_from_text(combined_text),
            {"label": "파일 수", "value": len(files)},
            {"label": "표 후보 행", "value": len(all_rows)},
            {"label": "저장 위치", "value": "ai-server"},
            {"label": "LLM 모드", "value": get_llm_config().use_mode},
        ],
    }
    table = {
        "tableName": "문서 표 후보",
        "tableType": table_type,
        "columns": DEFAULT_COLUMNS,
        "rows": all_rows,
    }
    issues = validate_rows(all_rows, table_type=table_type)

    if should_call_llm(user_request, combined_text, all_rows, len(files), table_type):
        cfg = get_llm_config()
        prompt = build_llm_prompt(user_request, output_mode, template_id, combined_text, all_rows)
        try:
            llm_result = await call_local_llm_json(prompt, cfg)
            llm_analysis, llm_table, llm_issues = normalize_llm_result(llm_result, all_rows, table_type, combined_text, user_request)
            analysis = llm_analysis
            table = llm_table
            # LLM 이슈 + 시스템 검증 이슈를 합친다. 중복은 message 기준으로 제거한다.
            system_issues = validate_rows(table.get("rows", []), table_type=table.get("tableType", table_type))
            dedup: Dict[str, Dict[str, Any]] = {}
            for issue in [*llm_issues, *system_issues]:
                key = f"{issue.get('rowIndex')}|{issue.get('issueType')}|{issue.get('fieldKey')}|{issue.get('message')}"
                dedup[key] = issue
            issues = list(dedup.values())
            llm_used = True
            model_name = f"ollama:{cfg.model}"
            prompt_version = "ollama-structure-v1"
            analysis.setdefault("keyValues", [])
            analysis["keyValues"].extend([
                {"label": "LLM", "value": "사용"},
                {"label": "모델", "value": cfg.model},
            ])
        except Exception as exc:
            llm_error = str(exc)
            analysis["summary"] += f" 로컬 LLM 호출은 실패하여 규칙 기반 결과로 표시합니다. 오류: {llm_error}"
            analysis["keyValues"].extend([
                {"label": "LLM", "value": "실패/fallback"},
                {"label": "LLM 오류", "value": llm_error[:120]},
            ])
            issues.insert(0, {
                "rowIndex": None,
                "issueType": "LLM_FALLBACK",
                "severity": "WARNING",
                "fieldKey": "analysis",
                "fieldLabel": "문서분석",
                "message": "Ollama 로컬 LLM 호출에 실패하여 규칙 기반 분석 결과를 사용했습니다. Ollama 실행 여부와 모델 설치 여부를 확인하세요.",
            })

    # 표 행이 없는데 LLM/규칙 파서가 값을 만들지 못한 경우, 빈 표를 유지하고 확인 필요만 표시한다.
    current_rows = table.get("rows", []) if isinstance(table, dict) else []
    if not current_rows and not any(issue.get("issueType") == "NO_BUSINESS_TABLE" for issue in issues):
        issues.append({
            "rowIndex": None,
            "issueType": "NO_BUSINESS_TABLE",
            "severity": "INFO",
            "fieldKey": "table",
            "fieldLabel": "표 데이터",
            "message": "원문에서 견적/단가표 형태의 품목·수량·단가 행은 확인되지 않았습니다. 근거 없는 표 행은 생성하지 않았습니다.",
        })
        analysis["summary"] = analysis.get("summary") or "문서 내용은 확인되었지만 업무 표 행은 추출되지 않았습니다."

    # confidence는 이슈가 많으면 보수적으로 낮춘다.
    if issues:
        analysis["confidence"] = min(float(analysis.get("confidence") or 0.7), 0.82)

    return {
        "model": model_name,
        "promptVersion": prompt_version,
        "llmUsed": llm_used,
        "llmError": llm_error,
        "analysis": analysis,
        "tables": [table],
        "issues": issues,
        "files": parsed_files,
    }
