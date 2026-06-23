const path = require('path');
const { generateExcelWithAiServer } = require('./aiServerService');

function normalizeVendorLabel(label) {
  return String(label || '')
    .replace(/\s*(단가|금액|견적가|견적단가|업체견적단가|가격)$/g, '')
    .trim();
}

function comparableCompanyName(value) {
  return String(value || '')
    .replace(/주식회사|\(주\)|㈜|（주）/g, '')
    .replace(/[\s._\-()（）\[\]{}·,]/g, '')
    .toLowerCase();
}

function isIgnoredVendorLabel(label) {
  const cleaned = normalizeVendorLabel(label);
  return !cleaned || /^(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출|공급|세액|금액|단가|수량|규격|품명|항목)$/.test(cleaned);
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
      const rawIdx = Number(dynamic[1]);
      const zeroIndex = rawIdx > 0 ? rawIdx - 1 : rawIdx;
      const field = dynamic[2].toLowerCase();
      const rowName = (rows || []).find((row) => row?.[`vendor_${rawIdx}_name`] || row?.[`company_${rawIdx}_name`])?.[`vendor_${rawIdx}_name`]
        || (rows || []).find((row) => row?.[`company_${rawIdx}_name`])?.[`company_${rawIdx}_name`]
        || normalizeVendorLabel(label);
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
    if (/(단가|금액|견적가|견적단가|가격)$/i.test(label) && cleanLabel && !isIgnoredVendorLabel(cleanLabel)) {
      const vendor = putVendor(cleanLabel);
      if (!vendor) continue;
      if (/금액$/.test(label)) vendor.amountKey = key;
      else vendor.unitPriceKey = key;
    }
  }

  if (!vendorMap.size) {
    const names = [...new Set((rows || []).map((row) => String(row.vendor_name || row.target_name || row.company_name || '').trim()).filter(Boolean))];
    names.forEach((name, index) => putVendor(name, { index, unitPriceKey: 'vendor_unit_price', amountKey: 'amount' }));
  }

  return Array.from(vendorMap.values()).sort((a, b) => Number(a.index ?? 999) - Number(b.index ?? 999)).map((vendor, index) => ({ ...vendor, index }));
}

function sanitizeExcelName(fileName, fallback) {
  const safeName = String(fileName || fallback || 'document_result.xlsx').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document_result.xlsx';
  return safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`;
}

async function createExcelFile({ jobId, fileName, columns, rows, job = {}, authorName = '', mappingJson = null, designId = null }) {
  const safeName = sanitizeExcelName(fileName, `document_job_${jobId}.xlsx`);
  const result = await generateExcelWithAiServer({
    jobId,
    fileName: safeName,
    outputMode: 'FREE_FORM',
    template: null,
    mappings: [],
    mappingJson: mappingJson || {},
    columns: columns || [],
    rows: rows || [],
    job: job || {},
    authorName,
    designId,
  });
  return {
    fileName: result.file_name || result.fileName || safeName,
    filePath: result.file_path || result.filePath,
    preview: result.preview || null,
    templateKind: result.template_kind || result.templateKind || 'FREE_FORM',
  };
}

async function createMappedTemplateExcel({ jobId, fileName, template, mappings, mappingJson = null, columns, rows, job, authorName, templateLayoutMode = 'COMPACT_VENDOR_GROUPS' }) {
  const safeName = sanitizeExcelName(fileName, `${template?.template_name || template?.templateName || '등록양식'}_${jobId}.xlsx`);
  const normalizedTemplate = template ? {
    ...template,
    id: template.id,
    templateName: template.templateName || template.template_name,
    template_name: template.template_name || template.templateName,
    templateType: template.templateType || template.template_type,
    template_type: template.template_type || template.templateType,
    filePath: template.filePath || template.file_path,
    file_path: template.file_path || template.filePath,
    defaultSheetName: template.defaultSheetName || template.default_sheet_name,
    default_sheet_name: template.default_sheet_name || template.defaultSheetName,
  } : null;
  const result = await generateExcelWithAiServer({
    jobId,
    fileName: safeName,
    outputMode: 'COMPANY_TEMPLATE',
    template: normalizedTemplate,
    mappings: mappings || [],
    mappingJson: mappingJson || {},
    columns: columns || [],
    rows: rows || [],
    job: job || {},
    authorName,
    templateLayoutMode,
  });
  if (!result?.file_path && !result?.filePath) throw new Error('AI 서버가 생성 엑셀 파일 경로를 반환하지 않았습니다.');
  return {
    fileName: result.file_name || result.fileName || safeName,
    filePath: result.file_path || result.filePath,
    templateApplied: true,
    vendorCount: result.vendor_count || result.vendorCount || 0,
    templateKind: result.template_kind || result.templateKind || normalizedTemplate?.template_type || 'COMPANY_TEMPLATE',
  };
}

module.exports = { createExcelFile, createMappedTemplateExcel, inferVendors };
