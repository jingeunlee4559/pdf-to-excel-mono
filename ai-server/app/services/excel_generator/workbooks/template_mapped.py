from __future__ import annotations

import re
from copy import copy
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook, Workbook
from openpyxl.utils import column_index_from_string, get_column_letter

from ..utils import (
    BASE_DIR,
    as_list,
    get_row_value,
    today_text,
    to_number,
)
from ..vendor_utils import get_vendor_value, infer_vendors


def copy_cell_style(src, dst) -> None:
    if src.has_style:
        dst.font = copy(src.font)
        dst.fill = copy(src.fill)
        dst.border = copy(src.border)
        dst.alignment = copy(src.alignment)
        dst.number_format = src.number_format
        dst.protection = copy(src.protection)


def copy_row_style(ws, src_row: int, dst_row: int, max_col: int) -> None:
    """src_row의 스타일을 dst_row에 복사 (데이터 행 삽입 시 스타일 유지)"""
    for col in range(1, max_col + 1):
        src = ws.cell(src_row, col)
        dst = ws.cell(dst_row, col)
        copy_cell_style(src, dst)
    if ws.row_dimensions.get(src_row):
        ws.row_dimensions[dst_row].height = ws.row_dimensions[src_row].height


def resolve_template_path(template: Dict[str, Any]) -> Optional[Path]:
    raw = template.get("file_path") or template.get("filePath") or ""
    if not raw:
        return None
    candidates = [
        Path(raw),
        Path.cwd() / raw,
        BASE_DIR / raw,
        BASE_DIR.parent / raw,
        Path(raw.replace("\\", "/")),
        Path(raw.replace("/", "\\")),
    ]
    for candidate in candidates:
        try:
            if candidate.exists():
                return candidate
        except Exception:
            pass
    return None


def cell_col(cell_address: str) -> Optional[int]:
    m = re.match(r"^([A-Z]+)", str(cell_address or ""), re.I)
    return column_index_from_string(m.group(1).upper()) if m else None


def cell_row_num(cell_address: str) -> Optional[int]:
    m = re.search(r"(\d+)$", str(cell_address or ""))
    return int(m.group(1)) if m else None


def _resolve_single_cell_value(field_key: str, payload: Dict[str, Any]) -> Any:
    """SINGLE_CELL 필드 값을 여러 소스에서 탐색하여 반환"""
    rows = as_list(payload.get("rows"))
    analysis = payload.get("analysis") or {}
    job = payload.get("job") or {}
    table_json = {}
    if isinstance(job.get("tables"), list) and job["tables"]:
        table_json = job["tables"][0].get("tableJson") or job["tables"][0].get("table_json") or {}

    # 1. 날짜 필드
    if field_key in ("document_date", "date", "created_date", "견적일자", "작성일"):
        return today_text()

    # 2. 작성자 필드
    if field_key in ("requester_name", "writer_name", "created_by", "author", "작성자"):
        return payload.get("author_name") or payload.get("authorName") or ""

    # 3. 문서명/제목 필드
    if field_key in ("document_title", "title", "문서명", "제목"):
        job_user_req = job.get("userRequest") or job.get("user_request") or ""
        doc_type = analysis.get("documentType") or analysis.get("document_type") or ""
        table_name = job.get("tables", [{}])[0].get("tableName") if isinstance(job.get("tables"), list) and job.get("tables") else ""
        return table_name or doc_type or "비교견적서" or ""

    # 4. 보고서 섹션 필드 (narrativeReport에서 추출)
    narrative = analysis.get("narrativeReport") or analysis.get("narrative_report") or {}
    if isinstance(narrative, dict):
        sections = narrative.get("sections") or {}
        section_map = {
            "overview": sections.get("overview", ""),
            "background": sections.get("background", ""),
            "current_status": sections.get("current_status", ""),
            "key_issues": sections.get("key_issues", ""),
            "overall_opinion": sections.get("overall_opinion", ""),
            "department_actions": sections.get("department_actions", ""),
            "risks": sections.get("risks", ""),
            "cost_schedule_impact": sections.get("cost_schedule_impact", ""),
            "final_opinion": sections.get("overall_opinion", ""),
            "special_note": sections.get("key_issues", ""),
        }
        if field_key in section_map and section_map[field_key]:
            return section_map[field_key]

    # 5. analysis.keyValues에서 탐색
    key_values = analysis.get("keyValues") or []
    for kv in key_values:
        label = str(kv.get("label") or "").lower()
        if field_key.lower() in label or label in field_key.lower():
            return kv.get("value") or ""

    # 6. table_json 메타데이터에서 탐색
    meta = table_json.get("meta") or {}
    if field_key in meta:
        return meta[field_key]

    # 7. rows[0]에서 탐색 (마지막 수단)
    if rows:
        val = get_row_value(rows[0], field_key)
        if val not in (None, "", 0):
            return val

    # 8. analysis.summary 등 fallback
    fallback_map = {
        "summary": analysis.get("summary", ""),
        "special_note": analysis.get("summary", ""),
        "final_opinion": analysis.get("summary", ""),
        "project_name": job.get("title") or job.get("userRequest") or "",
        "site_name": job.get("title") or "",
    }
    if field_key in fallback_map:
        return fallback_map[field_key]

    return ""


def _insert_rows_for_repeat(ws, start_row: int, template_rows: int, needed_rows: int, max_col: int) -> int:
    """
    템플릿에 할당된 행(template_rows)보다 실제 데이터(needed_rows)가 많을 때
    부족한 행 수만큼 삽입하고, 삽입한 행에 스타일 복사.
    반환값: 실제 삽입된 행 수
    """
    if needed_rows <= template_rows:
        return 0
    insert_count = needed_rows - template_rows
    insert_at = start_row + template_rows  # 데이터 영역 바로 다음 행에 삽입
    ws.insert_rows(insert_at, amount=insert_count)
    # 마지막 템플릿 데이터 행의 스타일을 새 행에 복사
    style_src_row = start_row + template_rows - 1
    for new_row in range(insert_at, insert_at + insert_count):
        copy_row_style(ws, style_src_row, new_row, max_col)
    return insert_count


def create_mapped_template_workbook(payload: Dict[str, Any]) -> Optional[Tuple[Workbook, Dict[str, Any]]]:
    template = payload.get("template") or {}
    mapping_json = payload.get("mapping_json") or {}
    mappings: List[Dict[str, Any]] = as_list(payload.get("mappings") or mapping_json.get("mappings"))
    template_path = resolve_template_path(template)

    if not template_path:
        return None
    if not mappings:
        return None

    try:
        wb = load_workbook(template_path)
    except Exception as e:
        return None

    # 시트 선택
    sheet_name = mappings[0].get("sheetName") if mappings else None
    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active

    rows = as_list(payload.get("rows"))
    columns = as_list(payload.get("columns"))
    job = payload.get("job") or {}
    table_json = {}
    if isinstance(job.get("tables"), list) and job["tables"]:
        table_json = job["tables"][0].get("tableJson") or job["tables"][0].get("table_json") or {}

    vendors = infer_vendors(columns, rows, table_json)
    max_col = ws.max_column or 14

    # ── 1단계: REPEAT_ROW 매핑에서 데이터 영역 파악 및 행 삽입 ──────────────
    repeat_mappings = [m for m in mappings if str(m.get("mappingType") or m.get("mapping_type") or "").upper() == "REPEAT_ROW"]
    if repeat_mappings and rows:
        rep = repeat_mappings[0]
        start_row = int(rep.get("startRow") or rep.get("start_row") or 7)
        template_max_rows = int(rep.get("maxRows") or rep.get("max_rows") or 16)
        needed = len(rows)
        inserted = _insert_rows_for_repeat(ws, start_row, template_max_rows, needed, max_col)
    else:
        inserted = 0

    # ── 2단계: 각 매핑 처리 ──────────────────────────────────────────────────
    company_group_info: Optional[Dict[str, Any]] = None  # 업체 컬럼 후처리용
    for m in mappings:
        field_key = m.get("fieldKey") or m.get("field_key") or ""
        mapping_type = str(m.get("mappingType") or m.get("mapping_type") or "").upper()

        # ── SINGLE_CELL ───────────────────────────────────────────────────────
        if mapping_type == "SINGLE_CELL":
            addr = m.get("cellAddress") or str(m.get("mergedRange") or "").split(":")[0]
            if not addr:
                continue
            # 행 삽입 후 주소 재계산 (footer 행들은 밀려남)
            orig_row = cell_row_num(addr)
            if orig_row and inserted > 0:
                rep_start = int(repeat_mappings[0].get("startRow") or 7) if repeat_mappings else 99
                rep_end = rep_start + int(repeat_mappings[0].get("maxRows") or 16) - 1 if repeat_mappings else 99
                if orig_row > rep_end:
                    col_letter = re.match(r"^([A-Z]+)", addr, re.I)
                    if col_letter:
                        addr = f"{col_letter.group(1)}{orig_row + inserted}"

            val = _resolve_single_cell_value(field_key, payload)
            try:
                ws[addr] = val
            except Exception:
                pass

        # ── REPEAT_ROW ────────────────────────────────────────────────────────
        elif mapping_type in ("REPEAT_ROW", "REPEAT_COLUMN"):
            col_letter = m.get("columnLetter") or re.sub(r"\d", "", str(m.get("cellAddress") or "")).strip()
            if not col_letter:
                continue
            try:
                col = column_index_from_string(str(col_letter).upper())
            except Exception:
                continue
            start = int(m.get("startRow") or m.get("start_row") or cell_row_num(m.get("cellAddress")) or 7)
            write_count = len(rows)
            for idx in range(write_count):
                val = get_row_value(rows[idx], field_key, idx) if idx < len(rows) else None
                if val not in (None, ""):
                    try:
                        cell = ws.cell(start + idx, col)
                        cell.value = val
                        # 숫자 서식 적용
                        if field_key in ("quantity", "unit_price", "amount", "total_amount") and to_number(val):
                            cell.value = int(to_number(val)) if float(to_number(val)).is_integer() else to_number(val)
                            cell.number_format = "#,##0"
                    except Exception:
                        pass

        # ── COMPANY_GROUP_COLUMN ──────────────────────────────────────────────
        elif mapping_type == "COMPANY_GROUP_COLUMN":
            start = int(m.get("startRow") or m.get("start_row") or 7)
            field = field_key
            letters: List[str] = as_list(m.get("columnLetters") or m.get("column_letters"))
            group_width = int(m.get("groupWidth") or m.get("group_width") or 4)
            group_ranges: List[str] = as_list(m.get("groupRanges") or m.get("group_ranges"))

            if field in ("target_name", "vendor_name", "company_name"):
                template_vendor_count = max(len(group_ranges), len(letters)) if (group_ranges or letters) else 1
                actual_vendor_count = len(vendors)

                # 헤더 행 번호 파악 (group_ranges 또는 start-1)
                header_row: Optional[int] = None
                if group_ranges and group_ranges[0]:
                    header_row = cell_row_num(str(group_ranges[0]).split(":")[0])
                if header_row is None:
                    header_row = max(1, start - 1)

                # ① 실제 업체 수만큼 헤더 기록 (템플릿 슬롯 범위 내)
                for idx, vendor in enumerate(vendors):
                    if idx >= template_vendor_count:
                        break
                    header_written = False
                    if idx < len(group_ranges) and group_ranges[idx]:
                        header_addr = str(group_ranges[idx]).split(":")[0]
                        try:
                            ws[header_addr] = vendor.get("name", "")
                            header_written = True
                        except Exception:
                            pass
                    if not header_written and letters and idx < len(letters):
                        try:
                            ws[f"{letters[idx]}{start}"] = vendor.get("name", "")
                        except Exception:
                            pass

                # ② 초과 업체: 오른쪽에 컬럼 그룹 삽입 (데이터 기록 전에 실행)
                if actual_vendor_count > template_vendor_count and letters:
                    ref_start = column_index_from_string(letters[-1])
                    extra_count = actual_vendor_count - template_vendor_count
                    for ex in range(extra_count):
                        insert_at = ref_start + group_width * (ex + 1)
                        try:
                            ws.insert_cols(insert_at, group_width)
                        except Exception:
                            continue
                        # 마지막 템플릿 업체 컬럼의 스타일·서브헤더 복사
                        for row_num in range(header_row, start):
                            for j in range(group_width):
                                try:
                                    src = ws.cell(row_num, ref_start + j)
                                    dst = ws.cell(row_num, insert_at + j)
                                    copy_cell_style(src, dst)
                                    if row_num != header_row:
                                        dst.value = src.value  # 서브헤더 레이블 복사
                                except Exception:
                                    pass
                        # 업체명 헤더 셀: 병합 + 스타일 + 업체명 기록
                        vendor_idx = template_vendor_count + ex
                        if vendor_idx < actual_vendor_count:
                            vendor_name = vendors[vendor_idx].get("name", "")
                            try:
                                hl = get_column_letter(insert_at)
                                hr_l = get_column_letter(insert_at + group_width - 1)
                                if group_width > 1:
                                    ws.merge_cells(f"{hl}{header_row}:{hr_l}{header_row}")
                                hcell = ws.cell(header_row, insert_at)
                                copy_cell_style(ws.cell(header_row, ref_start), hcell)
                                hcell.value = vendor_name
                            except Exception:
                                pass

                # 후처리(삭제·너비·A4)를 위해 정보 저장
                company_group_info = {
                    "letters": letters[:],
                    "group_width": group_width,
                    "template_vendor_count": template_vendor_count,
                    "actual_vendor_count": actual_vendor_count,
                }
                continue

            # 데이터 행 기록 — 동적 업체 컬럼 처리
            write_count = len(rows)
            for vidx, vendor in enumerate(vendors):
                # 컬럼 위치 결정: 템플릿 정의 범위 내 / 초과 업체 처리
                if letters and vidx < len(letters):
                    try:
                        col = column_index_from_string(letters[vidx])
                    except Exception:
                        continue
                elif letters:
                    # 초과 업체: 마지막 정의 컬럼 이후 group_width 단위로 배치
                    try:
                        last_col = column_index_from_string(letters[-1])
                        col = last_col + (vidx - len(letters) + 1) * group_width
                    except Exception:
                        continue
                else:
                    col = 6 + vidx * group_width

                for ridx in range(write_count):
                    val = get_vendor_value(rows[ridx], vendor, field) if ridx < len(rows) else None
                    if val not in (None, ""):
                        try:
                            cell = ws.cell(start + ridx, col)
                            cell.value = val
                            if field in ("unit_price", "amount", "total_amount") and to_number(val):
                                cell.value = int(to_number(val)) if float(to_number(val)).is_integer() else to_number(val)
                                cell.number_format = "#,##0"
                        except Exception:
                            pass

    # ── 3단계: 미사용 업체 컬럼 삭제 + 너비 재분배 + A4 설정 ─────────────────
    if company_group_info:
        letters_all: List[str] = company_group_info["letters"]
        gw: int = company_group_info["group_width"]
        tmpl_cnt: int = company_group_info["template_vendor_count"]
        real_cnt: int = company_group_info["actual_vendor_count"]

        if real_cnt < tmpl_cnt and letters_all:
            # 삭제 전 전체 업체 컬럼 너비 수집
            all_widths: List[float] = []
            for i in range(tmpl_cnt):
                if i < len(letters_all):
                    sc = column_index_from_string(letters_all[i])
                    for j in range(gw):
                        cl = get_column_letter(sc + j)
                        dim = ws.column_dimensions.get(cl)
                        all_widths.append(dim.width if dim and dim.width else 8.0)

            # 오른쪽(미사용) 업체 컬럼 그룹부터 역순 삭제
            for i in range(tmpl_cnt - 1, real_cnt - 1, -1):
                if i < len(letters_all):
                    try:
                        ci = column_index_from_string(letters_all[i])
                        ws.delete_cols(ci, gw)
                    except Exception:
                        pass

            # 남은 업체 컬럼 너비 재분배 (전체 업체 너비 유지 → A4 비율 충족)
            total_w = sum(all_widths)
            remaining_cols = real_cnt * gw
            if remaining_cols > 0 and total_w > 0:
                new_w = total_w / remaining_cols
                for i in range(real_cnt):
                    if i < len(letters_all):
                        sc = column_index_from_string(letters_all[i])
                        for j in range(gw):
                            ws.column_dimensions[get_column_letter(sc + j)].width = new_w

    # A4 페이지 자동 맞춤
    try:
        ws.page_setup.paperSize = 9  # A4
        ws.page_setup.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetPr.fitToPage = True
    except Exception:
        pass

    return wb, {"template_kind": "MAPPED_COMPANY_TEMPLATE", "vendor_count": len(vendors)}
