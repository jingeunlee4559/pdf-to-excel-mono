const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeExcelName(fileName, fallback) {
  const safeName = String(fileName || fallback || 'document_result.xlsx').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document_result.xlsx';
  return safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`;
}

function getResultPath(jobId, fileName) {
  const resultDir = process.env.RESULT_DIR || 'storage/results';
  ensureDir(resultDir);
  const safeName = sanitizeExcelName(fileName, `document_job_${jobId}.xlsx`);
  const storedName = `${Date.now()}_${safeName}`;
  return { safeName, filePath: path.join(resultDir, storedName) };
}

async function createExcelFile({ jobId, fileName, columns, rows }) {
  const { safeName, filePath } = getResultPath(jobId, fileName);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI 업무문서 자동화 시스템';
  const sheet = workbook.addWorksheet('문서분석결과');
  sheet.columns = (columns || []).map((col) => ({ header: col.label || col.key, key: col.key, width: 18 }));
  (rows || []).forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  await workbook.xlsx.writeFile(filePath);
  return { fileName: safeName, filePath };
}

function colToNumber(letter = '') {
  return String(letter).toUpperCase().split('').reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
}

function numberToCol(num) {
  let n = Number(num);
  let out = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out;
}

function parseA1(address = '') {
  const match = String(address || '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return { col: colToNumber(match[1]), row: Number(match[2]), colLetter: match[1].toUpperCase() };
}

function resolveTemplatePath(templateFilePath = '') {
  const raw = String(templateFilePath || '').trim();
  const candidates = [];
  if (raw) candidates.push(raw);
  if (raw && !path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
    candidates.push(path.resolve(process.cwd(), raw));
    candidates.push(path.resolve(__dirname, '..', raw));
  }
  const normalized = raw.replaceAll('\\', path.sep).replaceAll('/', path.sep);
  if (normalized && normalized !== raw) candidates.push(normalized);
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error(`자사 양식 파일을 찾을 수 없습니다. file_path=${raw}`);
  return found;
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : undefined;
}

function copyCell(source, target, { copyValue = true } = {}) {
  if (copyValue) target.value = source.value;
  target.style = cloneStyle(source.style) || {};
  if (source.numFmt) target.numFmt = source.numFmt;
  if (source.alignment) target.alignment = cloneStyle(source.alignment);
  if (source.border) target.border = cloneStyle(source.border);
  if (source.fill) target.fill = cloneStyle(source.fill);
  if (source.font) target.font = cloneStyle(source.font);
  if (source.protection) target.protection = cloneStyle(source.protection);
}

function safeUnmerge(sheet, range) {
  try { sheet.unMergeCells(range); } catch { /* already unmerged */ }
}

function safeMerge(sheet, range) {
  try { sheet.mergeCells(range); } catch { /* duplicate merge, ignore */ }
}

function unmergeRangesTouchingRow(sheet, rowNumber) {
  const merges = sheet?._merges || {};
  Object.keys(merges).forEach((range) => {
    const parts = String(range || '').split(':');
    if (!parts.length) return;
    const start = parseA1(parts[0]);
    const end = parseA1(parts[1] || parts[0]);
    if (!start || !end) return;
    if (start.row <= rowNumber && rowNumber <= end.row) safeUnmerge(sheet, range);
  });
}

function clearRowCells(sheet, rowNumber, startCol, endCol) {
  for (let col = startCol; col <= endCol; col += 1) {
    sheet.getCell(rowNumber, col).value = null;
  }
}

function applyCellLook(sheet, address, value, style) {
  const cell = sheet.getCell(address);
  cell.value = value;
  if (style) cell.style = cloneStyle(style) || {};
}

function normalizeHeaderRow(sheet, lastVisibleCol) {
  // 업체 그룹을 동적으로 늘릴 때 K:N 양식 복사로 row 4의 '작성자/시스템관리자'가
  // 오른쪽 업체 구역에 반복 복사되는 문제를 막는다.
  // row 4는 항상 [안내문][견적일자][일자값][작성자][작성자값] 1세트만 끝에 둔다.
  const finalCol = Math.max(Number(lastVisibleCol || 14), 10);
  const baseStyle = cloneStyle(sheet.getCell('A4').style) || {};
  const labelStyle = cloneStyle(sheet.getCell('G4').style) || baseStyle;
  const valueStyle = cloneStyle(sheet.getCell('I4').style) || baseStyle;

  unmergeRangesTouchingRow(sheet, 4);
  clearRowCells(sheet, 4, 1, Math.max(finalCol, 30));

  let introStart = 1;
  let introEnd;
  let dateLabelStart;
  let dateValueStart;
  let writerLabelStart;
  let writerValueStart;

  if (finalCol <= 10) {
    introEnd = 4;
    dateLabelStart = 5;
    dateValueStart = 7;
    writerLabelStart = 9;
    writerValueStart = 10;
  } else {
    introEnd = finalCol - 8;
    dateLabelStart = introEnd + 1;
    dateValueStart = introEnd + 3;
    writerLabelStart = introEnd + 5;
    writerValueStart = introEnd + 7;
  }

  const mergeOrStyle = (startCol, endCol, value, style) => {
    const start = `${numberToCol(startCol)}4`;
    const end = `${numberToCol(endCol)}4`;
    if (endCol > startCol) safeMerge(sheet, `${start}:${end}`);
    applyCellLook(sheet, start, value, style);
    for (let col = startCol; col <= endCol; col += 1) {
      sheet.getCell(4, col).style = cloneStyle(style) || {};
    }
  };

  mergeOrStyle(introStart, introEnd, '아래와 같이 비교 견적서를 제출합니다.', baseStyle);
  mergeOrStyle(dateLabelStart, dateLabelStart + 1, '견적일자', labelStyle);
  mergeOrStyle(dateValueStart, dateValueStart + 1, null, valueStyle);
  mergeOrStyle(writerLabelStart, writerLabelStart + 1, '작성자', labelStyle);
  mergeOrStyle(writerValueStart, finalCol, null, valueStyle);

  return {
    dateValueAddress: `${numberToCol(dateValueStart)}4`,
    writerValueAddress: `${numberToCol(writerValueStart)}4`,
  };
}

function replaceMergedRange(sheet, oldRange, newRange) {
  const start = String(oldRange).split(':')[0];
  const cell = sheet.getCell(start);
  const value = cell.value;
  const style = cloneStyle(cell.style) || {};
  safeUnmerge(sheet, oldRange);
  safeMerge(sheet, newRange);
  const nextStart = String(newRange).split(':')[0];
  sheet.getCell(nextStart).value = value;
  sheet.getCell(nextStart).style = style;
}

function copyColumnTemplate(sheet, sourceColNumber, targetColNumber, maxRow = 80) {
  const srcCol = sheet.getColumn(sourceColNumber);
  const dstCol = sheet.getColumn(targetColNumber);
  dstCol.width = srcCol.width;
  dstCol.hidden = false;
  for (let row = 1; row <= maxRow; row += 1) {
    const src = sheet.getCell(row, sourceColNumber);
    const dst = sheet.getCell(row, targetColNumber);
    copyCell(src, dst, { copyValue: row <= 6 || row >= 23 });
    if (row >= 7 && row <= 22) dst.value = null;
  }
}

function formatKstToday() {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}.${parts.month}.${parts.day}`;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function comparableCompanyName(value) {
  return String(value || '')
    .replace(/주식회사|\(주\)|㈜|（주）/g, '')
    .replace(/[\s._\-()（）\[\]{}·,]/g, '')
    .toLowerCase();
}

function normalizeVendorLabel(label) {
  return String(label || '')
    .replace(/\s*(단가|금액|견적가|견적단가|업체견적단가)$/g, '')
    .trim();
}

function isIgnoredVendorLabel(label) {
  const cleaned = normalizeVendorLabel(label);
  return !cleaned || /^(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출|공급|세액|금액|단가)$/.test(cleaned);
}


function isProductPriceSurveyTemplate(template = {}, mappings = []) {
  const name = String(template.template_name || template.templateName || template.name || template.title || '').replace(/[\s_\-·ㆍ()（）\[\]{}]/g, '').toLowerCase();
  const hasNameSignal = /(업체별|업체|회사별|거래처별|vendor|company|supplier)/i.test(name)
    && /(제품가격|제품단가|가격조사|조사현황|가격현황|단가조사|productprice|pricesurvey|survey)/i.test(name);
  const hasOneColumnVendorMapping = (mappings || []).some((m) =>
    m.mappingType === 'COMPANY_GROUP_COLUMN'
    && Number(m.groupWidth || 0) === 1
    && Array.isArray(m.columnLetters)
    && m.columnLetters.some((letter) => ['E', 'F', 'G', 'H', 'I'].includes(String(letter || '').toUpperCase()))
  );
  return hasNameSignal || hasOneColumnVendorMapping;
}

function getRowValueByAliases(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function getProductSurveyRowValue(row, fieldKey, index) {
  if (fieldKey === 'row_no' || fieldKey === 'no') return row.row_no || row.no || index + 1;
  if (fieldKey === 'item_name' || fieldKey === 'product_name') {
    return getRowValueByAliases(row, ['product_name', 'item_name', 'work_item_name', '공종명칭', '제품명', 'item']) || '';
  }
  if (fieldKey === 'spec' || fieldKey === 'standard') return getRowValueByAliases(row, ['spec', 'standard', 'size', '규격']) || '';
  if (fieldKey === 'unit') return getRowValueByAliases(row, ['unit', '단위']) || '';
  if (fieldKey === 'selected_vendor' || fieldKey === 'vendor_selection') {
    return getRowValueByAliases(row, ['selected_vendor', 'selected_company', 'chosen_vendor', 'lowest_vendor', 'best_vendor', 'vendor_selection', '업체선정', '최저업체']) || '';
  }
  if (fieldKey === 'remark' || fieldKey === 'note' || fieldKey === 'memo') return getRowValueByAliases(row, ['remark', 'note', 'memo', '비고']) || '';
  if (fieldKey === 'average_price' || fieldKey === 'avg_price') {
    return getRowValueByAliases(row, ['average_price', 'avg_price', 'average_unit_price', '평균가격', '평균단가']) || '';
  }
  return row[fieldKey] ?? '';
}

function normalizeRowsWithRequestedQuantity(rows = [], job = {}) {
  const requestedQuantity = extractRequestedQuantityFromText(job?.userRequest || job?.user_request || '');
  return (rows || []).map((row) => {
    if (row?.quantity || row?.request_quantity || !requestedQuantity.value) return row;
    return { ...row, quantity: requestedQuantity.value, request_quantity: requestedQuantity.value };
  });
}

function clearProductSurveyBody(sheet, startRow, endRow, startCol, endCol) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      const cell = sheet.getCell(row, col);
      // 평균가격 등 수식 영역도 새 결과 기준으로 다시 쓰기 위해 값을 비운다.
      cell.value = null;
    }
  }
}

function setCellPreserveStyle(sheet, row, col, value) {
  const cell = sheet.getCell(row, col);
  cell.value = value === undefined ? '' : value;
}

function applyProductSurveyVendorColumnVisibility(sheet, vendorCols = [], visibleVendorCount = 0, templateLayoutMode = 'PRESERVE_TEMPLATE') {
  const cols = (vendorCols || []).map((col) => Number(col)).filter(Boolean);
  if (!cols.length) return;

  const compactMode = templateLayoutMode === 'COMPACT_VENDOR_GROUPS';
  const visibleCount = compactMode
    ? Math.max(1, Math.min(Number(visibleVendorCount || 0), cols.length))
    : cols.length;

  cols.forEach((col, idx) => {
    const column = sheet.getColumn(col);
    if (compactMode && idx >= visibleCount) {
      column.hidden = true;
      column.width = 0.1;
    } else {
      column.hidden = false;
      if (!column.width || column.width < 8) column.width = 12;
    }
  });
}

function writeProductPriceSurveyExcel(sheet, { template, mappings, columns, rows, job, templateLayoutMode = 'PRESERVE_TEMPLATE' }) {
  const tableJson = job?.tables?.[0]?.tableJson || {};
  const normalizedRows = normalizeRowsWithRequestedQuantity(rows, job);
  const vendors = inferVendors(columns, normalizedRows, tableJson).filter((vendor) => vendor?.name);

  const rowMappings = (mappings || []).filter((m) => m.mappingType === 'REPEAT_ROW' || m.mappingType === 'REPEAT_COLUMN');
  const companyMappings = (mappings || []).filter((m) => m.mappingType === 'COMPANY_GROUP_COLUMN');

  const startRow = Number(rowMappings.find((m) => m.startRow)?.startRow || companyMappings.find((m) => m.startRow && m.fieldKey !== 'target_name')?.startRow || 5);
  const maxRows = Number(rowMappings.find((m) => m.maxRows)?.maxRows || companyMappings.find((m) => m.maxRows && m.fieldKey !== 'target_name')?.maxRows || 15);
  const endRow = startRow + maxRows - 1;

  const vendorNameMapping = companyMappings.find((m) => m.fieldKey === 'target_name') || {};
  const unitPriceMapping = companyMappings.find((m) => m.fieldKey === 'unit_price' || m.fieldKey === 'vendor_unit_price') || {};
  const vendorLetters = Array.isArray(unitPriceMapping.columnLetters) && unitPriceMapping.columnLetters.length
    ? unitPriceMapping.columnLetters.map((letter) => String(letter).toUpperCase())
    : (Array.isArray(vendorNameMapping.columnLetters) && vendorNameMapping.columnLetters.length
      ? vendorNameMapping.columnLetters.map((letter) => String(letter).toUpperCase())
      : ['E', 'F', 'G', 'H', 'I']);
  const vendorCols = vendorLetters.map(colToNumber).filter(Boolean);
  const maxVendorSlots = vendorCols.length || 5;
  const visibleVendors = vendors.slice(0, maxVendorSlots);
  const visibleVendorSlotCount = templateLayoutMode === 'COMPACT_VENDOR_GROUPS'
    ? Math.max(visibleVendors.length, 1)
    : maxVendorSlots;
  applyProductSurveyVendorColumnVisibility(sheet, vendorCols, visibleVendorSlotCount, templateLayoutMode);

  const avgMapping = rowMappings.find((m) => m.fieldKey === 'average_price' || m.fieldKey === 'avg_price');
  const selectedMapping = rowMappings.find((m) => m.fieldKey === 'selected_vendor' || m.fieldKey === 'vendor_selection');
  const remarkMapping = rowMappings.find((m) => m.fieldKey === 'remark' || m.fieldKey === 'note' || m.fieldKey === 'memo');

  const avgCol = colToNumber(avgMapping?.columnLetter || 'J');
  const selectedCol = colToNumber(selectedMapping?.columnLetter || 'K');
  const remarkCol = colToNumber(remarkMapping?.columnLetter || 'L');
  const lastCol = Math.max(remarkCol, selectedCol, avgCol, ...vendorCols, 12);

  // 제목은 업로드 파일명으로 덮어쓰지 않고, 조사현황표 템플릿 제목을 유지한다.
  const titleMapping = (mappings || []).find((m) => m.fieldKey === 'document_title' && (m.cellAddress || m.mergedRange));
  if (titleMapping) {
    const titleAddress = titleMapping.cellAddress || String(titleMapping.mergedRange || '').split(':')[0];
    const titleCell = sheet.getCell(titleAddress);
    if (!titleCell.value || String(titleCell.value).includes('단가비교견적서')) {
      titleCell.value = template?.template_name || template?.templateName || '업체별 제품가격 조사현황표';
    }
  }

  // 업체명 헤더 복구: 업체 1~5가 아니라 실제 업체명을 E4:I4에 쓴다.
  const headerRow = Number(vendorNameMapping.startRow || 4);
  for (let idx = 0; idx < maxVendorSlots; idx += 1) {
    const col = vendorCols[idx] || (vendorCols[0] + idx);
    setCellPreserveStyle(sheet, headerRow, col, visibleVendors[idx]?.name || '');
  }

  // 기존 데이터 영역을 새 결과 기준으로 초기화한 뒤 재입력한다.
  clearProductSurveyBody(sheet, startRow, endRow, 1, lastCol);

  for (let idx = 0; idx < maxRows; idx += 1) {
    const rowNumber = startRow + idx;
    const source = normalizedRows[idx];

    for (const mapping of rowMappings) {
      const col = colToNumber(mapping.columnLetter || String(mapping.cellAddress || '').replace(/[0-9]/g, ''));
      if (!col) continue;

      if (!source) {
        // 평균가격 수식은 비워둔다. 원본 행이 없는 곳에 자동 수식만 남기지 않는다.
        sheet.getCell(rowNumber, col).value = null;
        continue;
      }

      if (mapping.fieldKey === 'average_price' || mapping.fieldKey === 'avg_price') {
        const firstVendorCol = vendorCols[0] || 5;
        const lastVendorCol = vendorCols[Math.max(0, visibleVendors.length - 1)] || vendorCols[maxVendorSlots - 1] || 9;
        sheet.getCell(rowNumber, col).value = { formula: `IFERROR(AVERAGE(${numberToCol(firstVendorCol)}${rowNumber}:${numberToCol(lastVendorCol)}${rowNumber}),"")` };
        continue;
      }

      const value = getProductSurveyRowValue(source, mapping.fieldKey, idx);
      sheet.getCell(rowNumber, col).value = value;
    }

    if (!source) continue;

    // 필수 매핑이 빠져 있어도 조사현황표 기본 위치는 채운다.
    if (!rowMappings.some((m) => m.fieldKey === 'row_no')) setCellPreserveStyle(sheet, rowNumber, 1, idx + 1);
    if (!rowMappings.some((m) => m.fieldKey === 'item_name' || m.fieldKey === 'product_name')) setCellPreserveStyle(sheet, rowNumber, 2, getProductSurveyRowValue(source, 'item_name', idx));
    if (!rowMappings.some((m) => m.fieldKey === 'spec')) setCellPreserveStyle(sheet, rowNumber, 3, getProductSurveyRowValue(source, 'spec', idx));
    if (!rowMappings.some((m) => m.fieldKey === 'unit')) setCellPreserveStyle(sheet, rowNumber, 4, getProductSurveyRowValue(source, 'unit', idx));

    visibleVendors.forEach((vendor, vendorIndex) => {
      const col = vendorCols[vendorIndex] || (vendorCols[0] + vendorIndex);
      const price = getRowVendorValue(source, vendor, 'unit_price');
      sheet.getCell(rowNumber, col).value = price === '' ? null : toNumber(price) || price;
    });

    // 평균가격/업체선정/비고 기본 위치도 보정한다.
    if (avgCol && !rowMappings.some((m) => m.fieldKey === 'average_price' || m.fieldKey === 'avg_price')) {
      const firstVendorCol = vendorCols[0] || 5;
      const lastVendorCol = vendorCols[Math.max(0, visibleVendors.length - 1)] || vendorCols[maxVendorSlots - 1] || 9;
      sheet.getCell(rowNumber, avgCol).value = { formula: `IFERROR(AVERAGE(${numberToCol(firstVendorCol)}${rowNumber}:${numberToCol(lastVendorCol)}${rowNumber}),"")` };
    }
    if (selectedCol && !rowMappings.some((m) => m.fieldKey === 'selected_vendor' || m.fieldKey === 'vendor_selection')) {
      sheet.getCell(rowNumber, selectedCol).value = getProductSurveyRowValue(source, 'selected_vendor', idx);
    }
    if (remarkCol && !rowMappings.some((m) => m.fieldKey === 'remark' || m.fieldKey === 'note' || m.fieldKey === 'memo')) {
      sheet.getCell(rowNumber, remarkCol).value = getProductSurveyRowValue(source, 'remark', idx);
    }
  }

  return { vendorCount: visibleVendors.length, maxVendorSlots, visibleVendorSlotCount, templateLayoutMode };
}

function extractRequestedQuantityFromText(text = '') {
  const source = String(text || '');
  const patterns = [
    /각\s*(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?\s*씩?/gi,
    /(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)\s*씩/gi,
    /수량\s*[:=]?\s*(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?/gi,
    /(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)?\s*(?:기준|으로|만큼|수량)/gi,
    /(?<qty>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?<unit>개|EA|ea|㎡|m2|m²|㎥|m3|m³|톤|ton|kg|KG|대|명|식|시간|일|세트|SET)/gi,
  ];
  const isCompanyCount = (match) => {
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 12);
    const before = source.slice(Math.max(0, match.index - 8), match.index);
    return /^\s*(업체|회사|파일|문서|자료|개사)/.test(after) || /(업체|회사|파일|문서)\s*$/.test(before);
  };
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (isCompanyCount(match)) continue;
      const groups = match.groups || {};
      const value = String(groups.qty || match[1] || '').replace(/,/g, '');
      if (value) return { value, unit: groups.unit || match[2] || '' };
    }
  }
  return { value: '', unit: '' };
}

function inferVendors(columns = [], rows = [], tableJson = {}) {
  const metaVendors = Array.isArray(tableJson?.meta?.vendors) ? tableJson.meta.vendors : [];
  const metaVendorByIndex = new Map();
  metaVendors.forEach((vendor, index) => {
    const actualIndex = Number.isFinite(Number(vendor?.index)) ? Number(vendor.index) : index;
    const name = String(vendor?.name || vendor?.vendorName || vendor?.label || vendor || '').trim();
    if (name) metaVendorByIndex.set(actualIndex, vendor);
  });
  const vendorMap = new Map();

  const putVendor = (name, patch = {}) => {
    const displayName = String(name || '').trim();
    const compareKey = comparableCompanyName(displayName);
    if (!displayName || !compareKey || isIgnoredVendorLabel(displayName)) return null;
    const existing = vendorMap.get(compareKey) || { name: displayName, compareKey, index: vendorMap.size };
    const merged = { ...existing, ...patch, name: existing.name || displayName, compareKey };
    vendorMap.set(compareKey, merged);
    return merged;
  };

  metaVendors.forEach((vendor, index) => {
    const name = String(vendor?.name || vendor?.vendorName || vendor?.label || vendor || '').trim();
    putVendor(name, {
      index,
      nameKey: vendor?.nameKey,
      specKey: vendor?.specKey,
      quantityKey: vendor?.quantityKey,
      unitPriceKey: vendor?.unitPriceKey || vendor?.priceKey,
      amountKey: vendor?.amountKey,
    });
  });

  for (const col of columns || []) {
    const key = String(col.key || '');
    const label = String(col.label || key || '').trim();
    if (!label) continue;

    const dynamic = key.match(/^(?:vendor|company|target)[_\-]?(\d+)[_\-]?(name|spec|quantity|qty|unit_price|price|amount)$/i);
    if (dynamic) {
      const rawIdx = Number(dynamic[1]);
      // 동적 키는 vendor_1_unit_price처럼 1부터 시작한다. meta.vendors index는 0부터 저장한다.
      const zeroIndex = rawIdx > 0 ? rawIdx - 1 : rawIdx;
      const field = dynamic[2].toLowerCase();
      const metaVendor = metaVendorByIndex.get(zeroIndex) || metaVendorByIndex.get(rawIdx);
      const rowName = String(metaVendor?.name || metaVendor?.vendorName || metaVendor?.label || '').trim()
        || (rows || []).find((row) => row?.[`vendor_${rawIdx}_name`] || row?.[`company_${rawIdx}_name`])?.[`vendor_${rawIdx}_name`]
        || (rows || []).find((row) => row?.[`company_${rawIdx}_name`])?.[`company_${rawIdx}_name`]
        || normalizeVendorLabel(label);
      // 실제 회사명을 모르면 업체2/업체3 같은 가짜 업체명을 만들지 않는다.
      const vendor = putVendor(rowName, { index: zeroIndex });
      if (!vendor) continue;
      if (field === 'name') vendor.nameKey = key;
      if (field === 'spec') vendor.specKey = key;
      if (field === 'quantity' || field === 'qty') vendor.quantityKey = key;
      if (field === 'unit_price' || field === 'price') vendor.unitPriceKey = key;
      if (field === 'amount') vendor.amountKey = key;
      continue;
    }

    const cleanLabel = normalizeVendorLabel(label);
    const isVendorPriceColumn = /(단가|금액|견적가|견적단가)$/i.test(label) && !isIgnoredVendorLabel(label);
    if (isVendorPriceColumn && cleanLabel) {
      const vendor = putVendor(cleanLabel);
      if (!vendor) continue;
      if (/금액$/.test(label)) vendor.amountKey = key;
      else vendor.unitPriceKey = key;
    }
  }

  for (const vendor of vendorMap.values()) {
    const compareKey = vendor.compareKey || comparableCompanyName(vendor.name);
    const matchedCol = (columns || []).find((col) => comparableCompanyName(col.label || '').includes(compareKey) && /(단가|견적|가격)/.test(String(col.label || '')));
    if (matchedCol && !vendor.unitPriceKey) vendor.unitPriceKey = matchedCol.key;
    const matchedAmountCol = (columns || []).find((col) => comparableCompanyName(col.label || '').includes(compareKey) && /금액/.test(String(col.label || '')));
    if (matchedAmountCol && !vendor.amountKey) vendor.amountKey = matchedAmountCol.key;
  }

  if (!vendorMap.size) {
    const names = [...new Set((rows || []).map((row) => String(row.vendor_name || row.target_name || '').trim()).filter(Boolean))];
    names.forEach((name, index) => putVendor(name, { index, unitPriceKey: 'vendor_unit_price', amountKey: 'amount' }));
  }

  return Array.from(vendorMap.values()).sort((a, b) => Number(a.index ?? 999) - Number(b.index ?? 999)).map((vendor, index) => ({ ...vendor, index }));
}

function getRowVendorValue(row, vendor, fieldKey, fallback = {}) {
  if (!row) return '';
  const priceMap = row.vendor_prices || row.vendorPrices || row.vendor_unit_prices || row.vendorUnitPrices;
  const amountMap = row.vendor_amounts || row.vendorAmounts;
  const nameMatches = (row.vendor_name && comparableCompanyName(row.vendor_name) === comparableCompanyName(vendor.name))
    || (row.target_name && comparableCompanyName(row.target_name) === comparableCompanyName(vendor.name));

  if (fieldKey === 'target_name') return vendor.name;
  if (fieldKey === 'spec') return row[vendor.specKey] || row.spec || '';
  if (fieldKey === 'quantity') return row[vendor.quantityKey] || row.quantity || row.request_quantity || row.requested_quantity || fallback.quantity || '';
  if (fieldKey === 'unit') return row.unit || '';
  if (fieldKey === 'unit_price') {
    if (vendor.unitPriceKey && row[vendor.unitPriceKey] !== undefined && row[vendor.unitPriceKey] !== '') return row[vendor.unitPriceKey];
    if (priceMap && typeof priceMap === 'object') {
      const direct = priceMap[vendor.name];
      if (direct !== undefined && direct !== '') return direct;
      const matched = Object.entries(priceMap).find(([name]) => comparableCompanyName(name) === comparableCompanyName(vendor.name));
      if (matched) return matched[1];
    }
    if (nameMatches) return row.vendor_unit_price || row.unit_price || '';
    return row.vendor_unit_price && !row.vendor_name ? row.vendor_unit_price : (row.unit_price && !row.vendor_name ? row.unit_price : '');
  }
  if (fieldKey === 'amount') {
    if (vendor.amountKey && row[vendor.amountKey] !== undefined && row[vendor.amountKey] !== '') return row[vendor.amountKey];
    if (amountMap && typeof amountMap === 'object') {
      const direct = amountMap[vendor.name];
      if (direct !== undefined && direct !== '') return direct;
      const matched = Object.entries(amountMap).find(([name]) => comparableCompanyName(name) === comparableCompanyName(vendor.name));
      if (matched) return matched[1];
    }
    const existing = row.amount && nameMatches ? row.amount : '';
    if (existing) return existing;
    const qty = toNumber(getRowVendorValue(row, vendor, 'quantity', fallback));
    const price = toNumber(getRowVendorValue(row, vendor, 'unit_price', fallback));
    return qty && price ? qty * price : '';
  }
  if (fieldKey === 'total_amount') return '';
  return row[fieldKey] ?? '';
}

function getSingleValue(fieldKey, { job, rows, authorName }) {
  const first = rows?.[0] || {};
  if (fieldKey === 'document_title') return job?.title || '비교 견적서';
  if (fieldKey === 'document_date') return formatKstToday();
  if (fieldKey === 'requester_name' || fieldKey === 'writer_name' || fieldKey === 'created_by') return authorName || '';
  if (fieldKey === 'special_note') return first.special_note || first.remark || '';
  if (fieldKey === 'final_opinion') return first.final_opinion || '';
  if (fieldKey === 'total_amount') {
    const total = (rows || []).reduce((sum, row) => sum + toNumber(row.amount), 0);
    return total || '';
  }
  return first[fieldKey] ?? '';
}

function writeCell(sheet, address, value) {
  if (!address) return;
  const cell = sheet.getCell(address);
  cell.value = value === undefined ? '' : value;
}

function clearCell(sheet, row, col) {
  sheet.getCell(row, col).value = null;
}


function compactHeaderForTwoVendors(sheet) {
  return normalizeHeaderRow(sheet, 10);
}

function setupDynamicVendorGroups(sheet, vendorCount, groupWidth = 4, options = {}) {
  const preserveTemplateLayout = options.preserveTemplateLayout !== false;
  const baseStartCols = [3, 7, 11]; // C/G/K
  const sourceGroupStart = 11; // K:N template group
  const maxRowsToCopy = Math.max(sheet.rowCount || 30, 80);

  // If there are more than three companies, create additional 4-column groups to the right.
  for (let groupIndex = 3; groupIndex < vendorCount; groupIndex += 1) {
    const targetStart = baseStartCols[0] + groupIndex * groupWidth;
    for (let offset = 0; offset < groupWidth; offset += 1) {
      copyColumnTemplate(sheet, sourceGroupStart + offset, targetStart + offset, maxRowsToCopy);
    }
    safeMerge(sheet, `${numberToCol(targetStart)}5:${numberToCol(targetStart + groupWidth - 1)}5`);
  }

  const visibleGroupCount = preserveTemplateLayout ? Math.max(3, vendorCount || 1) : Math.max(1, vendorCount || 1);
  const lastVisibleCol = 2 + visibleGroupCount * groupWidth;
  const lastVisibleLetter = numberToCol(lastVisibleCol);

  if (preserveTemplateLayout) {
    // 원본 비교견적서 양식은 A:N, A/B/C 업체 3구역이 기본이다.
    // 자사양식 모드에서는 기본 병합/테두리/폭을 유지하고, 업체가 4개 이상일 때만 오른쪽으로 확장한다.
    for (let col = 1; col <= Math.max(14, lastVisibleCol); col += 1) {
      sheet.getColumn(col).hidden = false;
    }
    if (visibleGroupCount > 3) {
      replaceMergedRange(sheet, 'A2:N2', `A2:${lastVisibleLetter}2`);
      replaceMergedRange(sheet, 'C24:N25', `C24:${lastVisibleLetter}25`);
      replaceMergedRange(sheet, 'C27:N27', `C27:${lastVisibleLetter}27`);
    }
  } else {
    // compact 모드: 실제 업체 수만 남기고 빈 업체 구역은 숨김.
    for (let col = lastVisibleCol + 1; col <= 14; col += 1) {
      sheet.getColumn(col).hidden = true;
    }
    replaceMergedRange(sheet, 'A2:N2', `A2:${lastVisibleLetter}2`);
    replaceMergedRange(sheet, 'C24:N25', `C24:${lastVisibleLetter}25`);
    replaceMergedRange(sheet, 'C27:N27', `C27:${lastVisibleLetter}27`);
  }

  const headerCells = normalizeHeaderRow(sheet, lastVisibleCol);

  return { lastVisibleCol, lastVisibleLetter, visibleGroupCount, preserveTemplateLayout, ...headerCells };
}

function writeVendorHeaderGroups(sheet, vendors, visibleGroupCount, groupWidth, targetNameMapping) {
  // 원본 양식의 기본 헤더가 '표준시장', '업체2'처럼 남지 않도록
  // 화면/다운로드에 표시되는 모든 업체 그룹명을 실제 회사명으로 다시 쓴다.
  const count = Math.max(Number(visibleGroupCount || 0), vendors.length || 0, 1);
  for (let vendorIndex = 0; vendorIndex < count; vendorIndex += 1) {
    const groupStart = 3 + vendorIndex * groupWidth;
    const groupEnd = groupStart + groupWidth - 1;
    const range = targetNameMapping?.groupRanges?.[vendorIndex] || `${numberToCol(groupStart)}5:${numberToCol(groupEnd)}5`;
    try { safeUnmerge(sheet, range); } catch (_) {}
    safeMerge(sheet, range);
    const cellAddress = range.split(':')[0];
    writeCell(sheet, cellAddress, vendors[vendorIndex]?.name || '');
  }
}

async function createMappedTemplateExcel({ jobId, fileName, template, mappings, columns, rows, job, authorName, templateLayoutMode = 'PRESERVE_TEMPLATE' }) {
  if (!template?.file_path && !template?.filePath) throw new Error('자사 양식 파일 경로가 없습니다.');
  const templatePath = resolveTemplatePath(template.file_path || template.filePath);
  const { safeName, filePath } = getResultPath(jobId, fileName || `${template.template_name || template.templateName || '자사양식'}_${jobId}.xlsx`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const mappingList = Array.isArray(mappings) ? mappings : [];
  const sheetName = mappingList.find((m) => m.sheetName)?.sheetName || template.default_sheet_name || workbook.worksheets[0]?.name;
  const sheet = sheetName ? workbook.getWorksheet(sheetName) || workbook.worksheets[0] : workbook.worksheets[0];
  if (!sheet) throw new Error('자사 양식 시트를 찾을 수 없습니다.');

  if (isProductPriceSurveyTemplate(template, mappingList)) {
    const productResult = writeProductPriceSurveyExcel(sheet, {
      template,
      mappings: mappingList,
      columns,
      rows,
      job,
      templateLayoutMode: templateLayoutMode || 'COMPACT_VENDOR_GROUPS'
    });
    workbook.creator = 'AI 업무문서 자동화 시스템';
    await workbook.xlsx.writeFile(filePath);
    return { fileName: safeName, filePath, templateApplied: true, vendorCount: productResult.vendorCount, templateKind: 'PRODUCT_PRICE_SURVEY' };
  }

  const tableJson = job?.tables?.[0]?.tableJson || {};
  const requestedQuantity = extractRequestedQuantityFromText(job?.userRequest || job?.user_request || '');
  const normalizedRows = (rows || []).map((row) => (row?.quantity || row?.request_quantity || !requestedQuantity.value ? row : { ...row, quantity: requestedQuantity.value, request_quantity: requestedQuantity.value }));
  const vendors = inferVendors(columns, normalizedRows, tableJson);
  const groupWidth = Number(mappingList.find((m) => m.mappingType === 'COMPANY_GROUP_COLUMN' && m.groupWidth)?.groupWidth || 4);
  const dynamicLayout = setupDynamicVendorGroups(sheet, Math.max(vendors.length, 1), groupWidth, { preserveTemplateLayout: templateLayoutMode !== 'COMPACT_VENDOR_GROUPS' });

  const rowMappings = mappingList.filter((m) => m.mappingType === 'REPEAT_ROW' || m.mappingType === 'REPEAT_COLUMN');
  const companyMappings = mappingList.filter((m) => m.mappingType === 'COMPANY_GROUP_COLUMN');
  const singleMappings = mappingList.filter((m) => m.mappingType === 'SINGLE_CELL');

  for (const mapping of singleMappings) {
    let address = mapping.cellAddress || String(mapping.mergedRange || '').split(':')[0];
    if (mapping.fieldKey === 'document_date') address = dynamicLayout.dateValueAddress || address;
    if (mapping.fieldKey === 'requester_name' || mapping.fieldKey === 'writer_name' || mapping.fieldKey === 'created_by') address = dynamicLayout.writerValueAddress || address;
    if (!address) continue;
    writeCell(sheet, address, getSingleValue(mapping.fieldKey, { job, rows, authorName }));
  }
  // 매핑이 누락되었거나 기존 M4/N4에 쓰도록 남아 있어도, 최종 헤더는 끝 1곳으로 고정한다.
  writeCell(sheet, dynamicLayout.dateValueAddress, formatKstToday());
  writeCell(sheet, dynamicLayout.writerValueAddress, authorName || '');

  for (const mapping of rowMappings) {
    const colLetter = mapping.columnLetter || String(mapping.cellAddress || '').replace(/[0-9]/g, '');
    if (!colLetter) continue;
    const colNum = colToNumber(colLetter);
    const startRow = Number(mapping.startRow || parseA1(mapping.cellAddress)?.row || 7);
    const maxRows = Number(mapping.maxRows || ((mapping.endRow || 22) - startRow + 1) || normalizedRows.length);
    for (let idx = 0; idx < maxRows; idx += 1) {
      const rowNum = startRow + idx;
      const source = normalizedRows[idx];
      if (!source) {
        clearCell(sheet, rowNum, colNum);
        continue;
      }
      const value = mapping.fieldKey === 'row_no' ? idx + 1 : (source[mapping.fieldKey] ?? '');
      sheet.getCell(rowNum, colNum).value = value;
    }
  }

  const targetNameMapping = companyMappings.find((m) => m.fieldKey === 'target_name');
  writeVendorHeaderGroups(sheet, vendors, dynamicLayout.visibleGroupCount, groupWidth, targetNameMapping);

  const rowStart = Number(companyMappings.find((m) => m.startRow && m.fieldKey !== 'target_name')?.startRow || 7);
  const rowMax = Number(companyMappings.find((m) => m.maxRows && m.fieldKey !== 'target_name')?.maxRows || Math.max(normalizedRows.length, 16));
  for (const mapping of companyMappings.filter((m) => m.fieldKey !== 'target_name' && m.fieldKey !== 'total_amount')) {
    vendors.forEach((vendor, vendorIndex) => {
      const colLetter = mapping.columnLetters?.[vendorIndex] || numberToCol(colToNumber(mapping.columnLetters?.[0] || 'C') + vendorIndex * groupWidth);
      const colNum = colToNumber(colLetter);
      for (let idx = 0; idx < rowMax; idx += 1) {
        const rowNum = rowStart + idx;
        const source = normalizedRows[idx];
        sheet.getCell(rowNum, colNum).value = source ? getRowVendorValue(source, vendor, mapping.fieldKey, { quantity: requestedQuantity.value }) : null;
      }
    });
  }

  for (const mapping of companyMappings.filter((m) => m.fieldKey === 'total_amount')) {
    vendors.forEach((vendor, vendorIndex) => {
      const colLetter = mapping.columnLetters?.[vendorIndex] || numberToCol(colToNumber(mapping.columnLetters?.[0] || 'F') + vendorIndex * groupWidth);
      const rowNum = Number(mapping.startRow || 23);
      let total = 0;
      for (const row of normalizedRows || []) total += toNumber(getRowVendorValue(row, vendor, 'amount', { quantity: requestedQuantity.value }));
      sheet.getCell(rowNum, colToNumber(colLetter)).value = total || '';
    });
  }

  workbook.creator = 'AI 업무문서 자동화 시스템';
  await workbook.xlsx.writeFile(filePath);
  return { fileName: safeName, filePath, templateApplied: true, vendorCount: vendors.length };
}

module.exports = { createExcelFile, createMappedTemplateExcel, inferVendors };
