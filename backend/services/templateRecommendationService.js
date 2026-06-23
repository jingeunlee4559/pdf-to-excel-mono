const fs = require('fs');
const path = require('path');
const {
  Counter,
  StandardField,
  ExcelTemplate,
  ExcelTemplateMapping,
  DocumentTemplateRecommendation,
} = require('../models');
const { designTemplateWithAiServer, createTemplateSkeletonWithAiServer } = require('./aiServerService');
const { inferVendors } = require('./excelService');
const { ensureTemplateMappingJson } = require('../utils/templateAutoMapping');
const { buildLayoutCandidates, normalizeLayoutForRenderer } = require('./layoutRegistry');

const SYSTEM_SEED_TEMPLATE_CODES = ['NORMAL_TABLE_V1', 'COMPARISON_MATRIX_V1', 'WORK_LOG_TABLE_V1', 'ESTIMATE_FORM_V1', 'UNIT_PRICE_TABLE_V1', 'BUSINESS_REPORT_V1', 'MEETING_MINUTES_V1', 'OFFICIAL_LETTER_V1'];
const AI_TEMPLATE_DIR = path.join(__dirname, '..', 'storage', 'templates', 'ai_generated');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function nextSeq(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return counter.seq;
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/[\s_\-·ㆍ()（）\[\]{}]/g, '')
    .toLowerCase();
}

function compactFieldKey(value = '') {
  return String(value || '').trim();
}

function toCamelTemplate(row, mappingJson = null) {
  return {
    id: row.id,
    templateId: row.id,
    createdBy: row.created_by,
    templateName: row.template_name,
    templateCode: row.template_code,
    templateType: row.template_type,
    originalFileName: row.original_file_name,
    filePath: row.file_path,
    defaultSheetName: row.default_sheet_name,
    description: row.description,
    activeYn: row.active_yn,
    mapping: mappingJson || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMappingJson(value) {
  if (!value) return { mappings: [] };
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return { mappings: [] }; }
  }
  if (typeof value === 'object') return value;
  return { mappings: [] };
}

function getMappingFieldKeys(mappingJson = {}) {
  const keys = new Set();
  const mappings = Array.isArray(mappingJson.mappings) ? mappingJson.mappings : [];
  mappings.forEach((mapping) => {
    if (mapping?.fieldKey) keys.add(compactFieldKey(mapping.fieldKey));
    if (Array.isArray(mapping?.fields)) mapping.fields.forEach((field) => keys.add(compactFieldKey(field)));
  });
  ['headerFields', 'baseColumns', 'summaryColumns'].forEach((section) => {
    (mappingJson[section] || []).forEach((item) => item?.fieldKey && keys.add(compactFieldKey(item.fieldKey)));
  });
  (mappingJson.repeatGroups || []).forEach((group) => {
    (group.columns || []).forEach((item) => item?.fieldKey && keys.add(compactFieldKey(item.fieldKey)));
  });
  return [...keys].filter(Boolean);
}

function isUserCompanyTemplateRecord(template = {}, mappingJson = {}) {
  const code = String(template.template_code || '').toUpperCase();
  if (SYSTEM_SEED_TEMPLATE_CODES.includes(code)) return false;
  if (code.startsWith('AI_')) return false;
  if (mappingJson?.locked || mappingJson?.aiGenerated) return false;
  return true;
}

function getTableFieldKeys(job = {}) {
  const table = (job.tables || [])[0] || {};
  const keys = new Set();
  (table.columns || []).forEach((col) => col?.key && keys.add(compactFieldKey(col.key)));
  (table.rows || []).slice(0, 30).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (String(row[key] ?? '').trim() !== '') keys.add(compactFieldKey(key));
    });
  });
  return [...keys].filter(Boolean);
}

function inferWantedTemplateType(job = {}) {
  const tableType = String(job.tables?.[0]?.tableType || job.tables?.[0]?.table_type || job.analysis?.recommendedTableType || job.analysis?.documentType || '').toUpperCase();
  const request = String(`${job.userRequest || job.user_request || ''} ${job.analysis?.purpose || ''} ${job.analysis?.summary || ''}`);
  if (tableType === 'TEXT_VENDOR_COMPARISON_REPORT') return 'REPORT';
  if (tableType === 'MULTI_VENDOR_PRICE_COMPARISON' || /(업체별|회사별|비교견적|견적비교|견적서|단가비교|가격비교|최저가|비교표)/i.test(request)) return 'MULTI_VENDOR_PRICE_COMPARISON';
  if (tableType === 'STANDARD_MARKET_PRICE_TABLE' || /(단가표|표준시장단가|표준단가|공종단가|가격표)/i.test(request)) return 'UNIT_PRICE_TABLE';
  if (/(회의록|회의|안건|참석자|결정사항|조치사항)/i.test(request) || tableType.includes('MEETING')) return 'MEETING_MINUTES';
  if (/(공문|수신|참조|시행|발신|공문서)/i.test(request) || tableType.includes('OFFICIAL')) return 'OFFICIAL_LETTER';
  if (/(보고서|보고|검토|현황|요약|분석)/i.test(request) || tableType.includes('REPORT')) return 'REPORT';
  if (tableType === 'WORK_LOG_TABLE' || /(작업일보|작업내용|투입인원|장비)/i.test(request)) return 'WORK_LOG_TABLE';
  return tableType || 'NORMAL_TABLE';
}

function templateTypeAffinity(wantedType, templateType = '', text = '') {
  const wanted = String(wantedType || '').toUpperCase();
  const actual = String(templateType || '').toUpperCase();
  const hay = normalizeText(`${templateType} ${text}`);
  if (wanted && actual === wanted) return 35;
  if (wanted === 'MULTI_VENDOR_PRICE_COMPARISON') {
    if (['COMPARISON_MATRIX', 'PRICE_COMPARISON', 'MULTI_VENDOR_PRICE_COMPARISON'].includes(actual)) return 35;
    if (/(비교|견적|업체별|회사별|단가|가격|조사현황|comparison|vendor|price|survey)/i.test(hay)) return 30;
  }
  if (wanted === 'STANDARD_MARKET_PRICE_TABLE') {
    if (/(표준시장|표준단가|공종|market|standard)/i.test(hay)) return 30;
  }
  if (wanted === 'UNIT_PRICE_TABLE') {
    if (/(단가표|단가|표준시장|가격표|unitprice|price)/i.test(hay)) return 30;
  }
  if (wanted === 'REPORT') {
    if (/(보고서|보고|현황|검토|요약|report)/i.test(hay)) return 30;
  }
  if (wanted === 'MEETING_MINUTES') {
    if (/(회의록|회의|안건|참석|minutes|meeting)/i.test(hay)) return 30;
  }
  if (wanted === 'OFFICIAL_LETTER') {
    if (/(공문|수신|참조|시행|official|letter)/i.test(hay)) return 30;
  }
  if (wanted === 'WORK_LOG_TABLE') {
    if (/(작업일보|작업|인원|장비|worklog)/i.test(hay)) return 30;
  }
  if (wanted === 'NORMAL_TABLE' && /(내역|일반|표|normal|table)/i.test(hay)) return 18;
  return 0;
}

function hasDynamicVendorSupport(mappingJson = {}, template = {}) {
  const mappings = Array.isArray(mappingJson.mappings) ? mappingJson.mappings : [];
  const text = normalizeText(`${template.template_name} ${template.template_code} ${template.template_type} ${template.description}`);
  if (String(mappingJson.layout || '').includes('DYNAMIC_VENDOR')) return true;
  if ((mappingJson.repeatGroups || []).some((group) => String(group.repeatBy || group.groupKey || '').toLowerCase().includes('vendor'))) return true;
  if (mappings.some((m) => ['COMPANY_GROUP_COLUMN', 'REPEAT_COLUMN'].includes(String(m.mappingType || '').toUpperCase()))) return true;
  return /(업체별|회사별|비교견적|비교표|가격조사|조사현황|comparison|vendor|supplier)/i.test(text);
}

function buildReasonSummary({ score, typeScore, fieldScore, dynamicScore, keywordScore, mappedCount, tableFieldCount, wantedType }) {
  const reasons = [];
  if (typeScore > 0) reasons.push(`문서/표 유형이 ${wantedType} 계열과 일치합니다.`);
  if (fieldScore > 0) reasons.push(`표준필드 매핑 일치 ${mappedCount}/${Math.max(tableFieldCount, 1)}개를 확인했습니다.`);
  if (dynamicScore > 0) reasons.push('업체 수가 늘어나는 동적 반복 컬럼을 지원합니다.');
  if (keywordScore > 0) reasons.push('사용자 요청/양식명 키워드가 일치합니다.');
  if (!reasons.length) reasons.push('일부 표준필드가 일치하지만 적용 전 매핑 확인이 필요합니다.');
  if (score < 70) reasons.push('적합도가 낮으므로 AI 새 양식 생성을 권장합니다.');
  return reasons;
}

async function listTemplatesWithMappings() {
  const templates = await ExcelTemplate.find({ active_yn: 'Y', template_code: { $nin: SYSTEM_SEED_TEMPLATE_CODES } }).sort({ created_at: -1, id: -1 }).lean();
  const templateIds = templates.map((item) => item.id);
  const mappings = await ExcelTemplateMapping.find({ template_id: { $in: templateIds }, active_yn: 'Y' }).sort({ id: -1 }).lean();
  const mappingMap = new Map();
  mappings.forEach((mapping) => {
    if (!mappingMap.has(mapping.template_id)) mappingMap.set(mapping.template_id, mapping);
  });
  return templates.map((template) => {
    const mappingRow = mappingMap.get(template.id);
    const mappingJson = normalizeMappingJson(mappingRow?.mapping_json);
    return { template, mappingRow, mappingJson };
  }).filter(({ template, mappingJson }) => isUserCompanyTemplateRecord(template, mappingJson));
}

async function getTemplateRecommendationsForJob(job = {}) {
  if (!job?.id) return [];
  const tableFields = getTableFieldKeys(job);
  const tableFieldSet = new Set(tableFields);
  const wantedType = inferWantedTemplateType(job);
  const requestText = `${job.userRequest || ''} ${job.analysis?.summary || ''} ${job.analysis?.purpose || ''}`;
  const templates = await listTemplatesWithMappings();

  const recommendations = templates.map(({ template, mappingJson }) => {
    const templateText = `${template.template_name || ''} ${template.template_code || ''} ${template.template_type || ''} ${template.description || ''} ${template.original_file_name || ''}`;
    const mappedKeys = getMappingFieldKeys(mappingJson);
    const matchedFields = mappedKeys.filter((key) => tableFieldSet.has(key));
    const missingFields = tableFields.filter((key) => !mappedKeys.includes(key));
    const typeScore = templateTypeAffinity(wantedType, template.template_type, templateText);
    const fieldScore = tableFields.length ? Math.min(25, Math.round((matchedFields.length / tableFields.length) * 25)) : 0;
    const dynamicScore = wantedType === 'MULTI_VENDOR_PRICE_COMPARISON' && hasDynamicVendorSupport(mappingJson, template) ? 20 : 0;
    const keywordScore = /(비교|견적|업체|단가|가격|현황|작업|일보|표준)/i.test(`${requestText} ${templateText}`) ? 10 : 0;
    const mappingScore = mappedKeys.length ? 10 : 0;
    const score = Math.min(100, typeScore + fieldScore + dynamicScore + keywordScore + mappingScore);
    const reasons = buildReasonSummary({ score, typeScore, fieldScore, dynamicScore, keywordScore, mappedCount: matchedFields.length, tableFieldCount: tableFields.length, wantedType });

    return {
      id: template.id,
      templateId: template.id,
      templateName: template.template_name,
      templateCode: template.template_code,
      templateType: template.template_type,
      score,
      rank: 0,
      reasons,
      matchedFields,
      missingFields: missingFields.slice(0, 12),
      dynamicVendorSupport: hasDynamicVendorSupport(mappingJson, template),
      recommendationType: 'EXISTING_TEMPLATE',
      template: toCamelTemplate(template, mappingJson),
    };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return recommendations;
}

async function saveRecommendationHistory(jobId, recommendations = []) {
  if (!jobId) return;
  await DocumentTemplateRecommendation.deleteMany({ job_id: Number(jobId), recommendation_type: 'EXISTING_TEMPLATE' });
  for (const item of recommendations.slice(0, 5)) {
    await DocumentTemplateRecommendation.create({
      id: await nextSeq('document_template_recommendations'),
      job_id: Number(jobId),
      template_id: item.templateId || null,
      recommendation_type: item.recommendationType || 'EXISTING_TEMPLATE',
      template_name: item.templateName || null,
      template_type: item.templateType || null,
      score: Number(item.score || 0),
      rank: Number(item.rank || 0),
      reason_json: item.reasons || [],
      matched_fields_json: item.matchedFields || [],
      missing_fields_json: item.missingFields || [],
      design_json: item.design || null,
      status: 'RECOMMENDED',
      applied_yn: 'N',
    });
  }
}

function pickStandardField(standardFields, key, label = null) {
  const found = standardFields.find((field) => field.field_key === key);
  return { fieldKey: key, label: label || found?.field_label || key };
}

function pickExistingColumnsFromTable(table = {}, standardFields = [], preferredKeys = []) {
  const allowed = new Set(standardFields.map((field) => field.field_key));
  const tableColumns = Array.isArray(table.columns) ? table.columns : [];
  const picked = [];
  const push = (key, label = null) => {
    if (!allowed.has(key)) return;
    if (picked.some((item) => item.fieldKey === key)) return;
    const tableCol = tableColumns.find((col) => col.key === key);
    picked.push(pickStandardField(standardFields, key, label || tableCol?.label));
  };
  preferredKeys.forEach((key) => push(key));
  tableColumns.forEach((col) => push(col.key, col.label));
  return picked;
}

function fallbackTemplateDesign({ job = {}, table = {}, standardFields = [] }) {
  const wantedType = inferWantedTemplateType(job);
  const registryCandidate = buildLayoutCandidates({ analysis: job.analysis || {}, table, userRequest: job.userRequest || job.user_request || '' })[0] || null;
  const isCompare = wantedType === 'MULTI_VENDOR_PRICE_COMPARISON' || registryCandidate?.layoutType === 'VENDOR_COMPARISON_TABLE';
  const isMarket = wantedType === 'STANDARD_MARKET_PRICE_TABLE' || wantedType === 'UNIT_PRICE_TABLE' || registryCandidate?.layoutType === 'PRICE_SURVEY_TABLE';
  const isDocumentForm = ['REPORT', 'MEETING_MINUTES', 'OFFICIAL_LETTER'].includes(wantedType) || ['REPORT_FORM', 'INSPECTION_REPORT', 'REVIEW_OPINION_FORM', 'MEETING_MINUTES', 'OFFICIAL_LETTER', 'WORK_DAILY_REPORT'].includes(registryCandidate?.layoutType);
  const title = isCompare ? '업체별 단가 비교표' : (isMarket ? '표준시장단가 정리표' : (registryCandidate?.title || (isDocumentForm ? '업무 보고서' : 'AI 생성 문서 정리표')));
  const basePreferred = isCompare
    ? ['row_no', 'item_name', 'spec', 'quantity', 'unit', 'standard_unit_price']
    : (isMarket ? ['row_no', 'construction_code', 'item_name', 'spec', 'unit', 'standard_unit_price', 'labor_ratio', 'remark'] : ['row_no', 'item_name', 'spec', 'quantity', 'unit', 'unit_price', 'amount', 'remark']);
  const baseColumns = pickExistingColumnsFromTable(table, standardFields, basePreferred).slice(0, isCompare ? 8 : 16);
  const summaryColumns = isCompare
    ? [pickStandardField(standardFields, 'lowest_target', '최저 업체'), pickStandardField(standardFields, 'lowest_target', '최저 단가'), pickStandardField(standardFields, 'remark', '비고')]
    : [];

  return {
    templateName: `AI_${title}`,
    templateType: registryCandidate?.layoutType || wantedType,
    sheetName: title.slice(0, 31),
    title,
    layout: isCompare ? 'AI_GENERATED_DYNAMIC_VENDOR_TABLE' : (isMarket ? 'PRICE_TABLE' : normalizeLayoutForRenderer(registryCandidate?.layoutType || wantedType)),
    headerFields: [pickStandardField(standardFields, 'document_title'), pickStandardField(standardFields, 'document_date'), pickStandardField(standardFields, 'requester_name')].filter((item) => item.fieldKey),
    baseColumns,
    repeatGroups: isCompare ? [{
      groupKey: 'vendors',
      label: '업체별 견적',
      repeatBy: 'vendor',
      columns: [pickStandardField(standardFields, 'unit_price', '단가'), pickStandardField(standardFields, 'amount', '금액')],
    }] : [],
    summaryColumns: isCompare ? [
      { fieldKey: 'lowest_target', label: '최저 업체' },
      { fieldKey: 'calculated_unit_price', label: '최저 단가' },
      { fieldKey: 'remark', label: '비고' },
    ] : summaryColumns,
    reason: isCompare ? '업체별 단가 비교 문서로 분석되어 업체 수에 따라 반복 컬럼이 늘어나는 양식을 제안했습니다.' : (isDocumentForm ? `${title} 레이아웃으로 문서 핵심 내용을 서술형 섹션에 배치합니다.` : '분석된 표 컬럼과 DB 표준필드를 기준으로 일반 행 반복 양식을 제안했습니다.'),
    confidence: 0.82,
  };
}

function sanitizeDesign(rawDesign = {}, { standardFields = [], job = {}, table = {} } = {}) {
  const allowed = new Map(standardFields.map((field) => [field.field_key, field]));
  const fallback = fallbackTemplateDesign({ job, table, standardFields });
  const source = rawDesign && typeof rawDesign === 'object' ? rawDesign : fallback;
  const normalizeFieldItem = (item) => {
    const key = compactFieldKey(item?.fieldKey || item?.field_key || item?.key);
    if (!allowed.has(key)) return null;
    return { fieldKey: key, label: item?.label || allowed.get(key)?.field_label || key };
  };
  const normalizeFieldList = (items, fallbackItems = []) => {
    const out = [];
    [...(Array.isArray(items) ? items : []), ...fallbackItems].forEach((item) => {
      const normalized = normalizeFieldItem(item);
      if (normalized && !out.some((existing) => existing.fieldKey === normalized.fieldKey && existing.label === normalized.label)) out.push(normalized);
    });
    return out;
  };

  const repeatGroups = Array.isArray(source.repeatGroups) ? source.repeatGroups : [];
  const safeRepeatGroups = repeatGroups.map((group) => ({
    groupKey: group.groupKey || 'vendors',
    label: group.label || '업체별 견적',
    repeatBy: group.repeatBy || 'vendor',
    columns: normalizeFieldList(group.columns, fallback.repeatGroups?.[0]?.columns || []),
  })).filter((group) => group.columns.length);

  const requestedLayout = String(source.layout || source.layoutType || fallback.layout || '').trim();
  const normalizedRequestedLayout = normalizeLayoutForRenderer(requestedLayout);
  const finalLayout = safeRepeatGroups.length && /VENDOR|DYNAMIC|COMPARISON/i.test(normalizedRequestedLayout)
    ? 'AI_GENERATED_DYNAMIC_VENDOR_TABLE'
    : (normalizedRequestedLayout || fallback.layout || 'AI_GENERATED_TABLE');

  return {
    templateName: String(source.templateName || fallback.templateName || 'AI_추천양식').slice(0, 80),
    templateType: String(source.templateType || source.layoutType || fallback.templateType || inferWantedTemplateType(job)).slice(0, 80),
    sheetName: String(source.sheetName || fallback.sheetName || 'AI추천양식').slice(0, 31),
    title: String(source.title || fallback.title || 'AI 추천양식').slice(0, 120),
    layout: finalLayout,
    headerFields: normalizeFieldList(source.headerFields, fallback.headerFields),
    baseColumns: normalizeFieldList(source.baseColumns, fallback.baseColumns).slice(0, 20),
    repeatGroups: safeRepeatGroups,
    summaryColumns: normalizeFieldList(source.summaryColumns, fallback.summaryColumns).slice(0, 8),
    reason: String(source.reason || fallback.reason || '').slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(source.confidence || fallback.confidence || 0.75))),
    generatedBy: source.generatedBy || (source?._llm ? 'qwen2.5:7b' : 'rule-fallback'),
  };
}

async function makeTemplateDesignWithLlm({ job = {}, table = {}, standardFields = [] }) {
  const mode = String(process.env.AI_TEMPLATE_DESIGN_MODE || 'auto').toLowerCase();
  if (mode === 'rule' || mode === 'off' || mode === 'false') return fallbackTemplateDesign({ job, table, standardFields });
  try {
    const result = await designTemplateWithAiServer({
      userRequest: job.userRequest || job.user_request || '',
      analysis: job.analysis || {},
      columns: (table.columns || []).slice(0, 80),
      rows: (table.rows || []).slice(0, 20),
      standardFields: standardFields.map((field) => ({ fieldKey: field.field_key, label: field.field_label, group: field.field_group, dataType: field.data_type })),
      layoutRegistry: buildLayoutCandidates({ analysis: job.analysis || {}, table, userRequest: job.userRequest || job.user_request || '' }).map((item) => ({ layoutType: item.layoutType, layout: item.layout, name: item.name, reason: item.reason, sections: item.sections })),
    });
    if (result && typeof result === 'object') return { ...result, generatedBy: result?._llm?.model || 'qwen2.5:7b' };
  } catch (error) {
    console.warn('[AI_TEMPLATE_DESIGN_FALLBACK]', error?.response?.data || error.message);
  }
  return fallbackTemplateDesign({ job, table, standardFields });
}

async function createTemplateSkeletonFile(design) {
  ensureDir(AI_TEMPLATE_DIR);
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const safeBase = String(design.templateName || 'AI_TEMPLATE').replace(/[\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  const fileName = `${stamp}_${safeBase}.xlsx`;
  try {
    const result = await createTemplateSkeletonWithAiServer({ design, fileName });
    if (result?.file_path || result?.filePath) {
      return { fileName: result.file_name || result.fileName || fileName, filePath: result.file_path || result.filePath };
    }
  } catch (error) {
    console.warn('[AI_TEMPLATE_SKELETON_OPENPYXL_FALLBACK_PATH_ONLY]', error?.response?.data || error.message);
  }
  const filePath = path.join(AI_TEMPLATE_DIR, fileName);
  // 실제 파일 생성은 Python openpyxl이 담당한다. AI 서버 장애 시에도 DB 등록이 끊기지 않도록
  // placeholder 파일을 두지 않고 경로만 반환하면 다운로드/생성 단계에서 다시 openpyxl 생성으로 보정한다.
  return { fileName, filePath };
}

function makeAiTemplateCode(templateName = 'AI_TEMPLATE') {
  const compact = String(templateName || 'AI_TEMPLATE')
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return `AI_${compact || 'TEMPLATE'}_${Date.now()}`.slice(0, 96);
}

async function createAiGeneratedTemplateForJob({ job = {}, tableId = null, user = {}, designOverride = null }) {
  if (!job?.id) throw new Error('분석 작업 정보가 없습니다.');
  const table = tableId ? (job.tables || []).find((item) => Number(item.id) === Number(tableId)) : (job.tables || [])[0];
  if (!table) throw new Error('양식 생성에 사용할 표 데이터가 없습니다.');
  const standardFields = await StandardField.find({ active_yn: 'Y' }).sort({ sort_order: 1, id: 1 }).lean();
  if (!standardFields.length) throw new Error('DB 표준필드가 없습니다. seed를 먼저 실행하세요.');

  const llmDesign = designOverride && typeof designOverride === 'object' ? designOverride : await makeTemplateDesignWithLlm({ job, table, standardFields });
  const design = sanitizeDesign(llmDesign, { standardFields, job, table });
  const generatedFile = await createTemplateSkeletonFile(design);
  const templateCode = makeAiTemplateCode(design.templateName);
  const templateId = await nextSeq('excel_templates');
  const mappingId = await nextSeq('excel_template_mappings');
  const mappingJson = ensureTemplateMappingJson({
    layout: design.layout,
    template_type: design.templateType,
    sheetName: design.sheetName,
    title: design.title,
    headerFields: design.headerFields,
    baseColumns: design.baseColumns,
    repeatGroups: design.repeatGroups,
    summaryColumns: design.summaryColumns,
    rowStart: 5,
    aiGenerated: true,
    generatedBy: design.generatedBy,
    reason: design.reason,
    confidence: design.confidence,
    sourceJobId: job.id,
    sourceTableId: table.id || null,
    createdAt: new Date().toISOString(),
  }, { template_name: design.templateName, template_type: design.templateType, default_sheet_name: design.sheetName });

  const template = await ExcelTemplate.create({
    id: templateId,
    created_by: user?.id || null,
    template_name: design.templateName,
    template_code: templateCode,
    template_type: design.templateType,
    file_path: generatedFile.filePath,
    original_file_name: generatedFile.fileName,
    default_sheet_name: design.sheetName,
    description: `AI 생성 양식: ${design.reason || 'DB 표준필드 기반으로 생성'}`,
    active_yn: 'Y',
  });

  await ExcelTemplateMapping.create({
    id: mappingId,
    template_id: templateId,
    created_by: user?.id || null,
    mapping_name: `${design.templateName} AI 생성 매핑`,
    mapping_version: 'v1',
    mapping_json: mappingJson,
    active_yn: 'Y',
  });

  await DocumentTemplateRecommendation.create({
    id: await nextSeq('document_template_recommendations'),
    job_id: Number(job.id),
    template_id: templateId,
    recommendation_type: 'AI_GENERATED_TEMPLATE',
    template_name: design.templateName,
    template_type: design.templateType,
    score: Math.round((design.confidence || 0.8) * 100),
    rank: 1,
    reason_json: [design.reason || 'DB 표준필드 기반 AI 새 양식 생성'],
    matched_fields_json: [...(design.baseColumns || []), ...(design.summaryColumns || [])].map((item) => item.fieldKey),
    missing_fields_json: [],
    design_json: mappingJson,
    status: 'CREATED',
    applied_yn: 'Y',
  });

  return {
    template: toCamelTemplate(template.toObject ? template.toObject() : template, mappingJson),
    design: mappingJson,
    recommendation: {
      templateId,
      templateName: design.templateName,
      templateType: design.templateType,
      score: Math.round((design.confidence || 0.8) * 100),
      rank: 1,
      reasons: [design.reason || 'DB 표준필드 기반 AI 새 양식 생성'],
      recommendationType: 'AI_GENERATED_TEMPLATE',
      template: toCamelTemplate(template.toObject ? template.toObject() : template, mappingJson),
    },
  };
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const num = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function getRowValue(row = {}, fieldKey = '', index = 0) {
  if (fieldKey === 'row_no') return index + 1;
  if (fieldKey === 'lowest_target') return row.lowest_target || row.lowest_vendor || row.selected_vendor || '';
  if (fieldKey === 'calculated_unit_price') return row.calculated_unit_price || row.lowest_unit_price || '';
  return row[fieldKey] ?? '';
}

function getVendorValue(row = {}, vendor = {}, fieldKey = '') {
  const key = fieldKey === 'unit_price' ? 'unit_price' : fieldKey;
  if (fieldKey === 'amount') {
    if (vendor.amountKey && row[vendor.amountKey] !== undefined && row[vendor.amountKey] !== '') return row[vendor.amountKey];
    const qty = toNumber(row.quantity || row.request_quantity || row.requested_quantity || 0);
    const price = toNumber(getVendorValue(row, vendor, 'unit_price'));
    return qty && price ? qty * price : '';
  }
  if (key === 'unit_price') {
    if (vendor.unitPriceKey && row[vendor.unitPriceKey] !== undefined && row[vendor.unitPriceKey] !== '') return row[vendor.unitPriceKey];
    if (row.vendor_name && String(row.vendor_name).trim() === String(vendor.name).trim()) return row.vendor_unit_price || row.unit_price || '';
    return row.vendor_unit_price && !row.vendor_name ? row.vendor_unit_price : '';
  }
  return row[fieldKey] ?? '';
}

function computeLowestVendor(row = {}, vendors = []) {
  let best = null;
  for (const vendor of vendors || []) {
    const price = toNumber(getVendorValue(row, vendor, 'unit_price'));
    if (!price) continue;
    if (!best || price < best.price) best = { vendor: vendor.name, price };
  }
  return best || { vendor: '', price: '' };
}

async function writeAiGeneratedTemplateExcel({ workbook, template, mappingJson = {}, columns = [], rows = [], job = {}, authorName = '' }) {
  let sheet = workbook.getWorksheet(mappingJson.sheetName || template.default_sheet_name || 1) || workbook.worksheets[0];
  if (sheet) {
    workbook.removeWorksheet(sheet.id);
  }
  sheet = workbook.addWorksheet(mappingJson.sheetName || template.default_sheet_name || 'AI추천양식');
  const design = mappingJson || {};
  const tableJson = job?.tables?.[0]?.tableJson || {};
  const vendors = (design.repeatGroups || []).length ? inferVendors(columns, rows, tableJson).filter((vendor) => vendor?.name) : [];
  const baseColumns = Array.isArray(design.baseColumns) && design.baseColumns.length ? design.baseColumns : (columns || []).map((col) => ({ fieldKey: col.key, label: col.label || col.key }));
  const repeatColumns = vendors.length ? (design.repeatGroups?.[0]?.columns || [{ fieldKey: 'unit_price', label: '단가' }, { fieldKey: 'amount', label: '금액' }]) : [];
  const summaryColumns = Array.isArray(design.summaryColumns) ? design.summaryColumns : [];
  const outputColumns = [
    ...baseColumns.map((item) => ({ type: 'base', ...item })),
    ...vendors.flatMap((vendor) => repeatColumns.map((item) => ({ type: 'vendor', vendor, ...item, label: `${vendor.name} ${item.label || item.fieldKey}` }))),
    ...summaryColumns.map((item) => ({ type: 'summary', ...item })),
  ].filter((item) => item?.fieldKey);
  const totalCols = Math.max(outputColumns.length, 1);

  sheet.mergeCells(1, 1, 1, totalCols);
  sheet.getCell(1, 1).value = design.title || template.template_name || 'AI 추천양식';
  sheet.getCell(1, 1).font = { bold: true, size: 16 };
  sheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell(2, 1).value = '작성일';
  sheet.getCell(2, 2).value = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul' }).format(new Date());
  sheet.getCell(2, 3).value = '작성자';
  sheet.getCell(2, 4).value = authorName || '';
  sheet.getCell(3, 1).value = '생성 기준';
  sheet.getCell(3, 2).value = design.reason || 'DB 표준필드 기반 AI 생성 양식';

  const headerRow = 5;
  outputColumns.forEach((col, idx) => {
    const cell = sheet.getCell(headerRow, idx + 1);
    cell.value = col.label || col.fieldKey;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    sheet.getColumn(idx + 1).width = Math.max(14, String(cell.value || '').length + 4);
  });

  (rows || []).forEach((row, rowIndex) => {
    const lowest = computeLowestVendor(row, vendors);
    outputColumns.forEach((col, colIndex) => {
      let value = '';
      if (col.type === 'vendor') value = getVendorValue(row, col.vendor, col.fieldKey);
      else if (col.fieldKey === 'lowest_target') value = row.lowest_target || row.lowest_vendor || row.selected_vendor || lowest.vendor;
      else if (col.fieldKey === 'calculated_unit_price') value = row.calculated_unit_price || row.lowest_unit_price || lowest.price;
      else value = getRowValue(row, col.fieldKey, rowIndex);
      const cell = sheet.getCell(headerRow + 1 + rowIndex, colIndex + 1);
      cell.value = value;
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  return { vendorCount: vendors.length, templateKind: 'AI_GENERATED_TEMPLATE' };
}

function makeFieldItem(key, label = null) {
  return { fieldKey: key, label: label || key };
}

function getTemplateDesignCandidatesForJob(job = {}) {
  const wantedType = inferWantedTemplateType(job);
  const table = (job.tables || [])[0] || {};
  const tableColumns = Array.isArray(table.columns) ? table.columns : [];
  const baseFromTable = tableColumns.slice(0, 14).map((col) => makeFieldItem(col.key, col.label || col.key));
  const fallbackBase = baseFromTable.length ? baseFromTable : [makeFieldItem('row_no', 'NO'), makeFieldItem('item_name', '품명'), makeFieldItem('spec', '규격'), makeFieldItem('quantity', '수량'), makeFieldItem('unit', '단위'), makeFieldItem('unit_price', '단가'), makeFieldItem('amount', '금액'), makeFieldItem('remark', '비고')];
  const registryCandidates = buildLayoutCandidates({ analysis: job.analysis || {}, table, userRequest: job.userRequest || job.user_request || '' });

  const toDesign = (candidate) => {
    const layout = normalizeLayoutForRenderer(candidate.layoutType || candidate.layout);
    const isVendor = layout === 'AI_GENERATED_DYNAMIC_VENDOR_TABLE';
    const isTableLike = /TABLE|PRICE|ESTIMATE|VENDOR/i.test(layout);
    return {
      designId: candidate.designId,
      name: candidate.name,
      documentKind: candidate.documentKind,
      layoutType: candidate.layoutType,
      score: candidate.score,
      layout,
      reason: candidate.reason,
      sections: candidate.sections || [],
      templateName: `AI_${candidate.name}`,
      templateType: candidate.layoutType || wantedType,
      sheetName: String(candidate.name || 'AI추천양식').slice(0, 31),
      title: candidate.title || candidate.name,
      confidence: Math.max(0.5, Math.min(0.98, Number(candidate.score || 80) / 100)),
      baseColumns: isVendor
        ? [makeFieldItem('row_no', 'NO'), makeFieldItem('item_name', '품명'), makeFieldItem('spec', '규격'), makeFieldItem('quantity', '수량'), makeFieldItem('unit', '단위')]
        : (isTableLike ? fallbackBase : []),
      repeatGroups: isVendor ? [{ groupKey: 'vendors', repeatBy: 'vendor', columns: [makeFieldItem('unit_price', '단가'), makeFieldItem('amount', '금액')] }] : [],
      summaryColumns: isVendor ? [makeFieldItem('lowest_target', '최저 업체'), makeFieldItem('calculated_unit_price', '최저 단가'), makeFieldItem('remark', '비고')] : [],
      sourceType: 'LAYOUT_REGISTRY',
    };
  };

  const designs = registryCandidates.map(toDesign);
  if (!designs.some((item) => item.layout === 'TABLE_ONLY' || item.layout === 'BASIC_TABLE')) {
    designs.push({
      designId: 'BASIC_TABLE_V1',
      name: '기본 표 양식',
      documentKind: '일반표',
      score: 70,
      layout: 'BASIC_TABLE',
      layoutType: 'BASIC_TABLE',
      reason: '문서 유형이 불명확하거나 서술형 전환이 맞지 않을 때 원본 표 데이터를 안전하게 편집합니다.',
      templateName: 'AI_기본 표 양식',
      templateType: wantedType,
      sheetName: '기본 표 양식',
      title: '데이터 정리표',
      confidence: 0.7,
      baseColumns: fallbackBase,
      repeatGroups: [],
      summaryColumns: [],
      sourceType: 'LAYOUT_REGISTRY',
    });
  }
  return designs.slice(0, 5);
}

module.exports = {
  getTemplateRecommendationsForJob,
  saveRecommendationHistory,
  getTemplateDesignCandidatesForJob,
  createAiGeneratedTemplateForJob,
  writeAiGeneratedTemplateExcel,
};
