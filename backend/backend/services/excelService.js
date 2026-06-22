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
      const idx = Number(dynamic[1]);
      const field = dynamic[2].toLowerCase();
      const rowName = (rows || []).find((row) => row?.[`vendor_${idx}_name`] || row?.[`company_${idx}_name`])?.[`vendor_${idx}_name`]
        || (rows || []).find((row) => row?.[`company_${idx}_name`])?.[`company_${idx}_name`]
        || normalizeVendorLabel(label)
        || `업체${idx + 1}`;
      const vendor = putVendor(rowName, { index: idx });
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
  const oldRanges = ['A4:F4', 'G4:H4', 'I4:J4', 'K4:L4', 'M4:N4'];
  oldRanges.forEach((range) => safeUnmerge(sheet, range));
  const baseStyle = cloneStyle(sheet.getCell('A4').style) || {};
  const labelStyle = cloneStyle(sheet.getCell('G4').style) || baseStyle;
  const valueStyle = cloneStyle(sheet.getCell('I4').style) || baseStyle;

  safeMerge(sheet, 'A4:D4');
  safeMerge(sheet, 'E4:F4');
  safeMerge(sheet, 'G4:H4');
  sheet.getCell('A4').value = '아래와 같이 비교 견적서를 제출합니다.';
  sheet.getCell('A4').style = baseStyle;
  sheet.getCell('E4').value = '견적일자';
  sheet.getCell('E4').style = labelStyle;
  sheet.getCell('G4').style = valueStyle;
  sheet.getCell('I4').value = '작성자';
  sheet.getCell('I4').style = labelStyle;
  sheet.getCell('J4').style = valueStyle;
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
    if (visibleGroupCount === 2) {
      compactHeaderForTwoVendors(sheet);
    }
  }

  return { lastVisibleCol, lastVisibleLetter, visibleGroupCount, preserveTemplateLayout };
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
    if (dynamicLayout.visibleGroupCount === 2 && mapping.fieldKey === 'document_date') address = 'G4';
    if (dynamicLayout.visibleGroupCount === 2 && (mapping.fieldKey === 'requester_name' || mapping.fieldKey === 'writer_name' || mapping.fieldKey === 'created_by')) address = 'J4';
    if (!address) continue;
    writeCell(sheet, address, getSingleValue(mapping.fieldKey, { job, rows, authorName }));
  }

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
  vendors.forEach((vendor, vendorIndex) => {
    const groupStart = 3 + vendorIndex * groupWidth;
    const groupEnd = groupStart + groupWidth - 1;
    if (targetNameMapping) {
      const range = targetNameMapping.groupRanges?.[vendorIndex] || `${numberToCol(groupStart)}5:${numberToCol(groupEnd)}5`;
      safeMerge(sheet, range);
      writeCell(sheet, range.split(':')[0], vendor.name);
    }
  });

  // 원본 양식 유지 모드에서 업체가 2개 이하이면 남은 기본 업체명만 비워서 원본 격자는 유지한다.
  if (dynamicLayout.preserveTemplateLayout && vendors.length < 3 && targetNameMapping) {
    for (let vendorIndex = vendors.length; vendorIndex < 3; vendorIndex += 1) {
      const groupStart = 3 + vendorIndex * groupWidth;
      const groupEnd = groupStart + groupWidth - 1;
      const range = targetNameMapping.groupRanges?.[vendorIndex] || `${numberToCol(groupStart)}5:${numberToCol(groupEnd)}5`;
      try { safeMerge(sheet, range); } catch (_) {}
      writeCell(sheet, range.split(':')[0], '');
    }
  }

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
