import { defaultColumns, backgroundStatuses, SYSTEM_DEFAULT_TEMPLATE_CODES } from './constants.js';

// ─── Table type helpers ───────────────────────────────────────────────────────

export const isReferenceTableType = (tableType) => ['REFERENCE_GUIDELINE_TABLE', 'GUIDELINE_SUMMARY_TABLE'].includes(tableType);
export const isStandardMarketTableType = (tableType) => tableType === 'STANDARD_MARKET_PRICE_TABLE';
export const isMultiVendorCompareTableType = (tableType) => tableType === 'MULTI_VENDOR_PRICE_COMPARISON';
export const isTextVendorComparisonReportType = (tableType) => tableType === 'TEXT_VENDOR_COMPARISON_REPORT';

export const tableTypeLabel = (tableType) => {
  if (isReferenceTableType(tableType)) return '기준서 항목 표';
  if (isStandardMarketTableType(tableType)) return '표준시장단가 표';
  if (isMultiVendorCompareTableType(tableType)) return '업체별 단가 비교표';
  if (isTextVendorComparisonReportType(tableType)) return '서술형 비교 요약';
  return '추출 결과';
};

// ─── Column / file helpers ────────────────────────────────────────────────────

export const getVisibleColumns = (columns = [], rows = []) => {
  if (!Array.isArray(columns) || !columns.length) return defaultColumns;
  return columns;
};

export const makeFileKey = (file) => `${file.name}__${file.size}__${file.lastModified || 0}`;

export const toChatFile = (file) => ({
  name: file.name,
  size: file.size,
  type: file.type || '',
  lastModified: file.lastModified || 0
});


// ─── Safe display helpers ────────────────────────────────────────────────────

export function toDisplayText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => toDisplayText(item, ''))
      .filter((item) => String(item || '').trim() !== '')
      .join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => {
        const rendered = toDisplayText(item, '');
        return rendered ? `${key}: ${rendered}` : String(key);
      })
      .filter((item) => String(item || '').trim() !== '')
      .join('\n');
  }
  return String(value);
}

export function escapeHtmlText(value) {
  return toDisplayText(value, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Chat message helpers ─────────────────────────────────────────────────────

export const welcomeMessage = () => ({
  id: 'welcome',
  role: 'assistant',
  content: '선택한 양식 기준으로 문서를 분석합니다. 파일을 첨부하거나 "기준 항목 표로 정리해줘", "단가 기준만 표로 정리해줘"처럼 입력해보세요.',
  quickReplies: ['기준 항목 표로 정리해줘', '단가 기준만 표로 정리해줘', '이 문서 뭐야?']
});

export const normalizeServerMessages = (messages = []) => {
  const normalized = (messages || []).map((msg) => {
    const payload = msg.payload || {};
    return {
      id: msg.id || `${Date.now()}-${Math.random()}`,
      role: String(msg.role || 'assistant').toLowerCase(),
      content: msg.content || msg.messageText || msg.message_text || '',
      quickReplies: payload.quickReplies || msg.quickReplies || [],
      files: payload.files || msg.files || [],
      generatedExcel: payload.generatedExcel || msg.generatedExcel || null,
      meta: msg.llmModel || payload.model || null,
      createdAt: msg.createdAt
    };
  });
  return normalized.length ? normalized : [welcomeMessage()];
};

export const mergeFileList = (prevFiles, nextFileList) => {
  const nextFiles = Array.from(nextFileList || []);
  if (!nextFiles.length) return prevFiles;
  const seen = new Set(prevFiles.map(makeFileKey));
  const merged = [...prevFiles];
  nextFiles.forEach((file) => {
    const key = makeFileKey(file);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  });
  return merged;
};

// ─── Status helpers ───────────────────────────────────────────────────────────

export const isBackgroundRunning = (status) => backgroundStatuses.has(String(status || '').toUpperCase());

export const statusLabel = (status) => {
  const value = String(status || '').toUpperCase();
  if (value === 'QUEUED') return '대기열 등록';
  if (value === 'PROCESSING') return '백그라운드 분석 중';
  if (value === 'PARSING') return '문서 파싱 중';
  if (value === 'ANALYZING') return 'AI 분석 중';
  if (value === 'VALIDATING') return '검증 중';
  if (value === 'READY_TO_GENERATE') return '엑셀 생성 가능';
  if (value === 'NEED_REVIEW') return '확인 필요';
  if (value === 'GENERATED') return '엑셀 생성됨';
  if (value === 'FAILED') return '실패';
  return value || '대기';
};

// ─── Template helpers ─────────────────────────────────────────────────────────

export function isSystemDefaultTemplate(template = {}) {
  const code = String(template.templateCode || template.template_code || '').toUpperCase();
  const mapping = template.mapping || template.mappingJson || template.mapping_json || {};
  return SYSTEM_DEFAULT_TEMPLATE_CODES.has(code) || Boolean(mapping?.locked);
}

export function isAiGeneratedTemplate(selectedTemplate) {
  const mapping = selectedTemplate?.mapping || selectedTemplate?.mappingJson || {};
  const code = String(selectedTemplate?.templateCode || selectedTemplate?.template_code || '').toUpperCase();
  return Boolean(mapping?.aiGenerated) || code.startsWith('AI_');
}

export function isUserRegisteredCompanyTemplate(template = {}) {
  if (!template) return false;
  if (isAiGeneratedTemplate(template)) return false;
  if (isSystemDefaultTemplate(template)) return false;
  const code = String(template.templateCode || template.template_code || '').toUpperCase();
  if (code.startsWith('AI_')) return false;
  return true;
}

// ─── Column label cleanup ─────────────────────────────────────────────────────

export function cleanTableColumnLabel(label = '') {
  return String(label || '')
    .replace(/^\s*[A-Z]\s*회사\s*[·ㆍ:：\-–—]*\s*/i, '')
    .replace(/^\s*[A-Z]\s*회사(?=㈜|\(주\)|주식회사|[가-힣A-Za-z0-9])/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Design detection helpers ─────────────────────────────────────────────────

export function detectDocumentDesignType({ analysis = {}, table = {}, userRequest = '' } = {}) {
  const source = [
    analysis.documentType,
    analysis.purpose,
    analysis.summary,
    table.tableName,
    table.tableType,
    userRequest,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/회의|meeting|minutes|안건|조치사항|결정사항/.test(source)) return 'MEETING_MINUTES';
  if (/공문|시행|수신|참조|official|letter/.test(source)) return 'OFFICIAL_LETTER';
  if (/보고서|보고|리포트|report|현황|progress|감리/.test(source)) return 'REPORT';
  if (/단가표|price\s*list|단가\s*목록|표준시장단가|market_price/.test(source)) return 'PRICE_TABLE';
  if (/견적|비교|업체|vendor|estimate|comparison/.test(source)) return 'ESTIMATE';
  return 'BASIC_TABLE';
}

export function buildDefaultDesignCandidates() {
  return [];
}

export function templateToAiDesignCandidate(template) {
  if (!template || !isAiGeneratedTemplate(template)) return null;
  const mapping = template.mapping || template.mappingJson || template.mapping_json || {};
  const layout = mapping.layout || mapping.layoutType || template.templateType || template.template_type || 'BASIC_TABLE';
  const designId = String(mapping.designId || template.templateCode || template.template_code || template.id || '').trim() || `AI_TEMPLATE_${template.id || Date.now()}`;
  return {
    ...mapping,
    designId,
    name: template.templateName || template.template_name || mapping.templateName || mapping.name || 'AI 생성 양식',
    documentKind: mapping.documentKind || mapping.templateType || template.templateType || template.template_type || 'AI 생성',
    layout,
    title: mapping.title || template.templateName || template.template_name || 'AI 생성 양식',
    score: Number(mapping.score || 80),
    reason: mapping.reason || 'AI가 DB 표준필드를 기준으로 생성한 양식입니다.',
    sourceType: 'AI_TEMPLATE',
  };
}

export function getRecommendationContextText(context = {}) {
  const { analysis = {}, table = {}, userRequest = '' } = context || {};
  return [
    analysis.documentType,
    analysis.document_type,
    analysis.purpose,
    analysis.summary,
    analysis.businessPurpose,
    analysis.business_purpose,
    table.tableName,
    table.table_name,
    table.tableType,
    table.table_type,
    ...(Array.isArray(table.columns) ? table.columns.map((c) => `${c.label || ''} ${c.key || ''}`) : []),
    userRequest,
  ].filter(Boolean).join(' ');
}

export function normalizeDesignLayoutType(value = '') {
  const layout = String(value || '').toUpperCase();
  if (!layout) return 'BASIC_TABLE';
  if (layout === 'VENDOR_COMPARISON_REVIEW_FORM' || layout.includes('VENDOR_COMPARE_REVIEW')) return 'VENDOR_COMPARISON_REVIEW_FORM';
  if (layout === 'REVIEW_OPINION_FORM' || layout.includes('REVIEW_OPINION')) return 'REVIEW_OPINION_FORM';
  if (layout === 'INSPECTION_REPORT' || layout.includes('INSPECTION')) return 'INSPECTION_REPORT';
  if (layout === 'WORK_DAILY_REPORT' || layout.includes('WORK_DAILY')) return 'WORK_DAILY_REPORT';
  if (layout.includes('DYNAMIC_VENDOR') || layout.includes('VENDOR_COMPARE')) return 'VENDOR_COMPARISON_TABLE';
  if (layout === 'PRICE_TABLE' || layout.includes('PRICE_SURVEY') || layout.includes('UNIT_PRICE')) return 'PRICE_SURVEY_TABLE';
  if (layout === 'ESTIMATE_FORM' || layout.includes('ESTIMATE')) return 'ESTIMATE_REVIEW_FORM';
  if (['SECTION_REPORT', 'APPROVAL_FORM', 'HEADER_SUMMARY_TABLE', 'REPORT', 'REPORT_FORM'].includes(layout)) return 'REPORT_FORM';
  if (layout.includes('MEETING')) return 'MEETING_MINUTES';
  if (layout.includes('OFFICIAL')) return 'OFFICIAL_LETTER';
  return layout;
}

export function recomputeDesignScore(item = {}) {
  return Math.max(0, Math.min(100, Number(item.score || item.confidence * 100 || 80) || 80));
}

export function mergeAiDesignOptions(designCandidates = [], templates = []) {
  const list = [
    ...(Array.isArray(designCandidates) ? designCandidates : []),
    ...(Array.isArray(templates) ? templates.map(templateToAiDesignCandidate).filter(Boolean) : []),
  ];
  const seenIds = new Set();
  return list
    .filter((item) => item && (item.designId || item.name || item.layout || item.templateName))
    .map((item, index) => {
      const rawLayoutType = item.layoutType || item.layout_type || item.templateType || item.template_type || item.layout || 'CUSTOM_DOCUMENT_FORM';
      const layoutType = normalizeDesignLayoutType(rawLayoutType);
      return {
        ...item,
        designId: String(item.designId || item.design_id || item.templateCode || item.template_code || layoutType || item.name || `AI_DESIGN_${index}`),
        name: item.name || item.templateName || item.title || `AI 생성 양식 ${index + 1}`,
        layoutType,
        layout: item.layout || layoutType,
        score: recomputeDesignScore(item),
      };
    })
    .filter((item) => {
      const idKey = String(item.designId || '').toUpperCase();
      if (seenIds.has(idKey)) return false;
      seenIds.add(idKey);
      return true;
    })
    .slice(0, 5);
}

export function indexSafeLayout(layout = '') {
  return ['REPORT_FORM', 'REVIEW_OPINION_FORM', 'VENDOR_COMPARISON_REVIEW_FORM', 'INSPECTION_REPORT', 'BASIC_TABLE'].includes(String(layout || '').toUpperCase());
}

// ─── Business purpose helpers ─────────────────────────────────────────────────

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

export function looksLikeUserFormattingPrompt(value = '') {
  const text = String(value || '').trim();
  if (!text) return false;
  const normalized = text.replace(/\s+/g, ' ');
  const promptTokens = [
    '정리해줘', '작성해줘', '만들어줘', '써줘', '출력해줘',
    '회사 업무보고서 형식', '회사 보고서 형식', '핵심 내용만',
    '보고 목적·', '검토 결과·', '조치 계획 중심',
    '원문에 없는 내용', '임의로 만들지', '확인 필요로 표시'
  ];
  return promptTokens.some((token) => normalized.includes(token));
}

export function sanitizeBusinessPurpose(value = '') {
  const text = firstNonEmpty(value).trim();
  if (!text || looksLikeUserFormattingPrompt(text)) return '';
  return text;
}

export function inferBusinessPurposeFromRow(row = {}) {
  const source = firstNonEmpty(row.document_title, row.report_title, row.summary, row.content, row.issue_summary, row.review_opinion);
  const text = String(source || '').replace(/^[•\-–—*\s]+/gm, '').replace(/\s+/g, ' ').trim();
  if (!text || looksLikeUserFormattingPrompt(text)) return '첨부 문서의 주요 내용과 확인 필요 사항을 업무 보고 형식으로 정리합니다.';
  if (/점검|안전|위험|현장|감리/.test(text)) return '첨부 문서의 현장 점검 내용과 확인 필요 사항을 검토하기 위한 보고입니다.';
  if (/견적|단가|금액|업체|비교/.test(text)) return '첨부 문서의 견적·단가·업체 비교 내용을 검토하기 위한 보고입니다.';
  if (/회의|안건|결정|조치/.test(text)) return '첨부 문서의 논의 내용과 후속 조치 사항을 정리하기 위한 보고입니다.';
  return '첨부 문서의 주요 내용과 확인 필요 사항을 업무 보고 형식으로 정리합니다.';
}

export function getDraftRowFromAnalysis(analysis = {}, layout = '') {
  const drafts = analysis?.drafts && typeof analysis.drafts === 'object' ? analysis.drafts : {};
  const layoutText = String(layout || '').toUpperCase();
  if (layoutText.includes('MEETING')) {
    const meeting = drafts.meeting || drafts.meetingMinutes || {};
    if (!Object.keys(meeting).length) return null;
    return {
      meeting_title: firstNonEmpty(meeting.meeting_title, meeting.title, '회의록'),
      meeting_date: firstNonEmpty(meeting.meeting_date, meeting.date),
      meeting_place: firstNonEmpty(meeting.meeting_place, meeting.place),
      attendees: firstNonEmpty(meeting.attendees),
      agenda: firstNonEmpty(meeting.agenda, meeting.summary),
      discussion: firstNonEmpty(meeting.discussion, meeting.content),
      decision: firstNonEmpty(meeting.decision, meeting.decisions),
      action_item: firstNonEmpty(meeting.action_item, meeting.action_items, meeting.actionPlan),
      remark: firstNonEmpty(meeting.remark, meeting.footer_note),
    };
  }
  if (layoutText.includes('OFFICIAL')) {
    const letter = drafts.officialLetter || drafts.official || {};
    if (!Object.keys(letter).length) return null;
    return {
      letter_title: firstNonEmpty(letter.letter_title, letter.title, '공문'),
      document_no: firstNonEmpty(letter.document_no, letter.documentNo),
      recipient: firstNonEmpty(letter.recipient),
      reference: firstNonEmpty(letter.reference),
      document_title: firstNonEmpty(letter.document_title, letter.subject, letter.title),
      body: firstNonEmpty(letter.body, letter.content, letter.summary),
      attachment_note: firstNonEmpty(letter.attachment_note, letter.attachments),
      sender: firstNonEmpty(letter.sender),
    };
  }
  const report = drafts.report || {};
  if (!Object.keys(report).length) return null;
  return {
    report_title: firstNonEmpty(report.report_title, report.title, analysis.documentTitle, analysis.documentType, '업무 보고서'),
    document_title: firstNonEmpty(report.document_title, report.report_title, report.title),
    report_purpose: firstNonEmpty(sanitizeBusinessPurpose(report.report_purpose), sanitizeBusinessPurpose(report.purpose), sanitizeBusinessPurpose(analysis.purpose), inferBusinessPurposeFromRow({ ...report, summary: analysis.summary })),
    summary: firstNonEmpty(report.summary, analysis.summary),
    content: firstNonEmpty(report.content, report.summary, analysis.summary),
    issue_summary: firstNonEmpty(report.issue_summary, report.review_result, report.review_opinion),
    review_result: firstNonEmpty(report.review_result, report.issue_summary, report.review_opinion),
    review_opinion: firstNonEmpty(report.review_opinion, report.review_result, report.issue_summary),
    action_plan: firstNonEmpty(report.action_plan, report.actionPlan),
    footer_note: firstNonEmpty(report.footer_note, report.note),
  };
}

export function mergeDraftIntoRows(rows = [], draftRow = null) {
  if (!draftRow || !Object.values(draftRow).some((value) => String(value || '').trim())) return rows;
  if (!Array.isArray(rows) || rows.length === 0) return [draftRow];
  const first = { ...(rows[0] || {}) };
  Object.entries(draftRow).forEach(([key, value]) => {
    const nextValue = String(value || '').trim();
    const currentValue = String(first[key] || '').trim();
    const currentLooksPrompt = ['report_purpose', 'purpose', 'report_title', 'document_title'].includes(key) && looksLikeUserFormattingPrompt(currentValue);
    if (nextValue && (!currentValue || currentLooksPrompt)) first[key] = value;
  });
  if (looksLikeUserFormattingPrompt(first.report_purpose || first.purpose || '')) {
    first.report_purpose = firstNonEmpty(sanitizeBusinessPurpose(draftRow.report_purpose), inferBusinessPurposeFromRow(first));
  }
  return [first, ...rows.slice(1)];
}

// ─── Preview format helpers ───────────────────────────────────────────────────

export function formatPreviewDate() {
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}.${parts.month}.${parts.day}`;
}

export function compactText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function toPreviewNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const num = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

export function formatMoney(value) {
  if (value === '' || value == null) return '';
  const num = toPreviewNumber(value);
  if (!num) return String(value ?? '');
  return num.toLocaleString();
}

// ─── Vendor label helpers ─────────────────────────────────────────────────────

export function normalizePreviewVendorLabel(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*(단가|금액|견적가|견적단가)$/g, '')
    .trim();
}

export function comparableCompanyName(name) {
  return String(name || '')
    .replace(/주식회사|\(주\)|㈜|（주）/g, '')
    .replace(/[\s._\-()（）\[\]{}·,]/g, '')
    .toLowerCase();
}

export function isIgnoredVendorLabel(label) {
  const normalized = normalizePreviewVendorLabel(label);
  return /^(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출|공급|세액|금액|단가|업체명|회사명)$/i.test(normalized)
    || /^[A-Z가-힣]?\s*업체\d*$/i.test(normalized)
    || /^(?:vendor|company|target)[_\-]?\d+$/i.test(normalized)
    || /(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출)\s*(단가|금액)?$/i.test(label || '');
}

function readVendorName(vendor) {
  if (!vendor) return '';
  if (typeof vendor === 'string') return vendor;
  return vendor.name || vendor.vendorName || vendor.vendor_name || vendor.label || '';
}

function asVendorArray(value) {
  return Array.isArray(value) ? value : [];
}

export function inferPreviewVendors(table = {}, options = {}) {
  const columns = table.columns || [];
  const rows = table.rows || [];
  const meta = table.tableJson?.meta || {};
  const preview = options.generatedExcelPreview || table.generatedExcelPreview || table.previewModel || meta.editedPreviewModel || {};

  // source 우선순위: 채팅 요청/선택 업체 → 문서 분석 vendors → generatedExcelPreview vendors → 컬럼/행 추론 → fallback
  const sourceVendorGroups = [
    asVendorArray(meta.selectedVendors),
    asVendorArray(meta.selected_vendors),
    asVendorArray(meta.requestedVendors),
    asVendorArray(meta.requested_vendors),
    asVendorArray(meta.vendors),
    asVendorArray(meta.allVendors),
    asVendorArray(preview.vendors),
    asVendorArray(preview.meta?.vendors),
  ];
  const metaVendors = sourceVendorGroups.find((group) => group.length > 0) || [];
  const metaVendorByIndex = new Map();
  metaVendors.forEach((vendor, index) => {
    const actualIndex = Number.isFinite(Number(vendor?.index)) ? Number(vendor.index) : index;
    const name = readVendorName(vendor);
    if (name) metaVendorByIndex.set(actualIndex, vendor);
  });
  const map = new Map();
  const put = (name, patch = {}) => {
    const clean = normalizePreviewVendorLabel(name);
    const key = comparableCompanyName(clean);
    if (!clean || !key || isIgnoredVendorLabel(clean)) return null;
    if (!map.has(key)) map.set(key, { name: clean, compareKey: key, ...patch });
    else map.set(key, { ...map.get(key), ...patch, name: map.get(key).name || clean, compareKey: key });
    return map.get(key);
  };

  metaVendors.forEach((vendor, index) => {
    const name = readVendorName(vendor);
    put(name, {
      index,
      unitPriceKey: vendor?.unitPriceKey || vendor?.priceKey,
      amountKey: vendor?.amountKey,
      specKey: vendor?.specKey,
      quantityKey: vendor?.quantityKey
    });
  });

  columns.forEach((col) => {
    const key = String(col.key || '');
    const label = String(col.label || key || '').trim();
    if (!label) return;
    const isVendorColumn = /(단가|금액|견적가|견적단가)$/i.test(label) && !isIgnoredVendorLabel(label);
    if (isVendorColumn) {
      const vendor = put(label);
      if (!vendor) return;
      if (/금액$/.test(label)) vendor.amountKey = key;
      else vendor.unitPriceKey = key;
    }

    const keyMatch = key.match(/^(?:vendor|company|target)[_\-]?(\d+)[_\-]?(name|spec|quantity|qty|unit_price|price|amount)$/i);
    if (keyMatch) {
      const rawIdx = Number(keyMatch[1]);
      const zeroIndex = rawIdx > 0 ? rawIdx - 1 : rawIdx;
      const field = keyMatch[2].toLowerCase();
      const metaVendor = metaVendorByIndex.get(zeroIndex) || metaVendorByIndex.get(rawIdx);
      const rowName = String(metaVendor?.name || metaVendor?.vendorName || metaVendor?.label || '').trim()
        || rows.find((row) => row?.[`vendor_${rawIdx}_name`] || row?.[`company_${rawIdx}_name`])?.[`vendor_${rawIdx}_name`]
        || rows.find((row) => row?.[`company_${rawIdx}_name`])?.[`company_${rawIdx}_name`];
      const labelName = normalizePreviewVendorLabel(label);
      const fallbackName = !isIgnoredVendorLabel(labelName) && /(단가|금액|견적가|견적단가)$/i.test(label) ? labelName : '';
      const vendor = put(rowName || fallbackName, { index: zeroIndex });
      if (!vendor) return;
      if (field === 'name') vendor.nameKey = key;
      if (field === 'spec') vendor.specKey = key;
      if (field === 'quantity' || field === 'qty') vendor.quantityKey = key;
      if (field === 'unit_price' || field === 'price') vendor.unitPriceKey = key;
      if (field === 'amount') vendor.amountKey = key;
    }
  });

  Array.from(map.values()).forEach((vendor) => {
    const key = vendor.compareKey || comparableCompanyName(vendor.name);
    const matchedPrice = columns.find((col) => comparableCompanyName(col.label || '').includes(key) && /(단가|견적|가격)/.test(String(col.label || '')));
    if (matchedPrice && !vendor.unitPriceKey) vendor.unitPriceKey = matchedPrice.key;
    const matchedAmount = columns.find((col) => comparableCompanyName(col.label || '').includes(key) && /금액/.test(String(col.label || '')));
    if (matchedAmount && !vendor.amountKey) vendor.amountKey = matchedAmount.key;
  });

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const priceMap = row.vendor_prices || row.vendorPrices || row.vendor_unit_prices || row.vendorUnitPrices;
    if (priceMap && typeof priceMap === 'object' && !Array.isArray(priceMap)) {
      Object.entries(priceMap).forEach(([name, value]) => {
        const vendor = put(name);
        if (vendor && value !== undefined) vendor.inlinePrice = value;
      });
    }
    const amountMap = row.vendor_amounts || row.vendorAmounts;
    if (amountMap && typeof amountMap === 'object' && !Array.isArray(amountMap)) {
      Object.entries(amountMap).forEach(([name, value]) => {
        const vendor = put(name);
        if (vendor && value !== undefined) vendor.inlineAmount = value;
      });
    }
    const name = row.vendor_name || row.target_name;
    if (name && (row.vendor_unit_price || row.unit_price || row.amount)) {
      const vendor = put(name, { unitPriceKey: 'vendor_unit_price', amountKey: 'amount' });
      if (vendor && !vendor.unitPriceKey && row.unit_price) vendor.unitPriceKey = 'unit_price';
    }
  });

  return Array.from(map.values()).sort((a, b) => Number(a.index ?? 999) - Number(b.index ?? 999));
}

export function getVendorPreviewValue(row, vendor, key) {
  if (!row) return '';
  const priceMap = row.vendor_prices || row.vendorPrices || row.vendor_unit_prices || row.vendorUnitPrices;
  const amountMap = row.vendor_amounts || row.vendorAmounts;
  const quantityMap = row.vendor_quantities || row.vendorQuantities || row.vendor_qty || row.vendorQty;
  if (key === 'spec') return row[vendor.specKey] || row.spec || '';
  if (key === 'quantity') {
    if (vendor.quantityKey && row[vendor.quantityKey] !== undefined && row[vendor.quantityKey] !== '') return row[vendor.quantityKey];
    if (quantityMap && typeof quantityMap === 'object') {
      if (quantityMap[vendor.name] !== undefined) return quantityMap[vendor.name];
      const matched = Object.entries(quantityMap).find(([name]) => comparableCompanyName(name) === comparableCompanyName(vendor.name));
      if (matched) return matched[1];
    }
    return row.quantity || row.request_quantity || row.requested_quantity || '';
  }
  if (key === 'unit_price') {
    if (vendor.unitPriceKey && row[vendor.unitPriceKey] !== undefined && row[vendor.unitPriceKey] !== '') return row[vendor.unitPriceKey];
    if (priceMap && typeof priceMap === 'object') {
      if (priceMap[vendor.name] !== undefined) return priceMap[vendor.name];
      const matched = Object.entries(priceMap).find(([name]) => comparableCompanyName(name) === comparableCompanyName(vendor.name));
      if (matched) return matched[1];
      return vendor.inlinePrice ?? '';
    }
    const nameMatches = comparableCompanyName(row.vendor_name || row.target_name || '') === comparableCompanyName(vendor.name);
    return nameMatches || !row.vendor_name ? (row.vendor_unit_price || row.unit_price || vendor.inlinePrice || '') : (vendor.inlinePrice || '');
  }
  if (key === 'amount') {
    if (vendor.amountKey && row[vendor.amountKey] !== undefined && row[vendor.amountKey] !== '') return row[vendor.amountKey];
    if (amountMap && typeof amountMap === 'object') {
      if (amountMap[vendor.name] !== undefined) return amountMap[vendor.name];
      const matched = Object.entries(amountMap).find(([name]) => comparableCompanyName(name) === comparableCompanyName(vendor.name));
      if (matched) return matched[1];
    }
    const existing = row.amount && comparableCompanyName(row.vendor_name || row.target_name || '') === comparableCompanyName(vendor.name) ? row.amount : '';
    if (existing) return existing;
    const qty = toPreviewNumber(getVendorPreviewValue(row, vendor, 'quantity'));
    const price = toPreviewNumber(getVendorPreviewValue(row, vendor, 'unit_price'));
    return qty && price ? qty * price : '';
  }
  return row[key] || '';
}

export function buildTemplateVendorSlots(vendors, layoutMode) {
  const cleanVendors = vendors.filter((vendor) => vendor?.name);
  // 실제 업체명이 1개 이상 있으면 미사용 업체 슬롯은 만들지 않는다.
  // A/B/C업체 fallback은 분석/요청/preview 업체명이 전혀 없을 때만 표시한다.
  const minSlots = cleanVendors.length > 0 ? cleanVendors.length : (layoutMode === 'COMPACT_VENDOR_GROUPS' ? 1 : 3);
  const slots = [...cleanVendors];
  while (slots.length < minSlots) slots.push({ name: slots.length === 0 ? 'A업체' : `${String.fromCharCode(65 + slots.length)}업체`, empty: true });
  return slots;
}

// ─── Vendor edit helpers ──────────────────────────────────────────────────────

export function vendorEditKey(vendor = {}, fieldKey = '', vendorIndex = 0) {
  const idx = Number.isFinite(Number(vendor.index)) ? Number(vendor.index) + 1 : vendorIndex + 1;
  if (fieldKey === 'spec') return vendor.specKey || 'spec';
  if (fieldKey === 'quantity') return vendor.quantityKey || 'quantity';
  if (fieldKey === 'unit_price') return vendor.unitPriceKey || `vendor_${idx}_unit_price`;
  if (fieldKey === 'amount') return vendor.amountKey || `vendor_${idx}_amount`;
  return fieldKey;
}

// removeRowButton returns JSX so it needs React
import { createElement } from 'react';
export function removeRowButton(removeRow, rowIndex, disabled) {
  if (!removeRow) return null;
  return createElement(
    'button',
    {
      type: 'button',
      onClick: (event) => { event.stopPropagation(); removeRow(rowIndex); },
      disabled,
      className: 'ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-[11px] font-black text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 disabled:opacity-40',
      title: '행 삭제',
    },
    '×'
  );
}

// ─── Template display helpers ─────────────────────────────────────────────────

export function getTemplateDisplayName(selectedTemplate) {
  return String(
    selectedTemplate?.templateName
    || selectedTemplate?.template_name
    || selectedTemplate?.name
    || selectedTemplate?.title
    || ''
  );
}

export function normalizeAiPreviewFieldKey(fieldKey = '') {
  const key = String(fieldKey || '').trim();
  if (key === 'vendor_unit_price') return 'unit_price';
  if (key === 'vendor_amount') return 'amount';
  return key;
}

export function uniqueAiPreviewFields(items = [], excludeKeys = []) {
  const exclude = new Set(excludeKeys.map((key) => String(key || '').trim()));
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = normalizeAiPreviewFieldKey(item?.fieldKey || item?.field_key || item?.key);
    if (!key || exclude.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ fieldKey: key, label: item?.label || item?.field_label || item?.name || key });
  });
  return out;
}

export function getAiPreviewLowest(row, vendors) {
  let best = null;
  vendors.filter((vendor) => !vendor.empty).forEach((vendor) => {
    const price = toPreviewNumber(getVendorPreviewValue(row, vendor, 'unit_price'));
    if (!price) return;
    if (!best || price < best.price) best = { vendor: vendor.name, price };
  });
  return best || { vendor: '', price: '' };
}

export function getAiPreviewCellValue(row, fieldKey, rowIndex, vendors) {
  if (fieldKey === 'row_no' || fieldKey === 'no') return row?.row_no || row?.no || rowIndex + 1;
  if (fieldKey === 'lowest_target' || fieldKey === 'lowest_vendor' || fieldKey === 'selected_vendor') {
    const lowest = getAiPreviewLowest(row, vendors);
    return row?.lowest_target || row?.lowest_vendor || row?.selected_vendor || lowest.vendor || '';
  }
  if (fieldKey === 'calculated_unit_price' || fieldKey === 'lowest_unit_price') {
    const lowest = getAiPreviewLowest(row, vendors);
    return row?.calculated_unit_price || row?.lowest_unit_price || lowest.price || '';
  }
  return row?.[fieldKey] ?? '';
}

// ─── Template type detectors ──────────────────────────────────────────────────

export function isProductPriceSurveyTemplate(selectedTemplate) {
  const raw = getTemplateDisplayName(selectedTemplate);
  const normalized = compactText(raw).replace(/[()_\-·ㆍ\[\]{}]/g, '');
  if (!normalized) return false;
  const hasVendor = /(업체별|업체|회사별|거래처별|vendor|company|supplier)/i.test(normalized);
  const hasPriceSurvey = /(제품가격|제품단가|가격조사|조사현황|가격현황|단가조사|productprice|pricesurvey|survey)/i.test(normalized);
  return hasVendor && hasPriceSurvey;
}

export function isComparisonEstimateTemplate(selectedTemplate) {
  if (!selectedTemplate) return false;
  if (isProductPriceSurveyTemplate(selectedTemplate)) return false;
  const mapping = selectedTemplate.mapping || selectedTemplate.mappingJson || selectedTemplate.mapping_json || {};
  const raw = [
    getTemplateDisplayName(selectedTemplate),
    selectedTemplate?.originalFileName,
    selectedTemplate?.original_file_name,
    selectedTemplate?.templateCode,
    selectedTemplate?.template_code,
    selectedTemplate?.templateType,
    selectedTemplate?.template_type,
    mapping?.layout,
    mapping?.layoutType,
    mapping?.templateType,
  ].filter(Boolean).join(' ');
  const normalized = compactText(raw).replace(/[()_\-·ㆍ\[\]{}]/g, '');
  if (!normalized) return false;
  return /(비교견적|견적비교|비교서|비교표|비교|견적서|견적|comparison|estimate|quote)/i.test(normalized);
}

export function buildProductPriceVendorSlots(vendors, templateLayoutMode) {
  const cleanVendors = vendors.filter((vendor) => vendor?.name);
  const slotCount = templateLayoutMode === 'COMPACT_VENDOR_GROUPS'
    ? Math.max(cleanVendors.length, 1)
    : Math.max(5, cleanVendors.length || 0);
  const slots = [...cleanVendors];
  while (slots.length < slotCount) slots.push({ name: `업체 ${slots.length + 1}`, empty: true });
  return slots;
}

export function pickRowValue(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

export function getProductPriceAverage(row, vendors) {
  const explicit = pickRowValue(row, ['average_price', 'avg_price', 'average_unit_price', '평균가격', '평균단가'], '');
  if (explicit !== '') return explicit;
  const prices = vendors
    .filter((vendor) => !vendor.empty)
    .map((vendor) => toPreviewNumber(getVendorPreviewValue(row, vendor, 'unit_price')))
    .filter((value) => value > 0);
  if (!prices.length) return '';
  return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
}

export function getSelectedVendorValue(row, vendors = []) {
  const explicit = cleanTableColumnLabel(pickRowValue(row, [
    'selected_vendor',
    'selected_company',
    'chosen_vendor',
    'lowest_vendor',
    'lowest_target',
    'best_vendor',
    'vendor_selection',
    '업체선정',
    '최저업체'
  ], ''));
  if (explicit) return explicit;
  const candidates = (Array.isArray(vendors) ? vendors : [])
    .filter((vendor) => vendor && !vendor.empty)
    .map((vendor) => ({ vendor, price: toPreviewNumber(getVendorPreviewValue(row, vendor, 'unit_price')) }))
    .filter((item) => item.price > 0);
  if (!candidates.length) return '';
  candidates.sort((a, b) => a.price - b.price);
  return cleanTableColumnLabel(candidates[0].vendor.name || '');
}

// ─── Design classification ────────────────────────────────────────────────────

export function designBaseColumns(design = {}, table = {}) {
  const raw = Array.isArray(design.baseColumns) && design.baseColumns.length
    ? design.baseColumns
    : (table.columns || []).map((col) => ({ fieldKey: col.key, label: col.label || col.key }));
  const seen = new Set();
  return raw.map((item) => ({ key: normalizeAiPreviewFieldKey(item.fieldKey || item.key), label: item.label || item.fieldLabel || item.key || item.fieldKey }))
    .filter((item) => item.key && !seen.has(item.key) && seen.add(item.key));
}

export function classifyDesign(layout = '') {
  const text = String(layout || '').toUpperCase();
  if (text.includes('VENDOR_COMPARISON_REVIEW') || text.includes('VENDOR_COMPARE_REVIEW')) return '비교 검토보고서';
  if (text.includes('REVIEW_OPINION')) return '검토 의견서';
  if (text.includes('DYNAMIC_VENDOR') || (text.includes('VENDOR') && !text.includes('REVIEW'))) return '업체 반복';
  if (text.includes('ESTIMATE')) return '견적서';
  if (text.includes('PRICE') || text.includes('UNIT')) return '단가표';
  if (text.includes('MEETING')) return '회의록';
  if (text.includes('OFFICIAL')) return '공문';
  if (text.includes('REPORT') || text.includes('SECTION') || text.includes('APPROVAL')) return '보고서';
  return '기본 표';
}

export function getRowItemName(row = {}) {
  return row.item_name || row.work_item_name || row.product_name || row.material_name || row.title || row.agenda || '';
}
