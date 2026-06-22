const path = require('path');
const { analyzeWithAiServer, chatWithAiServer } = require('./aiServerService');

const defaultColumns = [
  { key: 'vendor_name', label: '업체명' },
  { key: 'item_name', label: '품목명' },
  { key: 'spec', label: '규격' },
  { key: 'quantity', label: '수량' },
  { key: 'unit', label: '단위' },
  { key: 'unit_price', label: '단가' },
  { key: 'amount', label: '금액' },
  { key: 'remark', label: '비고' }
];

const referenceGuidelineColumns = [
  { key: 'section', label: '구분/장절' },
  { key: 'basis_item', label: '기준 항목' },
  { key: 'application_basis', label: '적용 기준' },
  { key: 'calculation_method', label: '계산/적용 방식' },
  { key: 'unit_price_basis', label: '단가 기준' },
  { key: 'source_page', label: '근거 페이지' },
  { key: 'remark', label: '비고' }
];

const standardMarketColumns = [
  { key: 'construction_code', label: '공종코드' },
  { key: 'item_name', label: '공종명칭' },
  { key: 'spec', label: '규격' },
  { key: 'unit', label: '단위' },
  { key: 'unit_price', label: '단가' },
  { key: 'labor_ratio', label: '노무비율' },
  { key: 'remark', label: '비고' }
];

const referenceTableTypes = new Set(['REFERENCE_GUIDELINE_TABLE', 'GUIDELINE_SUMMARY_TABLE']);
const standardMarketTableTypes = new Set(['STANDARD_MARKET_PRICE_TABLE']);
const multiVendorCompareTableTypes = new Set(['MULTI_VENDOR_PRICE_COMPARISON']);

function columnsForTableType(tableType) {
  if (referenceTableTypes.has(tableType)) return referenceGuidelineColumns;
  if (standardMarketTableTypes.has(tableType)) return standardMarketColumns;
  if (multiVendorCompareTableTypes.has(tableType)) return defaultColumns; // AI 서버가 동적 업체 컬럼을 내려주므로 fallback만 둔다.
  return defaultColumns;
}


function pruneEmptyColumns(columns = [], rows = []) {
  if (!Array.isArray(columns) || !columns.length) return defaultColumns;
  if (!Array.isArray(rows) || !rows.length) return columns;
  const visible = columns.filter((col) => rows.some((row) => String(row?.[col.key] ?? '').trim() !== ''));
  return visible.length ? visible : columns;
}

function fallbackAnalysis(files, userRequest) {
  const rows = files.map((file, index) => ({
    vendor_name: '',
    item_name: path.basename(file.originalname || `file_${index + 1}`, path.extname(file.originalname || '')),
    source_file_name: file.originalname || `file_${index + 1}`,
    spec: '',
    quantity: '1',
    unit: '',
    unit_price: '',
    amount: '',
    remark: 'AI 서버 미연결 fallback 결과'
  }));

  return {
    analysis: {
      documentType: '업무 문서',
      purpose: userRequest || '문서 데이터 엑셀화',
      summary: 'AI 서버 연결에 실패하여 파일명 기준으로 기본 표 후보를 생성했습니다. 실제 운영에서는 ai-server를 함께 실행하세요.',
      confidence: 0.55,
      keyValues: []
    },
    tables: [{ tableName: '기본 표 후보', columns: defaultColumns, rows, tableType: 'NORMAL_TABLE' }],
    issues: [{ rowIndex: 0, issueType: 'AI_SERVER_FALLBACK', severity: 'WARNING', message: 'AI 서버 결과가 아니므로 표 데이터를 확인하세요.' }],
    files: files.map((file) => ({
      originalName: file.originalname,
      storedName: '',
      savedPath: '',
      fileType: path.extname(file.originalname || '').replace('.', ''),
      mimeType: file.mimetype,
      fileSize: file.size,
      extractedText: '',
      pages: []
    }))
  };
}

async function analyzeDocuments(payload) {
  try {
    return await analyzeWithAiServer(payload);
  } catch (error) {
    console.error('[AI SERVER ANALYZE FAILED]', error?.response?.data || error.message);
    return fallbackAnalysis(payload.files || [], payload.userRequest);
  }
}

function toNumber(value) {
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

const REVIEW_UNITS = new Set(['BOX', 'SET', 'LOT', '식', '롤', '포', '봉', '박스']);

function normalizeUnit(value) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const compact = text
    .replace(/㎥/g, 'm3')
    .replace(/㎡/g, 'm2')
    .replace(/m²/gi, 'm2')
    .replace(/m³/gi, 'm3')
    .replace(/\s+/g, '')
    .toUpperCase();
  const map = {
    EA: '개', PCS: '개', PC: '개', '개': '개', '매': '개', '장': '개', '대': '개', '조': '개', '개소': '개소',
    M: 'm', '미터': 'm', MM: 'mm', CM: 'cm', KM: 'km',
    M2: '㎡', 'M^2': '㎡', '평': '평', M3: '㎥', 'M^3': '㎥', '공M3': '공㎥', '공M^3': '공㎥', '공㎥': '공㎥',
    KG: 'kg', G: 'g', TON: 'ton', '톤': 'ton',
    BOX: 'BOX', '박스': 'BOX', SET: 'SET', '세트': 'SET', LOT: 'LOT', '식': '식', '본': '본', '롤': '롤', '포': '포', '봉': '봉',
    HR: '시간', H: '시간', '시간': '시간', MD: 'MD', '공수': 'MD', '인': '인', '명': '인'
  };
  if (/^공M3$/i.test(compact)) return '공㎥';
  if (/^M2$/i.test(compact)) return '㎡';
  if (/^M3$/i.test(compact)) return '㎥';
  if (/개소$/.test(text)) return '개소';
  return map[compact] || text;
}


function validateTable(table) {
  const issues = [];
  const rows = table.rows || [];
  const tableType = table.tableType || table.table_type || 'NORMAL_TABLE';
  if (referenceTableTypes.has(tableType) || standardMarketTableTypes.has(tableType) || multiVendorCompareTableTypes.has(tableType)) return issues;
  const unitsByItem = new Map();

  rows.forEach((row, index) => {
    const quantity = toNumber(row.quantity);
    const unitPrice = toNumber(row.unit_price);
    const amount = toNumber(row.amount);
    const normalizedUnit = normalizeUnit(row.unit_normalized || row.unit);

    if (quantity && unitPrice && amount && Math.abs(quantity * unitPrice - amount) > 1) {
      issues.push({
        rowIndex: index,
        issueType: 'AMOUNT_MISMATCH',
        severity: 'WARNING',
        fieldKey: 'amount',
        fieldLabel: '금액',
        message: `${index + 1}행 금액 확인 필요: 수량×단가=${(quantity * unitPrice).toLocaleString()} / 입력 금액=${amount.toLocaleString()}`
      });
    }

    if (tableType === 'PRICE_COMPARISON' && normalizedUnit && REVIEW_UNITS.has(normalizedUnit)) {
      issues.push({
        rowIndex: index,
        issueType: 'UNIT_REVIEW_REQUIRED',
        severity: 'WARNING',
        fieldKey: 'unit',
        fieldLabel: '단위',
        message: `${index + 1}행 단위 '${row.unit || row.unit_original || normalizedUnit}'는 환산 기준 확인이 필요합니다.`
      });
    }

    const itemName = String(row.item_name || '').trim();
    if (tableType === 'PRICE_COMPARISON' && itemName && normalizedUnit && String(row.vendor_name || '').trim()) {
      if (!unitsByItem.has(itemName)) unitsByItem.set(itemName, new Set());
      unitsByItem.get(itemName).add(normalizedUnit);
    }
  });

  if (tableType === 'PRICE_COMPARISON' && rows.filter((row) => String(row.vendor_name || '').trim()).length >= 2) {
    for (const [itemName, units] of unitsByItem.entries()) {
      if (units.size >= 2) {
        issues.push({
          rowIndex: null,
          issueType: 'UNIT_MISMATCH_BETWEEN_VENDORS',
          severity: 'WARNING',
          fieldKey: 'unit',
          fieldLabel: '단위',
          message: `'${itemName}' 품목은 업체별 단위가 달라 직접 단가 비교 전에 환산 기준 확인이 필요합니다. 단위=${Array.from(units).join(', ')}`
        });
      }
    }
  }
  return issues;
}

function hasAnalyzedDocument(context = {}) {
  if (context.hasDocument === true || context.hasJob === true) return true;
  const analysis = context.analysis || null;
  const table = context.table || null;
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const docType = String(analysis?.documentType || analysis?.document_type || '').trim();
  if (docType && !['대기', '문서 분석 대기', '미분석'].includes(docType)) return true;
  return rows.length > 0;
}

function detectChatIntent(message) {
  const text = String(message || '').trim();
  if (/(너는|넌).*(뭐|무엇|누구|하는|할 수)|뭐하는\s*(ai|에이아이)|기능|도와줄|할수있|할 수 있|소개/i.test(text)) return 'SELF_INTRO';
  if (/^(안녕|하이|hello|hi|반가워|ㅎㅇ)\b|안녕하세요/i.test(text)) return 'GREETING';
  if (/단가|비교|최저|가격|견적/i.test(text)) return 'PRICE_COMPARE';
  if (/이\s*문서|문서\s*(뭐|무슨|요약|내용)|뭐야|무슨\s*문서|내용|요약/i.test(text)) return 'DOCUMENT_QA';
  if (/확인|오류|문제|검토|이슈|누락/i.test(text)) return 'ISSUE_CHECK';
  if (/표|테이블|정리/i.test(text)) return 'TABLE_CREATE';
  if (/엑셀|xlsx|양식|산출/i.test(text)) return 'EXCEL_CREATE';
  return 'GENERAL';
}

function fallbackChat(message, context = {}, errorMessage = '') {
  const hasDocument = hasAnalyzedDocument(context);
  const analysis = hasDocument ? (context.analysis || {}) : {};
  const table = hasDocument ? (context.table || {}) : {};
  const issues = hasDocument ? (context.issues || []) : [];
  const text = String(message || '').trim();
  const intent = detectChatIntent(text);

  const base = {
    llmUsed: false,
    llmFallback: true,
    llmError: errorMessage
  };

  if (intent === 'GREETING' || intent === 'SELF_INTRO') {
    return {
      ...base,
      answer: '안녕하세요. 저는 문서를 엑셀화하기 위한 AI 작업 채팅입니다. PDF·엑셀·문서 파일을 기준으로 문서 유형 확인, 표 추출, 단가 비교, 금액/단위 검증, 확인 필요 항목 정리를 도와드립니다.',
      intent,
      needsFile: false,
      action: 'NONE',
      recommendedTab: null,
      quickReplies: ['이 문서 뭐야?', '단가만 비교해줘', '확인 필요한 부분만 보여줘']
    };
  }

  if (intent === 'DOCUMENT_QA') {
    if (hasDocument) {
      return {
        ...base,
        answer: `현재 문서는 ${analysis.documentType || '업무 문서'}로 보입니다. ${analysis.summary || ''} 확인 필요 항목은 ${issues.length || 0}건입니다.`,
        intent: 'DOCUMENT_QA',
        needsFile: false,
        action: 'SHOW_ANALYSIS',
        recommendedTab: 'analysis',
        quickReplies: ['표로 만들어줘', '단가만 비교해줘']
      };
    }
    return {
      ...base,
      answer: '아직 분석된 문서가 없습니다. 파일을 첨부해서 분석을 실행하면 문서 유형과 핵심 내용을 답변할 수 있습니다.',
      intent: 'DOCUMENT_QA',
      needsFile: true,
      action: 'REQUEST_FILE',
      recommendedTab: null,
      quickReplies: ['파일 첨부 후 이 문서 뭐야?', '표로 만들어줘']
    };
  }

  if (intent === 'PRICE_COMPARE') {
    const rows = table.rows || [];
    if (!rows.length) {
      return {
        ...base,
        answer: '비교할 표 데이터가 아직 없습니다. 파일을 첨부하고 문서 분석을 먼저 실행하세요.',
        intent: 'PRICE_COMPARE',
        needsFile: true,
        action: 'REQUEST_FILE',
        recommendedTab: null,
        quickReplies: ['파일 첨부', '표로 만들어줘']
      };
    }
    return {
      ...base,
      answer: `현재 표 데이터 ${rows.length}행 기준으로 단가 비교가 가능합니다. 단위가 다른 행은 환산 기준 확인 후 비교해야 합니다.`,
      intent: 'PRICE_COMPARE',
      needsFile: false,
      action: 'SHOW_TABLE',
      recommendedTab: 'table',
      quickReplies: ['금액 다시 확인', '확인 필요한 부분만 보여줘']
    };
  }

  return {
    ...base,
    answer: '요청을 확인했습니다. 문서 분석 결과가 있으면 해당 표와 이슈 기준으로 답변하겠습니다.',
    intent,
    needsFile: false,
    action: 'NONE',
    recommendedTab: null,
    quickReplies: ['이 문서 뭐야?', '단가만 비교해줘']
  };
}

async function chatWithDocuments({ message, context }) {
  try {
    return await chatWithAiServer({ message, context });
  } catch (error) {
    console.error('[AI SERVER CHAT FAILED]', error?.response?.data || error.message);
    return fallbackChat(message, context, error.message);
  }
}


module.exports = { analyzeDocuments, validateTable, defaultColumns, referenceGuidelineColumns, standardMarketColumns, columnsForTableType, pruneEmptyColumns, chatWithDocuments };
