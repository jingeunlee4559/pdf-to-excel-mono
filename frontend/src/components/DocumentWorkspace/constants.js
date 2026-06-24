export const emptyAnalysis = {
  summary: '아직 분석된 문서가 없습니다. 오른쪽 영역에서 파일과 요청 내용을 입력한 뒤 분석을 실행하세요.',
  documentType: '대기',
  confidence: 0,
  tableCount: 0,
  issueCount: 0,
  purpose: '문서 분석 대기',
  keyValues: [],
  fileProfiles: [],
  llmUsage: null,
  llmUsed: false,
  llmIntentUsed: false,
  narrativeReport: null,
};

export const defaultColumns = [
  { key: 'vendor_name', label: '업체명' },
  { key: 'item_name', label: '품목명' },
  { key: 'spec', label: '규격' },
  { key: 'quantity', label: '수량' },
  { key: 'unit', label: '단위' },
  { key: 'unit_price', label: '단가' },
  { key: 'amount', label: '금액' },
  { key: 'remark', label: '비고' }
];

export const backgroundStatuses = new Set(['QUEUED', 'PROCESSING', 'PARSING', 'ANALYZING', 'VALIDATING']);
export const completeStatuses = new Set(['READY_TO_GENERATE', 'NEED_REVIEW', 'GENERATED', 'FAILED']);

export const SYSTEM_DEFAULT_TEMPLATE_CODES = new Set([
  'NORMAL_TABLE_V1', 'COMPARISON_MATRIX_V1', 'WORK_LOG_TABLE_V1',
  'ESTIMATE_FORM_V1', 'UNIT_PRICE_TABLE_V1', 'BUSINESS_REPORT_V1',
  'MEETING_MINUTES_V1', 'OFFICIAL_LETTER_V1'
]);
