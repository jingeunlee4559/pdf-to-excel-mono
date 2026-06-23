import { useEffect, useMemo, useRef, useState } from 'react';
import { createAiTemplateApi, createChatSessionApi, createDocumentJobApi, deleteChatSessionApi, excelDownloadUrl, generateExcelApi, getChatSessionApi, getDocumentJobApi, listChatSessionsApi, listDownloadsApi, revalidateJobApi, sendAiChatApi, updateCandidateFieldApi, updateTableApi } from '../../api/documentApi.js';
import { listTemplatesApi } from '../../api/templateApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { buildLayoutCandidates, scoreLayoutAgainstText, LAYOUT_REGISTRY, normalizeLayoutForPreview } from '../../utils/layoutRegistry.js';

const emptyAnalysis = {
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
  llmIntentUsed: false
};

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

const isReferenceTableType = (tableType) => ['REFERENCE_GUIDELINE_TABLE', 'GUIDELINE_SUMMARY_TABLE'].includes(tableType);
const isStandardMarketTableType = (tableType) => tableType === 'STANDARD_MARKET_PRICE_TABLE';
const isMultiVendorCompareTableType = (tableType) => tableType === 'MULTI_VENDOR_PRICE_COMPARISON';
const isTextVendorComparisonReportType = (tableType) => tableType === 'TEXT_VENDOR_COMPARISON_REPORT';

const tableTypeLabel = (tableType) => {
  if (isReferenceTableType(tableType)) return '기준서 항목 표';
  if (isStandardMarketTableType(tableType)) return '표준시장단가 표';
  if (isMultiVendorCompareTableType(tableType)) return '업체별 단가 비교표';
  if (isTextVendorComparisonReportType(tableType)) return '서술형 비교 요약';
  return '추출 결과';
};


const getVisibleColumns = (columns = [], rows = []) => {
  // 빈 컬럼 제거는 백엔드가 columns_json을 갱신해서 처리한다.
  // 프론트에서 매번 행 값을 보고 숨기면, 사용자가 채팅으로 다시 추가한 컬럼이
  // 값 입력 전에는 즉시 사라지는 문제가 생긴다.
  if (!Array.isArray(columns) || !columns.length) return defaultColumns;
  return columns;
};

const makeFileKey = (file) => `${file.name}__${file.size}__${file.lastModified || 0}`;

const toChatFile = (file) => ({
  name: file.name,
  size: file.size,
  type: file.type || '',
  lastModified: file.lastModified || 0
});


const normalizeServerMessages = (messages = []) => {
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

const welcomeMessage = () => ({
  id: 'welcome',
  role: 'assistant',
  content: '선택한 양식 기준으로 문서를 분석합니다. 파일을 첨부하거나 “기준 항목 표로 정리해줘”, “단가 기준만 표로 정리해줘”처럼 입력해보세요.',
  quickReplies: ['기준 항목 표로 정리해줘', '단가 기준만 표로 정리해줘', '이 문서 뭐야?']
});

const mergeFileList = (prevFiles, nextFileList) => {
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

const backgroundStatuses = new Set(['QUEUED', 'PROCESSING', 'PARSING', 'ANALYZING', 'VALIDATING']);
const completeStatuses = new Set(['READY_TO_GENERATE', 'NEED_REVIEW', 'GENERATED', 'FAILED']);

const isBackgroundRunning = (status) => backgroundStatuses.has(String(status || '').toUpperCase());

const statusLabel = (status) => {
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

const SYSTEM_DEFAULT_TEMPLATE_CODES = new Set([
  'NORMAL_TABLE_V1', 'COMPARISON_MATRIX_V1', 'WORK_LOG_TABLE_V1',
  'ESTIMATE_FORM_V1', 'UNIT_PRICE_TABLE_V1', 'BUSINESS_REPORT_V1',
  'MEETING_MINUTES_V1', 'OFFICIAL_LETTER_V1'
]);

function isSystemDefaultTemplate(template = {}) {
  const code = String(template.templateCode || template.template_code || '').toUpperCase();
  const mapping = template.mapping || template.mappingJson || template.mapping_json || {};
  return SYSTEM_DEFAULT_TEMPLATE_CODES.has(code) || Boolean(mapping?.locked);
}

function isUserRegisteredCompanyTemplate(template = {}) {
  if (!template) return false;
  if (isAiGeneratedTemplate(template)) return false;
  if (isSystemDefaultTemplate(template)) return false;
  const code = String(template.templateCode || template.template_code || '').toUpperCase();
  if (code.startsWith('AI_')) return false;
  return true;
}


function cleanTableColumnLabel(label = '') {
  return String(label || '')
    .replace(/^\s*[A-Z]\s*회사\s*[·ㆍ:：\-–—]*\s*/i, '')
    .replace(/^\s*[A-Z]\s*회사(?=㈜|\(주\)|주식회사|[가-힣A-Za-z0-9])/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}


function detectDocumentDesignType({ analysis = {}, table = {}, userRequest = '' } = {}) {
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

function buildDefaultDesignCandidates({ analysis = {}, table = {}, userRequest = '' } = {}) {
  return buildLayoutCandidates({ analysis, table, userRequest });
}

function templateToAiDesignCandidate(template) {
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

function getRecommendationContextText(context = {}) {
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

function recomputeDesignScore(item = {}, context = {}, defaults = []) {
  const contextText = getRecommendationContextText(context);
  const layoutType = String(item.layoutType || item.layout_type || item.templateType || item.template_type || item.layout || '').toUpperCase();
  const matchedDefault = defaults.find((candidate) => String(candidate.layoutType || candidate.layout || '').toUpperCase() === layoutType || String(candidate.designId || '').toUpperCase() === String(item.designId || item.design_id || '').toUpperCase());
  if (matchedDefault) return Number(matchedDefault.score || item.score || 0);
  const registryItem = LAYOUT_REGISTRY.find((candidate) => candidate.layoutType === layoutType);
  const mainType = defaults[0]?.mainType || '';
  if (registryItem && contextText) return scoreLayoutAgainstText(registryItem, contextText, mainType);
  return Number(item.score || 0);
}

function mergeAiDesignOptions(designCandidates = [], templates = [], context = {}) {
  const defaults = buildDefaultDesignCandidates(context);
  // AI 추천양식은 현재 문서 분석 결과 + layout registry 상위 후보만 사용한다.
  // AI 서버가 과거 점수로 보낸 후보도 프론트에서 현재 문서 기준으로 다시 점수화한다.
  const list = [...(designCandidates || []), ...defaults];
  const seenIds = new Set();
  const seenSemantic = new Set();
  return list
    .filter((item) => item && (item.designId || item.name || item.layout))
    .map((item, index) => {
      const layoutType = String(item.layoutType || item.layout_type || item.templateType || item.template_type || item.layout || 'BASIC_TABLE').toUpperCase();
      const layout = normalizeLayoutForPreview(layoutType);
      return {
        ...item,
        designId: String(item.designId || item.design_id || layoutType || item.name || `AI_DESIGN_${index}`),
        name: item.name || item.templateName || item.title || `AI 양식 ${index + 1}`,
        layoutType,
        layout,
        score: recomputeDesignScore({ ...item, layoutType }, context, defaults),
      };
    })
    .filter((item) => Number(item.score || 0) >= 65 || indexSafeLayout(item.layoutType || item.layout))
    .filter((item) => {
      const idKey = String(item.designId || '').toUpperCase();
      const semanticKey = `${String(item.name || '').trim().toUpperCase()}|${String(item.layoutType || item.layout || '').trim().toUpperCase()}`;
      if (seenIds.has(idKey) || seenSemantic.has(semanticKey)) return false;
      seenIds.add(idKey);
      seenSemantic.add(semanticKey);
      return true;
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 5);
}

function indexSafeLayout(layout = '') {
  return ['REPORT_FORM', 'BASIC_TABLE'].includes(String(layout || '').toUpperCase());
}



function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function looksLikeUserFormattingPrompt(value = '') {
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

function sanitizeBusinessPurpose(value = '') {
  const text = firstNonEmpty(value).trim();
  if (!text || looksLikeUserFormattingPrompt(text)) return '';
  return text;
}

function inferBusinessPurposeFromRow(row = {}) {
  const source = firstNonEmpty(row.document_title, row.report_title, row.summary, row.content, row.issue_summary, row.review_opinion);
  const text = String(source || '').replace(/^[•\-–—*\s]+/gm, '').replace(/\s+/g, ' ').trim();
  if (!text || looksLikeUserFormattingPrompt(text)) return '첨부 문서의 주요 내용과 확인 필요 사항을 업무 보고 형식으로 정리합니다.';
  if (/점검|안전|위험|현장|감리/.test(text)) return '첨부 문서의 현장 점검 내용과 확인 필요 사항을 검토하기 위한 보고입니다.';
  if (/견적|단가|금액|업체|비교/.test(text)) return '첨부 문서의 견적·단가·업체 비교 내용을 검토하기 위한 보고입니다.';
  if (/회의|안건|결정|조치/.test(text)) return '첨부 문서의 논의 내용과 후속 조치 사항을 정리하기 위한 보고입니다.';
  return '첨부 문서의 주요 내용과 확인 필요 사항을 업무 보고 형식으로 정리합니다.';
}

function getDraftRowFromAnalysis(analysis = {}, layout = '') {
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

function mergeDraftIntoRows(rows = [], draftRow = null) {
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


export default function DocumentWorkspacePage() {
  const { user } = useAuth();
  const writerName = user?.userName || user?.loginId || '';
  const [templates, setTemplates] = useState([]);
  const [aiTemplateRecommendations, setAiTemplateRecommendations] = useState([]);
  const [aiTemplateDesignCandidates, setAiTemplateDesignCandidates] = useState([]);
  const [candidateFields, setCandidateFields] = useState([]);
  const [selectedDesignId, setSelectedDesignId] = useState('');
  const [aiTemplateCreating, setAiTemplateCreating] = useState(false);
  const [tab, setTab] = useState('analysis');
  const [outputMode, setOutputMode] = useState('FREE_FORM');
  const [templateLayoutMode, setTemplateLayoutMode] = useState('COMPACT_VENDOR_GROUPS');
  const [templateId, setTemplateId] = useState('');
  const [fileName, setFileName] = useState(`엑셀산출물_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [analyzedFiles, setAnalyzedFiles] = useState([]);
  const [userRequest, setUserRequest] = useState('');
  const [job, setJob] = useState(null);
  const [tables, setTables] = useState([]);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [analysis, setAnalysis] = useState(emptyAnalysis);
  const [table, setTable] = useState({ columns: defaultColumns, rows: [] });
  const [issues, setIssues] = useState([]);
  const [sourceText, setSourceText] = useState('');
  const [generatedExcel, setGeneratedExcel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([welcomeMessage()]);
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem('activeDocumentChatSessionId') || '');
  const [downloads, setDownloads] = useState([]);
  const [processingJobs, setProcessingJobs] = useState({});
  const [showResultPanel, setShowResultPanel] = useState(true);
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [showOutputSettings, setShowOutputSettings] = useState(false);
  const chatFileInputRef = useRef(null);
  const pollingTimersRef = useRef({});
  const unmountedRef = useRef(false);

  useEffect(() => {
    listTemplatesApi().then((data) => {
      setTemplates(data.templates || []);
    }).catch(() => setTemplates([]));
    refreshChatSessions();
    refreshDownloads();
    if (activeSessionId) loadChatSession(activeSessionId);
  }, []);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem('activeDocumentChatSessionId', String(activeSessionId));
  }, [activeSessionId]);

  useEffect(() => () => {
    unmountedRef.current = true;
    Object.values(pollingTimersRef.current || {}).forEach((timerId) => clearTimeout(timerId));
  }, []);

  useEffect(() => {
    (chatSessions || []).forEach((session) => {
      if (session?.activeJobId && isBackgroundRunning(session.jobStatus)) {
        startJobPolling(session.activeJobId, session.id);
      }
    });
  }, [chatSessions]);

  const registeredTemplates = useMemo(() => (templates || []).filter(isUserRegisteredCompanyTemplate), [templates]);
  const aiDesignOptions = useMemo(() => mergeAiDesignOptions(aiTemplateDesignCandidates, templates, { analysis, table, userRequest }), [aiTemplateDesignCandidates, templates, analysis, table, userRequest]);
  const selectedTemplate = useMemo(() => registeredTemplates.find((item) => String(item.id) === String(templateId)), [registeredTemplates, templateId]);
  const selectedDesign = useMemo(() => {
    if (!selectedDesignId) return null;
    return aiDesignOptions.find((item) => String(item.designId || '') === String(selectedDesignId || '')) || null;
  }, [aiDesignOptions, selectedDesignId]);

  useEffect(() => {
    if (outputMode !== 'FREE_FORM') return;
    if (templateId) setTemplateId('');
    if (aiDesignOptions.length && !aiDesignOptions.some((item) => String(item.designId || '') === String(selectedDesignId || ''))) {
      setSelectedDesignId(aiDesignOptions[0].designId);
    }
  }, [outputMode, aiDesignOptions, selectedDesignId, templateId]);

  useEffect(() => {
    if (outputMode !== 'COMPANY_TEMPLATE') return;
    if (selectedDesignId) setSelectedDesignId('');
    const hasCurrentTemplate = templateId && registeredTemplates.some((item) => String(item.id) === String(templateId));
    if (!hasCurrentTemplate) setTemplateId(registeredTemplates[0]?.id ? String(registeredTemplates[0].id) : '');
  }, [outputMode, selectedDesignId, templateId, registeredTemplates]);

  const changeOutputMode = (value) => {
    setOutputMode(value);
    if (value === 'COMPANY_TEMPLATE') {
      setSelectedDesignId('');
      const nextTemplateId = templateId && registeredTemplates.some((item) => String(item.id) === String(templateId))
        ? templateId
        : registeredTemplates[0]?.id;
      setTemplateId(nextTemplateId ? String(nextTemplateId) : '');
      return;
    }
    setTemplateId('');
    const nextDesignId = selectedDesignId && aiDesignOptions.some((item) => String(item.designId || '') === String(selectedDesignId || ''))
      ? selectedDesignId
      : aiDesignOptions[0]?.designId;
    setSelectedDesignId(nextDesignId ? String(nextDesignId) : '');
    setTab('excel');
  };

  useEffect(() => {
    if (tab === 'table') setTab('excel');
  }, [tab]);

  const refreshDownloads = async () => {
    try {
      const data = await listDownloadsApi();
      setDownloads(data.downloads || []);
    } catch (_) {
      setDownloads([]);
    }
  };

  const refreshChatSessions = async () => {
    try {
      const data = await listChatSessionsApi();
      const sessions = data.sessions || [];
      setChatSessions(sessions);
      const saved = localStorage.getItem('activeDocumentChatSessionId');
      const target = saved && sessions.some((item) => String(item.id) === String(saved)) ? saved : (sessions[0]?.id ? String(sessions[0].id) : '');
      if (target && !activeSessionId) {
        await loadChatSession(target);
      }
    } catch (_) {
      setChatSessions([]);
    }
  };

  const loadChatSession = async (sessionId) => {
    if (!sessionId) return;
    try {
      const data = await getChatSessionApi(sessionId);
      const session = data.session;
      setActiveSessionId(String(session.id));
      setChatMessages(normalizeServerMessages(session.messages || []));
      if (session.activeJob) {
        bindJobResult(session.activeJob);
        setGeneratedExcel(session.activeJob.excels?.[0] || null);
        if (isBackgroundRunning(session.activeJob.status)) startJobPolling(session.activeJob.id, session.id);
      }
    } catch (err) {
      setMessage(err.response?.data?.message || '채팅을 불러오지 못했습니다.');
    }
  };

  const startNewChat = async () => {
    try {
      setLoading(true);
      const data = await createChatSessionApi({ title: '새 문서 작업' });
      const session = data.session;
      setActiveSessionId(String(session.id));
      localStorage.setItem('activeDocumentChatSessionId', String(session.id));
      setChatMessages(normalizeServerMessages(session.messages || []));
      setJob(null);
      setAiTemplateRecommendations([]);
      setTables([]);
      setSelectedTableIndex(0);
      setAnalysis(emptyAnalysis);
      setTable({ columns: defaultColumns, rows: [] });
      setIssues([]);
      setAnalyzedFiles([]);
      setSourceText('');
      setGeneratedExcel(null);
      setPendingFiles([]);
      await refreshChatSessions();
    } catch (err) {
      setMessage(err.response?.data?.message || '새 채팅을 만들지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setPendingFiles((prev) => mergeFileList(prev, incoming));
    setMessage('파일이 첨부되었습니다. 채팅창에는 첨부 파일명이 표시되고, 하단의 첨부 아이콘으로 목록을 펼쳐 관리할 수 있습니다.');
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearPendingFiles = () => {
    setPendingFiles([]);
  };


  const updateProcessingState = (jobId, status, title) => {
    if (!jobId) return;
    setProcessingJobs((prev) => {
      const next = { ...prev };
      if (isBackgroundRunning(status)) {
        next[jobId] = { id: jobId, status, title: title || `작업 ${jobId}` };
      } else {
        delete next[jobId];
      }
      return next;
    });
  };

  const deleteChatSession = async (sessionId) => {
    if (!sessionId) return;
    if (!window.confirm('이 채팅을 삭제할까요? 연결된 분석 작업/엑셀 파일은 삭제하지 않고 채팅 기록만 삭제합니다.')) return;
    try {
      setLoading(true);
      await deleteChatSessionApi(sessionId);
      if (String(activeSessionId) === String(sessionId)) {
        localStorage.removeItem('activeDocumentChatSessionId');
        setActiveSessionId('');
        setChatMessages([welcomeMessage()]);
      }
      await refreshChatSessions();
      setMessage('채팅을 삭제했습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '채팅 삭제 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const startJobPolling = (jobId, sessionId = activeSessionId) => {
    if (!jobId || pollingTimersRef.current[jobId]) return;
    const poll = async () => {
      try {
        const data = await getDocumentJobApi(jobId);
        const nextJob = data.job;
        if (nextJob) {
          bindJobResult(nextJob);
          updateProcessingState(nextJob.id, nextJob.status, nextJob.title);
          if (completeStatuses.has(String(nextJob.status || '').toUpperCase())) {
            setMessage(nextJob.status === 'FAILED' ? (nextJob.errorMessage || '문서 분석이 실패했습니다.') : '백그라운드 문서 분석이 완료되었습니다. 결과와 채팅이 자동 반영되었습니다.');
            if (nextJob.tables?.length) setTab((current) => (current === 'analysis' ? 'excel' : current));
          }
        }
        if (sessionId) {
          const sessionData = await getChatSessionApi(sessionId);
          if (sessionData.session?.messages) setChatMessages(normalizeServerMessages(sessionData.session.messages));
        }
        await refreshChatSessions();

        if (nextJob && isBackgroundRunning(nextJob.status) && !unmountedRef.current) {
          pollingTimersRef.current[jobId] = setTimeout(poll, 2200);
        } else {
          clearTimeout(pollingTimersRef.current[jobId]);
          delete pollingTimersRef.current[jobId];
          if (nextJob) updateProcessingState(nextJob.id, nextJob.status, nextJob.title);
        }
      } catch (_) {
        if (!unmountedRef.current) pollingTimersRef.current[jobId] = setTimeout(poll, 3500);
      }
    };
    pollingTimersRef.current[jobId] = setTimeout(poll, 700);
  };


  const runAnalysis = async () => {
    setMessage('');
    if (!pendingFiles.length) {
      setMessage('분석할 파일을 먼저 첨부하세요. 파일은 즉시 업로드되지 않고 전송 시 함께 올라갑니다.');
      return;
    }
    const uploadFiles = pendingFiles;
    try {
      setLoading(true);
      const result = await createDocumentJobApi({
        title: uploadFiles[0]?.name || '문서 분석 작업',
        userRequest: userRequest || '첨부한 문서를 분석해줘',
        outputMode,
        templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : '',
        files: uploadFiles,
        chatSessionId: activeSessionId || null
      });
      if (result.job) {
        bindJobResult(result.job);
        updateProcessingState(result.job.id, result.job.status, result.job.title);
        startJobPolling(result.job.id, result.sessionId || activeSessionId || null);
      }
      if (result.sessionId) setActiveSessionId(String(result.sessionId));
      if (result.session?.messages) setChatMessages(normalizeServerMessages(result.session.messages));
      await refreshChatSessions();
      setPendingFiles([]);
      setUserRequest('');
      setTab('analysis');
      setMessage('작업이 백그라운드 대기열에 등록되었습니다. 기다리는 동안 다른 파일 업로드, 채팅, 표 확인을 계속할 수 있습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '문서 분석 작업 등록 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const bindJobResult = (jobData) => {
    if (!jobData) return;
    setJob(jobData);
    const nextRecommendations = Array.isArray(jobData?.aiTemplateRecommendations) ? jobData.aiTemplateRecommendations : [];
    const serverDesigns = Array.isArray(jobData?.aiTemplateDesignCandidates) ? jobData.aiTemplateDesignCandidates : [];
    const nextDesigns = serverDesigns.length ? serverDesigns : buildDefaultDesignCandidates({ analysis: jobData?.analysis || {}, table: jobData?.tables?.[0] || {}, userRequest: jobData?.userRequest || jobData?.user_request || '' });
    setAiTemplateRecommendations(nextRecommendations);
    setAiTemplateDesignCandidates(nextDesigns);
    setCandidateFields(Array.isArray(jobData?.candidateFields) ? jobData.candidateFields : []);
    if (outputMode === 'FREE_FORM' && nextDesigns[0]?.designId && (!selectedDesignId || !nextDesigns.some((item) => String(item.designId || '') === String(selectedDesignId || '')))) setSelectedDesignId(nextDesigns[0].designId);
    const hasAnalysis = Boolean(jobData?.analysis);
    setAnalysis({
      summary: jobData?.analysis?.summary || (isBackgroundRunning(jobData?.status) ? '백그라운드에서 문서를 분석하고 있습니다. 완료되면 결과가 자동으로 표시됩니다.' : emptyAnalysis.summary),
      documentType: jobData?.analysis?.documentType || jobData?.analysis?.document_type || (isBackgroundRunning(jobData?.status) ? statusLabel(jobData?.status) : '업무 문서'),
      confidence: hasAnalysis ? Math.round((Number(jobData?.analysis?.confidence) || 0) * 100) : 0,
      tableCount: jobData?.tables?.length || 0,
      issueCount: jobData?.issues?.length || 0,
      purpose: jobData?.analysis?.purpose || jobData?.analysis?.documentPurpose || '문서 데이터 엑셀화',
      keyValues: jobData?.analysis?.keyValues || [],
      fileProfiles: jobData?.analysis?.fileProfiles || jobData?.analysis?.raw?.fileProfiles || [],
      llmUsage: jobData?.analysis?.llmUsage || jobData?.analysis?.raw?.llmUsage || null,
      llmUsed: Boolean(jobData?.analysis?.llmUsed || jobData?.analysis?.raw?.llmUsed),
      llmIntentUsed: Boolean(jobData?.analysis?.llmIntentUsed || jobData?.analysis?.raw?.llmIntentUsed)
    });
    const resultTables = Array.isArray(jobData?.tables) ? jobData.tables : [];
    setTables(resultTables);
    setSelectedTableIndex(0);
    const firstTable = resultTables[0];
    const draftRow = getDraftRowFromAnalysis(jobData?.analysis || {}, nextDesigns[0]?.layout || '');
    const displayRows = mergeDraftIntoRows(firstTable?.rows || [], draftRow);
    setTable({
      id: firstTable?.id,
      tableName: firstTable?.tableName || firstTable?.table_name || '문서 표 후보',
      tableType: firstTable?.tableType || firstTable?.table_type || 'NORMAL_TABLE',
      page: firstTable?.page || firstTable?.tableJson?.page || null,
      confidence: firstTable?.confidence || firstTable?.tableJson?.confidence || null,
      tableJson: firstTable?.tableJson || {},
      columns: firstTable?.columns || defaultColumns,
      rows: displayRows
    });
    setIssues(jobData?.issues || []);
    const resultFiles = jobData?.files || [];
    setAnalyzedFiles(resultFiles);
    setSourceText(resultFiles.map((file) => {
      const name = file.originalName || file.name || '문서';
      const pageCount = file.pageCount ? `${file.pageCount}페이지` : '페이지 수 미확인';
      const text = file.extractedText || '';
      return `===== ${name} / ${pageCount} / 텍스트/OCR 보조 =====\n${text}`;
    }).filter(Boolean).join('\n\n'));
  };

  const selectTableByIndex = (index) => {
    const nextIndex = Number(index) || 0;
    const selected = tables[nextIndex];
    const draftRow = getDraftRowFromAnalysis(job?.analysis || {}, selectedDesign?.layout || '');
    setSelectedTableIndex(nextIndex);
    setTable({
      id: selected?.id,
      tableName: selected?.tableName || selected?.table_name || '문서 표 후보',
      tableType: selected?.tableType || selected?.table_type || 'NORMAL_TABLE',
      page: selected?.page || selected?.tableJson?.page || null,
      confidence: selected?.confidence || selected?.tableJson?.confidence || null,
      tableJson: selected?.tableJson || {},
      columns: selected?.columns || defaultColumns,
      rows: mergeDraftIntoRows(selected?.rows || [], draftRow)
    });
  };

  const buildChatContext = () => {
    const hasDocument = Boolean(job?.id);
    const hasTableRows = (table.rows || []).length > 0;
    return {
      hasDocument,
      hasJob: hasDocument,
      hasFiles: pendingFiles.length > 0 || analyzedFiles.length > 0,
      hasPendingFiles: pendingFiles.length > 0,
      documentState: hasDocument ? 'ANALYZED' : (pendingFiles.length ? 'FILES_ATTACHED_NOT_ANALYZED' : 'NO_FILE'),
      analysis: hasDocument ? {
        documentType: analysis.documentType,
        purpose: analysis.purpose,
        summary: analysis.summary,
        confidence: analysis.confidence,
        tableCount: analysis.tableCount,
        issueCount: analysis.issueCount,
        keyValues: analysis.keyValues || [],
        fileProfiles: analysis.fileProfiles || []
      } : null,
      table: hasDocument || hasTableRows ? {
        tableName: table.tableName || '문서 표 후보',
        tableType: table.tableType || table.table_type || 'NORMAL_TABLE',
        columns: table.columns || defaultColumns,
        rows: (table.rows || []).slice(0, 100)
      } : null,
      issues: hasDocument ? (issues || []).slice(0, 80) : [],
      selectedTemplate: selectedTemplate ? { id: selectedTemplate.id, templateName: selectedTemplate.templateName } : null,
      aiTemplateRecommendations: aiTemplateRecommendations.slice(0, 3),
      outputMode,
      templateLayoutMode,
      generatedExcel: generatedExcel ? { id: generatedExcel.id, fileName: generatedExcel.fileName } : null
    };
  };

  const shouldAnalyzeFromChat = (text, uploadFiles = []) => {
    if (uploadFiles.length > 0) return true;
    return false;
  };

  const answerFromJob = (jobData, requestText) => {
    const docType = jobData?.analysis?.documentType || jobData?.analysis?.document_type || '업무 문서';
    const summary = jobData?.analysis?.summary || '문서 분석이 완료되었습니다.';
    const rowCount = (jobData?.tables || []).reduce((sum, item) => sum + Number((item.rows || []).length), 0);
    const issueCount = jobData?.issues?.length || 0;
    const totalPages = (jobData?.files || []).reduce((sum, file) => sum + Number(file.pageCount || 0), 0);
    const parseText = totalPages ? ` 전체 ${totalPages.toLocaleString()}페이지를 텍스트 우선 파싱했고 필요 시 OCR 보조 추출을 적용했습니다.` : ' 텍스트 우선 파싱했고 필요 시 OCR 보조 추출을 적용했습니다.';

    const tableType = jobData?.tables?.[0]?.tableType || jobData?.tables?.[0]?.table_type || '';
    if (isReferenceTableType(tableType)) {
      return `기준서/지침서 기준으로 문서를 분석했습니다.${parseText} 원문에 있는 기준·단가·산정 문장 ${rowCount}행을 표로 정리했고 확인 필요 항목은 ${issueCount}건입니다.`;
    }
    if (isMultiVendorCompareTableType(tableType)) {
      return `업체별 단가 비교 기준으로 문서를 분석했습니다.${parseText} 요청한 공종/품목 기준 비교표 ${rowCount}행을 만들었습니다. 엑셀 미리보기에서 A/B/C 업체 단가와 표준시장단가를 확인하세요.`;
    }
    if (isTextVendorComparisonReportType(tableType)) {
      return `표가 없는 서술형 업체 비교보고서로 분석했습니다.${parseText} 원문 총괄 비교 문장에서 업체별 총액 요약 ${rowCount}행을 추출했습니다. 개별 공종 단가는 원문에 명시된 범위에서만 확인하세요.`;
    }
    if (isStandardMarketTableType(tableType)) {
      return `표준시장단가 자료로 문서를 분석했습니다.${parseText} 공종별 단가 ${rowCount}행을 표로 정리했고 확인 필요 항목은 ${issueCount}건입니다.`;
    }
    if (/(단가|비교|최저|가격)/i.test(requestText || '')) {
      return `단가 비교 기준으로 문서를 분석했습니다.${parseText} 표 후보 ${rowCount}행, 확인 필요 항목 ${issueCount}건입니다. 단위가 다른 항목은 환산 기준 확인 후 비교해야 합니다.`;
    }
    if (/(문서|뭐야|무슨|내용|요약)/i.test(requestText || '')) {
      return `이 문서는 ${docType}로 보입니다.${parseText} ${summary}`;
    }
    return `문서 분석이 완료되었습니다.${parseText} 표 후보 ${rowCount}행, 확인 필요 ${issueCount}건입니다.`;
  };

  const answerFromCurrentContext = (requestText) => {
    const text = String(requestText || '').trim();
    const hasDocument = Boolean(job?.id);
    const rowCount = table.rows?.length || 0;
    const issueCount = issues.length || 0;
    const totalPages = (analyzedFiles || []).reduce((sum, file) => sum + Number(file.pageCount || 0), 0);
    const pageText = totalPages ? `총 ${totalPages.toLocaleString()}페이지를 텍스트 우선 파싱했습니다.` : '텍스트 우선 파싱했습니다.';

    if (/^(안녕|하이|hello|hi|반가워|ㅎㅇ)|안녕하세요/i.test(text)) {
      return {
        answer: '안녕하세요. 파일을 첨부하면 문서 유형 확인, 표 후보 생성, 확인 필요 항목 정리, 엑셀 산출 흐름으로 도와드립니다.',
        quickReplies: ['이 문서 뭐야?', '단가만 비교해줘', '확인 필요한 부분만 보여줘'],
        recommendedTab: null
      };
    }

    if (!hasDocument) {
      return {
        answer: activeSessionId ? '현재 채팅 세션의 분석 결과를 다시 불러오는 중입니다. 왼쪽 채팅 목록에서 같은 세션을 선택하거나 잠시 후 다시 질문하세요.' : '아직 분석된 문서가 없습니다. 파일을 첨부하고 요청 내용을 입력하면 분석을 시작합니다.',
        quickReplies: ['파일 첨부', '이 문서 뭐야?'],
        recommendedTab: null
      };
    }

    if (/(문서|뭐야|무슨|내용|요약|파일별|각각|유형)/i.test(text)) {
      const fileProfileText = (analysis.fileProfiles || []).length
        ? '\n' + (analysis.fileProfiles || []).map((file) => `- ${file.fileName}: ${file.documentType} / ${file.roleLabel || file.role} / ${file.summary}`).join('\n')
        : '';
      return {
        answer: `현재 문서는 ${analysis.documentType || '업무 문서'}로 보입니다. ${pageText} ${analysis.summary || ''}${fileProfileText}`.trim(),
        quickReplies: ['표로 만들어줘', '확인 필요한 부분만 보여줘', '엑셀 미리보기 보여줘'],
        recommendedTab: 'analysis'
      };
    }

    if (/(확인|오류|문제|검토|이슈|누락)/i.test(text)) {
      const issueLines = issues.slice(0, 5).map((issue) => `- ${issue.message || '확인이 필요합니다.'}`).join('\n');
      return {
        answer: issueCount ? `확인 필요 항목은 ${issueCount}건입니다.\n${issueLines}` : '현재 확인 필요 항목은 없습니다.',
        quickReplies: ['엑셀 미리보기 보여줘', '엑셀 미리보기 보여줘'],
        recommendedTab: 'analysis'
      };
    }

    if (/(단가|비교|최저|가격|견적)/i.test(text)) {
      const tableType = table.tableType || table.table_type || '';
      const isReferenceTable = isReferenceTableType(tableType);
      const isStandardMarketTable = isStandardMarketTableType(tableType);
      const isMultiCompareTable = isMultiVendorCompareTableType(tableType);
      return {
        answer: rowCount
          ? (isMultiCompareTable ? `현재 업체별 단가 비교표 ${rowCount}행이 있습니다. 표준시장단가와 각 업체 단가/최저 업체를 같이 확인할 수 있습니다.` : (isReferenceTable ? `현재 기준서 항목 표 ${rowCount}행이 있습니다. 단가 기준 컬럼에서 원문 단가·가격·요금 기준을 확인할 수 있습니다.` : (isStandardMarketTable ? `현재 표준시장단가 표 ${rowCount}행이 있습니다. 공종명칭·규격·단위·단가 기준으로 확인할 수 있습니다.` : `현재 표 후보 ${rowCount}행 기준으로 단가 비교가 가능합니다. 업체별 동일 품목·동일 규격의 단위가 다를 때만 환산 기준 확인이 필요합니다.`)))
          : '비교할 행 추가 후 바로 입력할 수 있습니다. 원문에 근거 없는 품목·금액·단가는 만들지 않았습니다.',
        quickReplies: ['기준 항목 표로 정리해줘', '엑셀 미리보기 보여줘'],
        recommendedTab: rowCount ? 'table' : 'analysis'
      };
    }

    if (/(표|테이블|정리)/i.test(text)) {
      const tableType = table.tableType || table.table_type || '';
      const isReferenceTable = isReferenceTableType(tableType);
      const isStandardMarketTable = isStandardMarketTableType(tableType);
      const isMultiCompareTable = isMultiVendorCompareTableType(tableType);
      return {
        answer: rowCount ? `${isMultiCompareTable ? '업체별 단가 비교표' : (isReferenceTable ? '기준서 항목 표' : (isStandardMarketTable ? '표준시장단가 표' : '표 후보'))} ${rowCount}행이 있습니다. 왼쪽의 엑셀 미리보기에서 직접 수정할 수 있습니다.` : '현재 표 후보 행은 없습니다. 원문에 근거 없는 품목·금액·단가는 만들지 않았습니다.',
        quickReplies: ['확인 필요한 부분만 보여줘', '엑셀 미리보기 보여줘'],
        recommendedTab: 'table'
      };
    }

    if (/(엑셀|xlsx|양식|산출|다운로드)/i.test(text)) {
      return {
        answer: generatedExcel ? '엑셀 파일이 생성되어 있습니다. 다운로드 버튼을 누르면 받을 수 있습니다.' : '엑셀을 만들려면 엑셀 미리보기를 확인한 뒤 상단의 엑셀 만들기 버튼을 누르세요.',
        quickReplies: ['엑셀 미리보기 보여줘', '확인 필요한 부분만 보여줘'],
        recommendedTab: generatedExcel ? 'excel' : 'table'
      };
    }

    return null;
  };

  const appendChat = (entry) => {
    setChatMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, ...entry }]);
  };

  const handleChatSend = async (textArg) => {
    const uploadFiles = [...pendingFiles];
    const rawText = String(textArg ?? userRequest ?? '').trim();
    const text = rawText || (uploadFiles.length ? '첨부한 문서를 분석해줘' : '');
    if (!text || loading) return;

    appendChat({
      role: 'user',
      content: text,
      files: uploadFiles.map(toChatFile)
    });
    setUserRequest('');
    setMessage('');

    try {
      setLoading(true);
      if (shouldAnalyzeFromChat(text, uploadFiles)) {
        appendChat({ role: 'assistant', content: '첨부 파일을 백그라운드 작업으로 등록합니다. 분석이 도는 동안 다른 작업을 계속할 수 있습니다.' });
        const result = await createDocumentJobApi({
          title: uploadFiles[0]?.name || '문서 분석 작업',
          userRequest: text,
          outputMode,
          templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : '',
          files: uploadFiles,
          chatSessionId: activeSessionId || null
        });
        if (result.job) {
          bindJobResult(result.job);
          updateProcessingState(result.job.id, result.job.status, result.job.title);
          startJobPolling(result.job.id, result.sessionId || activeSessionId || null);
        }
        if (result.sessionId) setActiveSessionId(String(result.sessionId));
        if (result.session?.messages) setChatMessages(normalizeServerMessages(result.session.messages));
        await refreshChatSessions();
        setPendingFiles([]);
        setTab('analysis');
        setMessage('작업이 백그라운드 대기열에 등록되었습니다. 완료되면 채팅과 결과 화면에 자동 반영됩니다.');
        return;
      }

      const result = await sendAiChatApi({
        message: text,
        context: buildChatContext(),
        sessionId: activeSessionId || null,
        jobId: job?.id || null,
        tableId: table?.id || null
      });
      const chat = result.chat || result;
      if (result.job) bindJobResult(result.job);
      if (result.session?.id) {
        setActiveSessionId(String(result.session.id));
        setChatMessages(normalizeServerMessages(result.session.messages || []));
      }
      if (chat.generatedExcel) {
        setGeneratedExcel(chat.generatedExcel);
        await refreshDownloads();
      }
      await refreshChatSessions();
      if (!result.session?.messages) appendChat({
        role: 'assistant',
        content: chat.answer || '답변을 생성하지 못했습니다.',
        quickReplies: chat.quickReplies || ['이 문서 뭐야?', '단가만 비교해줘'],
        meta: chat.llmFallback ? 'fallback' : chat.model
      });
      if (chat.recommendedTab) setTab(chat.recommendedTab);
    } catch (err) {
      const fallback = answerFromCurrentContext(text);
      appendChat({
        role: 'assistant',
        content: fallback?.answer || '채팅 서버 응답이 지연되어 현재 화면의 분석 결과 기준으로만 답변합니다. 문서 분석 결과와 미리보기 편집 데이터는 왼쪽 영역에서 확인하세요.',
        quickReplies: fallback?.quickReplies || ['이 문서 뭐야?', '확인 필요한 부분만 보여줘'],
      });
      if (fallback?.recommendedTab) setTab(fallback.recommendedTab);
    } finally {
      setLoading(false);
    }
  };

  const updateCell = (rowIndex, key, value) => {
    setTable((prev) => {
      const baseColumns = prev.columns || [];
      const rows = [...(prev.rows || [])];
      while (rows.length <= rowIndex) {
        rows.push(Object.fromEntries(baseColumns.map((col) => [col.key, ''])));
      }
      rows[rowIndex] = { ...(rows[rowIndex] || {}), [key]: value };
      return { ...prev, rows };
    });
  };

  const addRow = () => {
    setTable((prev) => ({ ...prev, rows: [...prev.rows, Object.fromEntries(prev.columns.map((col) => [col.key, '']))] }));
  };

  const removeRow = (rowIndex) => {
    setTable((prev) => ({ ...prev, rows: prev.rows.filter((_, index) => index !== rowIndex) }));
  };

  const makeUniqueColumnKey = (base, columns = []) => {
    const clean = String(base || 'custom_field').replace(/[^a-zA-Z0-9가-힣_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'custom_field';
    const existing = new Set((columns || []).map((col) => String(col.key)));
    if (!existing.has(clean)) return clean;
    let index = 2;
    while (existing.has(`${clean}_${index}`)) index += 1;
    return `${clean}_${index}`;
  };

  const addColumn = () => {
    const label = window.prompt('추가할 컬럼명을 입력하세요. 예: 납기일, 공급조건, 설치비');
    if (!label) return;
    setTable((prev) => {
      const key = makeUniqueColumnKey(label, prev.columns);
      return {
        ...prev,
        columns: [...(prev.columns || []), { key, label }],
        rows: (prev.rows || []).map((row) => ({ ...row, [key]: '' })),
      };
    });
  };

  const removeColumn = (key) => {
    if (!key || !window.confirm('이 컬럼을 삭제할까요?')) return;
    setTable((prev) => ({
      ...prev,
      columns: (prev.columns || []).filter((col) => col.key !== key),
      rows: (prev.rows || []).map((row) => {
        const next = { ...row };
        delete next[key];
        return next;
      }),
    }));
  };

  const updateColumnLabel = (key, label) => {
    setTable((prev) => ({
      ...prev,
      columns: (prev.columns || []).map((col) => col.key === key ? { ...col, label } : col),
    }));
  };

  const handleCandidateFieldAction = async (fieldId, action) => {
    if (!job?.id || !fieldId) return;
    try {
      setLoading(true);
      const result = await updateCandidateFieldApi(job.id, fieldId, { action });
      bindJobResult(result.job);
      setMessage(action === 'ADD_STANDARD' ? '신규 컬럼을 표준필드로 추가했습니다.' : action === 'USE_CUSTOM' ? '신규 컬럼을 이번 문서 전용 컬럼으로 유지합니다.' : '신규 컬럼 후보를 제외했습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '신규 컬럼 후보 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const saveTable = async () => {
    if (!job?.id) return;
    try {
      setLoading(true);
      const result = await updateTableApi(job.id, table);
      bindJobResult(result.job);
      setMessage('엑셀 미리보기 수정 내용을 저장했습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '미리보기 저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const revalidate = async () => {
    if (!job?.id) return;
    try {
      setLoading(true);
      await saveTable();
      const result = await revalidateJobApi(job.id);
      bindJobResult(result.job);
      setMessage('재검증이 완료되었습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '재검증 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };


  const applyRecommendedTemplate = (recommendation) => {
    const rawTemplateId = recommendation?.templateId || recommendation?.id || recommendation?.template?.id;
    const rawTemplateName = recommendation?.templateName || recommendation?.template_name || recommendation?.template?.templateName || recommendation?.template?.template_name || '';
    const matchedTemplate = registeredTemplates.find((item) => String(item.id) === String(rawTemplateId))
      || registeredTemplates.find((item) => String(item.templateName || item.template_name || '').trim() === String(rawTemplateName).trim());

    if (!matchedTemplate?.id) {
      setMessage('이 추천 후보는 현재 등록된 자사 양식 목록에 없습니다. 자사 등록 양식은 상단 셀렉트에 있는 양식만 적용할 수 있습니다.');
      return;
    }

    setOutputMode('COMPANY_TEMPLATE');
    setSelectedDesignId('');
    setTemplateId(String(matchedTemplate.id));
    setTemplateLayoutMode(recommendation?.dynamicVendorSupport ? 'COMPACT_VENDOR_GROUPS' : templateLayoutMode);
    setTab('excel');
    setMessage(`${matchedTemplate.templateName || matchedTemplate.template_name || '추천 양식'}을 등록 양식으로 적용했습니다. 엑셀 만들기를 누르면 이 양식으로 산출됩니다.`);
  };

  const createAiTemplateFromDbFields = async () => {
    if (!job?.id) {
      setMessage('먼저 문서 분석을 완료해야 AI 새 양식을 만들 수 있습니다.');
      return;
    }
    try {
      setAiTemplateCreating(true);
      setLoading(true);
      await saveTable();
      const selectedDesign = aiTemplateDesignCandidates.find((item) => item.designId === selectedDesignId) || aiDesignOptions.find((item) => item.designId === selectedDesignId) || null;
      if (!selectedDesign) {
        setMessage('저장할 AI 디자인을 먼저 선택하세요.');
        return;
      }
      const result = await createAiTemplateApi(job.id, { tableId: table.id || null, design: selectedDesign });
      const newTemplate = result.template;
      const nextDesign = result.design || selectedDesign || null;
      if (newTemplate?.id) {
        setTemplates((prev) => {
          const exists = prev.some((item) => String(item.id) === String(newTemplate.id));
          return exists ? prev : [newTemplate, ...prev];
        });
      }
      if (nextDesign?.designId) {
        setAiTemplateDesignCandidates((prev) => {
          const exists = (prev || []).some((item) => String(item.designId || '') === String(nextDesign.designId || ''));
          return exists ? prev : [nextDesign, ...(prev || [])];
        });
        setSelectedDesignId(nextDesign.designId);
      }
      setOutputMode('FREE_FORM');
      if (result.job) bindJobResult(result.job);
      setTab('excel');
      setMessage(result.message || 'DB 표준필드 기반 AI 생성 양식을 자유 편집 양식으로 준비했습니다. 자사 등록 양식 목록에는 섞지 않습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || 'AI 새 양식 생성 중 오류가 발생했습니다.');
    } finally {
      setAiTemplateCreating(false);
      setLoading(false);
    }
  };

  const createExcel = async () => {
    if (!job?.id) {
      setMessage('먼저 문서 분석을 실행하세요.');
      return;
    }
    try {
      setLoading(true);
      await saveTable();
      const result = await generateExcelApi(job.id, {
        fileName,
        outputMode,
        templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : null,
        tableId: table.id || null,
        chatSessionId: activeSessionId || null,
        templateLayoutMode: outputMode === 'COMPANY_TEMPLATE' ? templateLayoutMode : null,
        design: outputMode === 'FREE_FORM' ? selectedDesign : null,
        designId: outputMode === 'FREE_FORM' ? selectedDesign?.designId : null
      });
      setGeneratedExcel(result.excel);
      await refreshDownloads();
      setMessage('엑셀 파일이 생성되었습니다. 다운로드 버튼을 누르세요. 다운로드 목록에도 표시됩니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '엑셀 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };


  const activeProcessingList = Object.values(processingJobs);
  const currentJobRunning = isBackgroundRunning(job?.status);

  return (
    <div className="w-full max-w-none space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white/95 px-5 py-4 shadow-card backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">문서 분석 및 엑셀화 작업</h2>
            <p className="mt-1 text-sm text-slate-500">산출 방식을 선택한 뒤 파일을 첨부하고 요청하세요.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={activeProcessingList.length ? 'amber' : 'blue'}>{activeProcessingList.length ? `백그라운드 ${activeProcessingList.length}건` : '작업 준비됨'}</Badge>
            <Badge tone="slate">PDF·엑셀 파싱</Badge>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-card backdrop-blur">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-[260px] items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-brand-600 font-black text-white shadow-glow">1</div>
            <div>
              <h3 className="text-lg font-black text-slate-950">출력 설정</h3>
              <p className="text-sm text-slate-500">상단은 파일 생성 실행만 담당합니다. 양식 후보는 필요할 때만 펼쳐서 선택합니다.</p>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:w-auto xl:grid-cols-[220px_220px_120px_120px_120px]">
            <Input label="파일명" value={fileName} onChange={setFileName} />
            <Select label="자사 양식 배치" value={templateLayoutMode} onChange={setTemplateLayoutMode} disabled={outputMode !== 'COMPANY_TEMPLATE'} options={[{ value: 'COMPACT_VENDOR_GROUPS', label: '실제 업체만 표시' }, { value: 'PRESERVE_TEMPLATE', label: isProductPriceSurveyTemplate(selectedTemplate) ? '원본 5칸 유지' : '원본 3칸 유지' }]} />
            <ActionButton label="다시 확인" tone="amber" onClick={revalidate} disabled={!job || loading} />
            <ActionButton label="엑셀 만들기" tone="blue" onClick={createExcel} disabled={!job || loading} />
            <a
              className={`flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-black shadow-glow ${generatedExcel ? 'bg-gradient-to-r from-emerald-500 to-brand-600 text-white' : 'pointer-events-none bg-slate-200 text-slate-400'}`}
              href={generatedExcel && job ? excelDownloadUrl(job.id, generatedExcel.id) : '#'}
              target="_blank"
              rel="noreferrer"
            >다운로드</a>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={outputMode === 'COMPANY_TEMPLATE' ? 'blue' : 'green'}>{outputMode === 'COMPANY_TEMPLATE' ? '등록한 회사 양식' : 'AI 추천양식'}</Badge>
              <Badge tone={issues.length ? 'amber' : 'green'}>확인 필요 {issues.length}건</Badge>
              {outputMode === 'COMPANY_TEMPLATE' && <Badge tone="blue">배치: {templateLayoutMode === 'COMPACT_VENDOR_GROUPS' ? '빈 업체칸 숨김' : '원본 양식 유지'}</Badge>}
            </div>
            <p className="mt-2 truncate text-sm font-black text-slate-900">
              선택 양식: {outputMode === 'COMPANY_TEMPLATE' ? (selectedTemplate?.templateName || '등록한 회사 양식 선택 필요') : (selectedDesign?.name || 'AI 추천양식 선택 필요')}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-500">후보 목록은 접어두고, 미리보기에는 선택된 하나의 양식만 반영됩니다.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowOutputSettings((prev) => !prev)}
            className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:bg-brand-700"
          >
            {showOutputSettings ? '양식 후보 접기' : '양식 변경'}
          </button>
        </div>

        {showOutputSettings && (
          <AiTemplateRecommendationBox
            job={job}
            recommendations={aiTemplateRecommendations}
            outputMode={outputMode}
            selectedTemplate={selectedTemplate}
            selectedTemplateId={templateId}
            registeredTemplates={registeredTemplates}
            onApply={applyRecommendedTemplate}
            designCandidates={aiDesignOptions}
            candidateFields={candidateFields}
            selectedDesignId={selectedDesignId}
            onSelectDesign={(id) => { setSelectedDesignId(id); setTemplateId(''); setOutputMode('FREE_FORM'); setTab('excel'); }}
            onChangeOutputMode={changeOutputMode}
            onCreateAiTemplate={createAiTemplateFromDbFields}
            creating={aiTemplateCreating}
            loading={loading}
          />
        )}
      </section>

      {message && <div className="rounded-3xl border border-brand-100 bg-brand-50 px-5 py-4 text-sm font-bold text-brand-700">{message}</div>}

      {activeProcessingList.length > 0 && (
        <div className="rounded-3xl border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-800">
          백그라운드 처리 중: {activeProcessingList.map((item) => `${item.title || `작업 ${item.id}`} · ${statusLabel(item.status)}`).join(' / ')}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white/90 px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-slate-800">화면 보기 설정</p>
          <p className="mt-1 text-xs font-bold text-slate-500">결과 영역과 채팅 영역을 각각 숨겨서 남은 영역을 크게 볼 수 있습니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowResultPanel((prev) => !prev)}
            className={`rounded-2xl px-4 py-2 text-xs font-black ${showResultPanel ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'}`}
          >{showResultPanel ? '◀ 결과 숨김' : '▶ 결과 보기'}</button>
          <button
            type="button"
            onClick={() => setShowChatPanel((prev) => !prev)}
            className={`rounded-2xl px-4 py-2 text-xs font-black ${showChatPanel ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'}`}
          >{showChatPanel ? '채팅 숨김 ▶' : '채팅 보기 ◀'}</button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 2xl:h-[calc(100vh-250px)] 2xl:min-h-[680px] 2xl:items-stretch ${showResultPanel && showChatPanel ? '2xl:grid-cols-[minmax(0,1fr)_minmax(420px,540px)]' : '2xl:grid-cols-1'}`}>
        {showResultPanel && (
        <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft 2xl:h-full 2xl:min-h-0">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 lg:flex-row lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-black text-slate-950">문서 분석 및 결과 미리보기</h3>
                <Badge tone={issues.length ? 'amber' : 'green'}>확인 필요 {issues.length}건</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">문서 분석, 엑셀 미리보기 직접 편집, 원본 텍스트를 확인합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>문서 분석</TabButton>
              <TabButton active={tab === 'excel'} onClick={() => setTab('excel')}>엑셀 미리보기</TabButton>
              <TabButton active={tab === 'source'} onClick={() => setTab('source')}>원본 문서</TabButton>
            </div>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
            <TableSelector tables={tables} selectedIndex={selectedTableIndex} onSelect={selectTableByIndex} />
            {tab === 'analysis' && <AnalysisView analysis={analysis} issues={issues} table={table} onMoveTable={() => setTab('excel')} onMoveExcel={() => setTab('excel')} />}
            {tab === 'excel' && <ExcelPreview table={table} issues={issues} outputMode={outputMode} selectedTemplate={selectedTemplate} selectedDesign={selectedDesign} writerName={writerName} templateLayoutMode={templateLayoutMode} updateCell={updateCell} addRow={addRow} removeRow={removeRow} addColumn={addColumn} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={saveTable} disabled={loading} candidateFields={candidateFields} onCandidateAction={handleCandidateFieldAction} />}
            {tab === 'source' && <SourceView files={analyzedFiles} sourceText={sourceText} />}
          </div>
        </section>
        )}

        {showChatPanel && (
        <ChatAssistantPanel
          files={pendingFiles}
          setFiles={setPendingFiles}
          handleFiles={handleFiles}
          removePendingFile={removePendingFile}
          clearPendingFiles={clearPendingFiles}
          fileInputRef={chatFileInputRef}
          userRequest={userRequest}
          setUserRequest={setUserRequest}
          selectedTemplate={selectedTemplate}
          outputMode={outputMode}
          loading={loading}
          backgroundRunning={currentJobRunning}
          jobStatus={job?.status}
          job={job}
          generatedExcel={generatedExcel}
          runAnalysis={runAnalysis}
          onSend={handleChatSend}
          chatMessages={chatMessages}
          chatSessions={chatSessions}
          activeSessionId={activeSessionId}
          downloads={downloads}
          onNewChat={startNewChat}
          onSelectSession={loadChatSession}
          onDeleteSession={deleteChatSession}
          setTab={setTab}
        />
        )}

        {!showResultPanel && !showChatPanel && (
          <div className="flex min-h-[420px] items-center justify-center rounded-[32px] border border-dashed border-slate-300 bg-white/80 p-8 text-center shadow-card">
            <div>
              <p className="text-lg font-black text-slate-800">현재 모든 영역이 숨겨져 있습니다.</p>
              <p className="mt-2 text-sm font-bold text-slate-500">위의 버튼으로 결과 보기 또는 채팅 보기를 다시 켜세요.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



function classifyDesign(layout = '') {
  const text = String(layout || '').toUpperCase();
  if (text.includes('DYNAMIC_VENDOR') || text.includes('VENDOR')) return '업체 반복';
  if (text.includes('ESTIMATE')) return '견적서';
  if (text.includes('PRICE') || text.includes('UNIT')) return '단가표';
  if (text.includes('MEETING')) return '회의록';
  if (text.includes('OFFICIAL')) return '공문';
  if (text.includes('REPORT') || text.includes('SECTION') || text.includes('APPROVAL')) return '보고서';
  return '기본 표';
}

function AiTemplateRecommendationBox({ job, recommendations = [], designCandidates = [], candidateFields = [], outputMode = 'FREE_FORM', selectedTemplate, selectedTemplateId, selectedDesignId, registeredTemplates = [], onSelectDesign, onApply, onChangeOutputMode, onCreateAiTemplate, creating, loading }) {
  const isCompanyMode = outputMode === 'COMPANY_TEMPLATE';
  const [showAllAiCandidates, setShowAllAiCandidates] = useState(false);
  const designs = Array.isArray(designCandidates) ? designCandidates : [];
  const registeredTemplateIds = new Set((registeredTemplates || []).map((tpl) => String(tpl.id || tpl.templateId || '')).filter(Boolean));
  const list = (Array.isArray(recommendations) ? recommendations : [])
    .filter((item) => registeredTemplateIds.has(String(item.templateId || item.id || '')))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const activeDesign = !isCompanyMode ? (designs.find((item) => String(item.designId || '') === String(selectedDesignId || '')) || null) : null;
  const activeRecommendation = isCompanyMode ? (list.find((item) => String(item.templateId || item.id || '') === String(selectedTemplateId || '')) || null) : null;
  const recommendedIds = new Set(list.map((item) => String(item.templateId || item.id || '')).filter(Boolean));
  const directTemplates = (registeredTemplates || [])
    .filter((tpl) => !recommendedIds.has(String(tpl.id || tpl.templateId || '')))
    .map((tpl, index) => ({
      templateId: tpl.id || tpl.templateId,
      templateName: tpl.templateName || tpl.template_name,
      templateType: tpl.templateType || tpl.template_type,
      score: 0,
      rank: list.length + index + 1,
      reasons: ['등록된 회사 양식입니다. 적용 전 미리보기에서 입력 위치를 확인하세요.'],
      template: tpl,
      recommendationType: 'REGISTERED_TEMPLATE',
    }));
  const companyChoices = [...list, ...directTemplates]
    .filter((item, index, arr) => arr.findIndex((other) => String(other.templateId || other.id || '') === String(item.templateId || item.id || '')) === index);
  const visibleAiDesigns = showAllAiCandidates ? designs : designs.slice(0, 3);
  const currentTitle = isCompanyMode
    ? (selectedTemplate?.templateName || activeRecommendation?.templateName || '등록한 회사 양식을 선택하세요')
    : (activeDesign?.name || 'AI 추천양식을 선택하세요');
  const currentDescription = isCompanyMode
    ? ((activeRecommendation?.reasons || [])[0] || selectedTemplate?.description || '등록한 엑셀 양식에 분석 데이터를 매핑합니다.')
    : (activeDesign?.reason || '문서 분석 결과와 layout registry 기준으로 생성된 추천 양식입니다.');
  const visibleCandidateFields = (candidateFields || []).slice(0, 6);
  const needNewTemplate = job?.id && !companyChoices.length && designs.length > 0;

  const tabButtonClass = (active) => `rounded-2xl px-4 py-2 text-sm font-black transition ${active ? 'bg-slate-950 text-white shadow-glow' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`;

  return (
    <div className="mt-4 rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">출력 양식 선택</p>
            {job?.id ? <Badge tone="green">현재 문서 분석 기준</Badge> : <Badge tone="slate">파일 분석 후 자동 추천</Badge>}
            {needNewTemplate && <Badge tone="amber">회사 양식 없음</Badge>}
          </div>
          <h4 className="mt-2 text-lg font-black text-slate-950">현재 문서에 맞는 양식만 골라서 보여줍니다.</h4>
          <p className="mt-1 text-sm font-bold leading-6 text-slate-500">AI 추천양식은 상위 후보만 표시하고, 등록한 회사 양식은 실제 등록 양식만 표시합니다.</p>
        </div>
        {!isCompanyMode && (
          <button
            type="button"
            onClick={onCreateAiTemplate}
            disabled={!job?.id || loading || creating || !activeDesign}
            className="shrink-0 rounded-2xl bg-gradient-to-r from-slate-900 to-brand-700 px-4 py-2.5 text-xs font-black text-white shadow-glow disabled:bg-slate-200 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400"
            title="현재 선택된 AI 추천양식을 저장합니다. 등록 회사 양식 목록에는 섞이지 않습니다."
          >
            {creating ? 'AI 양식 저장 중' : '현재 AI 양식 저장'}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onChangeOutputMode?.('FREE_FORM')} className={tabButtonClass(!isCompanyMode)}>AI 추천양식</button>
        <button type="button" onClick={() => onChangeOutputMode?.('COMPANY_TEMPLATE')} className={tabButtonClass(isCompanyMode)}>등록한 회사 양식</button>
      </div>

      <div className="mt-4 rounded-3xl border border-white bg-white/90 p-4 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">현재 선택</p>
            <h5 className="mt-1 truncate text-base font-black text-slate-950">{currentTitle}</h5>
            <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-600">{currentDescription}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
            <Badge tone={isCompanyMode ? 'blue' : 'green'}>{isCompanyMode ? '등록한 회사 양식' : 'AI 추천양식'}</Badge>
            {!isCompanyMode && activeDesign?.layout && <Badge tone="slate">{classifyDesign(activeDesign.layout)}</Badge>}
            {!isCompanyMode && activeDesign?.score ? <Badge tone={Number(activeDesign.score) >= 85 ? 'green' : Number(activeDesign.score) >= 70 ? 'amber' : 'slate'}>{Math.round(Number(activeDesign.score))}점</Badge> : null}
            {isCompanyMode && activeRecommendation?.score ? <Badge tone={Number(activeRecommendation.score) >= 80 ? 'green' : Number(activeRecommendation.score) >= 60 ? 'amber' : 'slate'}>{Math.round(Number(activeRecommendation.score))}점</Badge> : null}
          </div>
        </div>
      </div>

      {!isCompanyMode ? (
        <div className="mt-3 rounded-3xl border border-emerald-100 bg-white/90 p-3 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black text-slate-800">AI 추천양식</p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">처음에는 상위 3개만 표시합니다. 전체 registry 목록을 그대로 노출하지 않습니다.</p>
            </div>
            {designs.length > 3 && (
              <button type="button" onClick={() => setShowAllAiCandidates((prev) => !prev)} className="rounded-2xl bg-emerald-50 px-3 py-2 text-[11px] font-black text-emerald-700 hover:bg-emerald-100">
                {showAllAiCandidates ? '상위 3개만 보기' : `후보 ${designs.length}개 보기`}
              </button>
            )}
          </div>
          {visibleAiDesigns.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {visibleAiDesigns.map((design) => {
                const active = String(selectedDesignId || '') === String(design.designId || '');
                return (
                  <button
                    key={design.designId || design.name}
                    type="button"
                    onClick={() => onSelectDesign?.(design.designId)}
                    disabled={loading}
                    className={`rounded-2xl border p-3 text-left transition disabled:opacity-50 ${active ? 'border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/60'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">{design.name || design.title}</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">{classifyDesign(design.layout)} · {design.layoutType || design.layout || 'BASIC_TABLE'}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">{Math.round(Number(design.score || 0))}점</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-600">{design.reason || 'AI가 문서 구조를 기준으로 추천한 양식입니다.'}</p>
                    {Array.isArray(design.sections) && design.sections.length > 0 && (
                      <p className="mt-2 line-clamp-1 text-[11px] font-bold text-slate-400">구성: {design.sections.slice(0, 4).join(' · ')}{design.sections.length > 4 ? ' · …' : ''}</p>
                    )}
                    {active && <p className="mt-2 text-[11px] font-black text-emerald-700">현재 선택됨</p>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-500">
              분석 결과가 들어오면 AI가 문서 유형에 맞는 양식 후보를 생성합니다.
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-3xl border border-brand-100 bg-white/90 p-3 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black text-slate-800">등록한 회사 양식</p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">관리자/사용자가 업로드한 회사 양식만 표시합니다. 기본 후보와 AI 생성 후보는 제외됩니다.</p>
            </div>
            <Badge tone="blue">{companyChoices.length}개</Badge>
          </div>
          {companyChoices.length > 0 ? (
            <div className="space-y-2">
              {companyChoices.map((item) => {
                const active = String(selectedTemplateId || '') === String(item.templateId || item.id || '');
                return (
                  <div key={`${item.templateId || item.id}-${item.rank || item.templateName}`} className={`flex flex-col gap-3 rounded-2xl border p-3 md:flex-row md:items-center md:justify-between ${active ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-slate-900">{item.rank || 1}순위 · {item.templateName}</p>
                        {Number(item.score || 0) > 0 && <Badge tone={Number(item.score || 0) >= 80 ? 'green' : Number(item.score || 0) >= 60 ? 'amber' : 'slate'}>{Math.round(Number(item.score || 0))}점</Badge>}
                        {active && <Badge tone="blue">적용됨</Badge>}
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-500">{(item.reasons || []).slice(0, 2).join(' · ') || item.templateType || '등록한 회사 양식'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onApply(item)}
                      disabled={loading}
                      className={`shrink-0 rounded-2xl px-4 py-2 text-xs font-black ${active ? 'bg-brand-100 text-brand-700' : 'bg-slate-900 text-white hover:bg-brand-700'} disabled:opacity-50`}
                    >
                      {active ? '적용됨' : '이 양식 적용'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-500">
              등록된 회사 양식이 없습니다. AI 추천양식을 사용하거나 관리자 화면에서 회사 양식을 등록하세요.
            </div>
          )}
        </div>
      )}

      {candidateFields.length > 0 && (
        <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          신규 컬럼 후보 {candidateFields.length}개{visibleCandidateFields.length ? `: ${visibleCandidateFields.map((item) => `${item.originalLabel}→${item.suggestedFieldKey}`).join(' / ')}` : ''}
          {candidateFields.length > visibleCandidateFields.length ? ` 외 ${candidateFields.length - visibleCandidateFields.length}개` : ''}
        </div>
      )}
    </div>
  );
}

function ChatAssistantPanel({
  files,
  handleFiles,
  removePendingFile,
  clearPendingFiles,
  fileInputRef,
  userRequest,
  setUserRequest,
  selectedTemplate,
  outputMode = 'FREE_FORM',
  loading,
  backgroundRunning = false,
  jobStatus = '',
  onSend,
  chatMessages,
  chatSessions = [],
  activeSessionId = '',
  downloads = [],
  onNewChat,
  onSelectSession,
  onDeleteSession
}) {
  const hasFiles = files.length > 0;
  const quickRequests = ['기준 항목 표로 정리해줘', '단가 기준만 표로 정리해줘', '이 문서 뭐야?'];
  const messagesBodyRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const [dragActive, setDragActive] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [showDownloadList, setShowDownloadList] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const scrollChatToBottom = (behavior = 'auto') => {
    const container = messagesBodyRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  };

  const handleMessagesScroll = () => {
    const container = messagesBodyRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom < 90;
    stickToBottomRef.current = nearBottom;
    setShowJumpToBottom(!nearBottom);
  };

  useEffect(() => {
    const lastMessage = (chatMessages || [])[chatMessages.length - 1];
    const shouldAutoScroll = lastMessage?.role === 'user';
    if (!shouldAutoScroll) {
      const container = messagesBodyRef.current;
      if (container) {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowJumpToBottom(distanceFromBottom > 90);
      }
      return;
    }
    requestAnimationFrame(() => scrollChatToBottom('auto'));
  }, [chatMessages]);

  useEffect(() => {
    setShowFileList(false);
  }, [files.length]);

  useEffect(() => {
    setShowDownloadList(false);
  }, [downloads.length]);

  const stopDragEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragOver = (event) => {
    stopDragEvent(event);
    setDragActive(true);
  };

  const handleDragLeave = (event) => {
    stopDragEvent(event);
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setDragActive(false);
    }
  };

  const handleDrop = (event) => {
    stopDragEvent(event);
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const submitCurrent = () => {
    const text = String(userRequest || '').trim();
    if (!text && !hasFiles) return;
    onSend(text || '첨부한 문서를 분석해줘');
  };

  return (
    <aside
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex min-h-[680px] flex-col overflow-hidden rounded-[32px] border bg-white shadow-soft 2xl:h-full 2xl:min-h-0 ${dragActive ? 'border-brand-400 ring-4 ring-brand-100' : 'border-slate-200'}`}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-brand-50/80 backdrop-blur-sm">
          <div className="rounded-[28px] border-2 border-dashed border-brand-400 bg-white px-8 py-6 text-center shadow-card">
            <p className="text-lg font-black text-brand-700">여기에 파일을 놓으세요</p>
            <p className="mt-2 text-sm font-bold text-slate-500">파일은 바로 업로드되지 않고 전송 시 요청 내용과 함께 올라갑니다.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h4 className="text-lg font-black text-slate-950">AI 작업 채팅</h4>
          <p className="mt-1 text-xs font-bold text-slate-500">첨부 파일은 채팅창에 표시되고 목록은 아이콘으로 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onNewChat} disabled={loading} className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-200 disabled:opacity-50">새 채팅</button>
          <Badge tone={loading || backgroundRunning ? 'amber' : 'blue'}>{loading ? '응답 중' : (backgroundRunning ? statusLabel(jobStatus) : '준비됨')}</Badge>
        </div>
      </div>


      <div className="border-b border-slate-100 bg-white px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-black text-slate-500">채팅 목록</p>
          <p className="text-[11px] font-bold text-slate-400">새 채팅 전까지 현재 문서 유지</p>
        </div>
        <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
          {(chatSessions || []).map((session) => (
            <div
              key={session.id}
              className={`group relative max-w-[240px] shrink-0 rounded-2xl border pr-9 ${String(activeSessionId) === String(session.id) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
            >
              <button
                type="button"
                onClick={() => onSelectSession?.(session.id)}
                disabled={loading}
                className="block w-full px-3 py-2 text-left text-xs font-black disabled:opacity-50"
              >
                <span className="block truncate">{session.title || session.jobTitle || '문서 작업 채팅'}</span>
                <span className="mt-1 block truncate text-[11px] font-bold opacity-70">{session.messageCount || 0}개 메시지 · {session.jobStatus || '대기'}</span>
              </button>
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onDeleteSession?.(session.id); }}
                disabled={loading}
                title="채팅 삭제"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[13px] font-black text-slate-400 shadow-sm ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
              >×</button>
            </div>
          ))}
          {(!chatSessions || chatSessions.length === 0) && <span className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400">저장된 채팅 없음</span>}
        </div>
      </div>

      <div ref={messagesBodyRef} onScroll={handleMessagesScroll} className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-gradient-to-b from-white to-brand-50/30 px-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-300 text-sm font-black text-white shadow-card">AI</div>
          <div className="max-w-[88%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card">
            <p className="text-sm font-bold leading-6 text-slate-700">파일을 첨부한 뒤 요청 내용을 입력하고 Enter를 누르면 파일과 요청이 함께 업로드됩니다. 분석 결과가 있으면 표/이슈 기준으로 답변합니다.</p>
            <div className="mt-3 rounded-2xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-black text-brand-700">
              현재 기준<br />{outputMode === 'COMPANY_TEMPLATE' ? (selectedTemplate?.templateName ? `등록 양식 적용 · ${selectedTemplate.templateName}` : '등록 양식 적용 · 템플릿 선택 필요') : 'AI 추천양식 · 미리보기 기준'}
            </div>
          </div>
        </div>

        {(chatMessages || []).map((msg) => (
          <ChatBubble key={msg.id} message={msg} onQuickSend={onSend} disabled={loading} />
        ))}

        {hasFiles && (
          <PendingFilesBubble
            files={files}
            onRemove={removePendingFile}
            onClear={clearPendingFiles}
            onOpenList={() => setShowFileList(true)}
            disabled={loading}
          />
        )}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xs font-black text-brand-700">AI</div>
            <div className="max-w-[88%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500 shadow-card">
              요청을 처리하는 중입니다...
            </div>
          </div>
        )}
        {showJumpToBottom && (
          <button
            type="button"
            onClick={() => scrollChatToBottom('smooth')}
            className="sticky bottom-2 ml-auto rounded-full bg-slate-900 px-3 py-2 text-[11px] font-black text-white shadow-glow"
          >맨 아래로</button>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {quickRequests.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => onSend(text)}
              disabled={loading}
              className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-black text-brand-700 hover:bg-brand-100 disabled:opacity-50"
            >{text}</button>
          ))}
        </div>

        <input
          ref={fileInputRef}
          multiple
          type="file"
          className="hidden"
          accept=".pdf,.xlsx,.xls,.csv,.txt,.docx,.json,.md"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {hasFiles && showFileList && (
          <div className="mb-3 rounded-[22px] border border-brand-100 bg-brand-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-black text-brand-700">첨부 파일 관리 {files.length}개</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowFileList(false)}
                  disabled={loading}
                  className="rounded-full px-2 py-1 text-[11px] font-black text-slate-500 hover:bg-white disabled:opacity-50"
                >숨김</button>
                <button
                  type="button"
                  onClick={clearPendingFiles}
                  disabled={loading}
                  className="rounded-full px-2 py-1 text-[11px] font-black text-slate-500 hover:bg-white disabled:opacity-50"
                >전체 삭제</button>
              </div>
            </div>
            <div className="scroll-thin max-h-36 space-y-2 overflow-y-auto pr-1">
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${file.lastModified || index}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-card">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">📄</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-800">{file.name}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-slate-400">전송 대기 · {Math.ceil(file.size / 1024).toLocaleString()} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePendingFile(index)}
                    disabled={loading}
                    className="shrink-0 rounded-xl px-2 py-1 text-xs font-black text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}


        {downloads.length > 0 && showDownloadList && (
          <div className="mb-3 rounded-[22px] border border-emerald-100 bg-emerald-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-black text-emerald-700">최근 다운로드 목록</p>
              <button
                type="button"
                onClick={() => setShowDownloadList(false)}
                className="rounded-full px-2 py-1 text-[11px] font-black text-slate-500 hover:bg-white"
              >숨김</button>
            </div>
            <div className="scroll-thin max-h-24 space-y-1.5 overflow-y-auto pr-1">
              {downloads.slice(0, 5).map((item) => (
                <a key={item.id} href={excelDownloadUrl(item.jobId, item.id)} target="_blank" rel="noreferrer" className="block truncate rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-emerald-50">
                  ⬇ {item.fileName}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-[26px] border border-slate-200 bg-white p-2 shadow-card focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xl font-black text-brand-700 hover:bg-brand-100"
            aria-label="파일 첨부"
          >＋</button>
          {hasFiles && (
            <button
              type="button"
              onClick={() => setShowFileList((prev) => !prev)}
              className="flex h-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 px-3 text-xs font-black text-slate-700 hover:bg-slate-200"
              title={showFileList ? '첨부 파일 목록 숨김' : '첨부 파일 목록 보기'}
            >📎 {files.length}</button>
          )}
          {downloads.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDownloadList((prev) => !prev)}
              className="flex h-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-100"
              title={showDownloadList ? '최근 다운로드 목록 숨김' : '최근 다운로드 목록 보기'}
            >⬇ {downloads.length}</button>
          )}
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isComposing && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitCurrent();
              }
            }}
            rows={1}
            placeholder="요청 입력 후 Enter · Shift+Enter 줄바꿈"
            className="scroll-thin max-h-24 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-3 text-sm font-bold leading-5 text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={submitCurrent}
            disabled={loading || (!String(userRequest || '').trim() && !hasFiles)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-300 text-lg font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-400 disabled:from-slate-300 disabled:to-slate-300"
            aria-label="요청 전송"
          >▶</button>
        </div>
      </div>
    </aside>
  );
}


function PendingFilesBubble({ files, onRemove, onClear, onOpenList, disabled }) {
  if (!Array.isArray(files) || files.length === 0) return null;

  return (
    <div className="ml-auto max-w-[92%] rounded-[24px] rounded-tr-md border border-brand-100 bg-brand-50 px-4 py-3 shadow-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-brand-800">첨부 파일 {files.length}개</p>
          <p className="mt-1 text-xs font-bold text-slate-500">요청 입력 후 Enter를 누르면 이 파일들로 분석 작업이 등록됩니다.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onOpenList} disabled={disabled} className="rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-black text-brand-700 hover:bg-brand-100 disabled:opacity-50">목록</button>
          <button type="button" onClick={onClear} disabled={disabled} className="rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">삭제</button>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {files.slice(0, 4).map((file, index) => (
          <div key={`${file.name}-${file.size}-${file.lastModified || index}`} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700">
            <span className="shrink-0">📄</span>
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{Math.ceil((file.size || 0) / 1024).toLocaleString()} KB</span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              disabled={disabled}
              className="shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-black text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              aria-label="첨부 파일 제거"
            >×</button>
          </div>
        ))}
        {files.length > 4 && <p className="px-1 text-[11px] font-bold text-slate-400">외 {files.length - 4}개 파일은 목록 버튼으로 확인할 수 있습니다.</p>}
      </div>
    </div>
  );
}

function ChatBubble({ message, onQuickSend, disabled }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="ml-auto max-w-[88%] rounded-[24px] rounded-tr-md bg-gradient-to-r from-brand-500 to-brand-300 px-4 py-3 text-sm font-black leading-6 text-white shadow-glow">
        <p className="whitespace-pre-wrap">{message.content}</p>
        {Array.isArray(message.files) && message.files.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {message.files.map((file, index) => (
              <div key={`${file.name}-${index}`} className="rounded-2xl bg-white/15 px-3 py-2 text-xs font-black text-white">
                📄 {file.name} · {Math.ceil((file.size || 0) / 1024).toLocaleString()} KB
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xs font-black text-brand-700">AI</div>
      <div className="max-w-[88%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card">
        <p className="whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{message.content}</p>
        {message.generatedExcel && (
          <div className="mt-3">
            <a href={excelDownloadUrl(message.generatedExcel.jobId, message.generatedExcel.id)} target="_blank" rel="noreferrer" className="inline-flex rounded-2xl bg-gradient-to-r from-emerald-500 to-brand-500 px-3 py-2 text-xs font-black text-white">엑셀 다운로드</a>
          </div>
        )}
        {Array.isArray(message.quickReplies) && message.quickReplies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.quickReplies.slice(0, 3).map((text) => (
              <button
                key={text}
                type="button"
                disabled={disabled}
                onClick={() => onQuickSend(text)}
                className="rounded-2xl bg-brand-50 px-3 py-1.5 text-[11px] font-black text-brand-700 hover:bg-brand-100 disabled:opacity-50"
              >{text}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TableSelector({ tables, selectedIndex, onSelect }) {
  if (!Array.isArray(tables) || tables.length <= 1) return null;

  return (
    <div className="mb-4 rounded-3xl border border-brand-100 bg-brand-50/80 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black text-brand-700">추출된 표 선택</p>
          <p className="mt-1 text-xs font-bold text-slate-500">이미지 표가 여러 개면 페이지/표 단위로 나누어 저장됩니다. 선택한 표만 수정·엑셀 생성 대상입니다.</p>
        </div>
        <select
          value={selectedIndex}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-[260px] rounded-2xl border border-brand-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        >
          {tables.map((item, index) => {
            const page = item.page || item.tableJson?.page;
            const rowCount = item.rowCount ?? (item.rows || []).length;
            const title = item.tableName || `표 ${index + 1}`;
            return (
              <option key={item.id || `${index}-${title}`} value={index}>
                {index + 1}. {page ? `${page}페이지 · ` : ''}{title} · {rowCount}행
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}


const parseAmountValue = (value) => {
  const num = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
};

const formatWonValue = (value) => {
  const num = parseAmountValue(value);
  return num ? `${num.toLocaleString()}원` : '-';
};

const cleanVendorLabel = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/^[A-Z]회사\s*/g, '')
    .replace(/^[A-Z]\s*회사\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeVendorName = (value) => cleanVendorLabel(value)
  .replace(/[\s·,._()\[\]{}㈜주식회사]/g, '')
  .toLowerCase();

const getVendorNameFromColumn = (column) => {
  const label = cleanVendorLabel(column?.label || column?.header || column?.name || column?.key || '');
  if (!label) return '';
  return label
    .replace(/\s*(단가|금액|업체\s*단가|업체\s*금액)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const getVendorColumnGroups = (table) => {
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const groups = new Map();

  columns.forEach((column) => {
    const label = String(column?.label || column?.header || column?.name || '').trim();
    if (!label) return;
    if (/최저|표준|기준|요청|수량|공종|규격|단위|비고|관리/.test(label)) return;
    if (!/(단가|금액)/.test(label)) return;

    const vendor = getVendorNameFromColumn(column);
    const normalized = normalizeVendorName(vendor);
    if (!normalized) return;
    const existing = groups.get(normalized) || { vendor, unitPriceKey: null, amountKey: null, unitPriceLabel: '', amountLabel: '' };
    if (/단가/.test(label) && !existing.unitPriceKey) {
      existing.unitPriceKey = column.key;
      existing.unitPriceLabel = label;
    }
    if (/금액/.test(label) && !existing.amountKey) {
      existing.amountKey = column.key;
      existing.amountLabel = label;
    }
    groups.set(normalized, existing);
  });

  return Array.from(groups.values());
};

const getCompareVendorCount = (table) => {
  const groups = getVendorColumnGroups(table);
  if (groups.length) return groups.length;
  const meta = table?.tableJson?.meta || table?.meta || {};
  if (Number(meta.vendorCount || 0)) return Number(meta.vendorCount);
  return 0;
};

const getRequestedQuantityText = (rows) => {
  const quantities = [...new Set(rows.map((row) => row.quantity || row.request_quantity).filter((v) => v !== undefined && v !== null && String(v).trim() !== ''))];
  if (!quantities.length) return '-';
  return quantities.slice(0, 5).join(', ');
};

const getItemNameSummary = (rows, limit = 6) => {
  const names = [...new Set(rows.map((row) => row.item_name || row.itemName || row.name).filter(Boolean))];
  if (!names.length) return '-';
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} 외 ${names.length - limit}건` : shown;
};

const buildVendorSummaryCards = (table) => {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const groups = getVendorColumnGroups(table);
  if (!rows.length || !groups.length) return [];
  const lowestVendors = rows.map((row) => normalizeVendorName(row.lowest_vendor)).filter(Boolean);

  return groups.map((group) => {
    const totalAmount = rows.reduce((sum, row) => sum + parseAmountValue(row[group.amountKey]), 0);
    const avgUnitPrice = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + parseAmountValue(row[group.unitPriceKey]), 0) / rows.length)
      : 0;
    const lowestCount = lowestVendors.filter((vendor) => vendor && vendor === normalizeVendorName(group.vendor)).length;
    return {
      vendor: group.vendor,
      totalAmount,
      avgUnitPrice,
      lowestCount,
      rows: rows.length,
      desc: `최저 ${lowestCount}건 · 평균 단가 ${avgUnitPrice ? avgUnitPrice.toLocaleString() : '-'}원`,
    };
  }).sort((a, b) => {
    if (b.lowestCount !== a.lowestCount) return b.lowestCount - a.lowestCount;
    return a.totalAmount - b.totalAmount;
  });
};

const buildAnalysisTextCards = (analysis) => {
  const keyValues = Array.isArray(analysis?.keyValues) ? analysis.keyValues : [];
  const getValue = (patterns) => {
    const hit = keyValues.find((kv) => patterns.some((pattern) => pattern.test(String(kv.label || ''))));
    return hit?.value;
  };
  return [
    { label: '분석 요약', value: analysis?.summary },
    { label: 'LLM 검토', value: getValue([/LLM\s*검토/, /검토/]) },
    { label: '검색 키워드', value: getValue([/검색\s*키워드/, /키워드/]) },
    { label: 'LLM 역할', value: getValue([/LLM\s*역할/, /역할/]) },
  ].filter((item) => item.value && String(item.value).trim());
};

const buildCoreDataCards = (analysis, table, issues = []) => {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const meta = table?.tableJson?.meta || table?.meta || {};
  const tableType = table?.tableType || table?.table_type || '';
  if (isMultiVendorCompareTableType(tableType)) {
    const vendorSummaries = buildVendorSummaryCards(table);
    const bestVendorText = vendorSummaries
      .filter((item) => item.lowestCount > 0)
      .slice(0, 3)
      .map((item) => `${item.vendor} ${item.lowestCount}건`)
      .join(', ') || '-';
    const lowestTotal = rows.reduce((sum, row) => sum + parseAmountValue(row.lowest_amount), 0);
    const selectedVendors = getVendorColumnGroups(table).map((item) => item.vendor).join(', ') || '-';
    const tableColumnCount = Array.isArray(table?.columns) ? table.columns.length : 0;
    return [
      { label: '분석된 비교 행', value: `${rows.length.toLocaleString()}행` },
      { label: '표 컬럼 수', value: `${tableColumnCount.toLocaleString()}개` },
      { label: '비교 업체', value: selectedVendors },
      { label: '비교 업체 수', value: `${getCompareVendorCount(table).toLocaleString()}개` },
      { label: '요청/대상 품목', value: getItemNameSummary(rows, 6) },
      { label: '요청 수량', value: getRequestedQuantityText(rows) },
      { label: '최저 업체 요약', value: bestVendorText },
      { label: '최저 금액 합계', value: lowestTotal ? `${lowestTotal.toLocaleString()}원` : '-' },
      { label: '표준시장단가 표시', value: meta.standardPriceHidden ? '기본 숨김' : (meta.standardPriceShown ? '표시' : '기본 숨김') },
      { label: '확인 필요', value: `${issues.length}건` },
    ];
  }

  const firstRow = rows[0] || {};
  const priorityKeys = ['item_name', 'spec', 'quantity', 'unit', 'unit_price', 'amount', 'lowest_amount', 'remark'];
  const cards = priorityKeys
    .filter((key) => firstRow[key] !== undefined && String(firstRow[key] ?? '').trim() !== '')
    .map((key) => ({ label: key, value: String(firstRow[key]) }));
  if (cards.length) return cards.slice(0, 8);
  return [
    { label: '문서 유형', value: analysis?.documentType || '-' },
    { label: '표 행 수', value: `${rows.length.toLocaleString()}행` },
    { label: '확인 필요', value: `${issues.length}건` },
  ];
};

function AnalysisView({ analysis, issues, table, onMoveTable, onMoveExcel }) {
  const coreDataCards = buildCoreDataCards(analysis, table, issues);
  const vendorSummaryCards = buildVendorSummaryCards(table);
  const analysisTextCards = buildAnalysisTextCards(analysis);
  const isCompareTable = isMultiVendorCompareTableType(table?.tableType || table?.table_type || '');
  return (
    <div className="w-full max-w-none space-y-4">
      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-200 bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-6">
          <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="blue">AI 문서 분석</Badge>
                <Badge tone="green">엑셀화 가능</Badge>
                <Badge tone={issues.length ? 'amber' : 'green'}>확인 필요 {issues.length}건</Badge>
              </div>
              <h4 className="mt-4 text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">이 문서는 <span className="text-brand-700">{analysis.documentType}</span>입니다.</h4>
              <p className="mt-3 max-w-5xl text-sm leading-7 text-slate-600 lg:text-base">{analysis.summary}</p>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 2xl:w-[430px]">
              <Metric label="분석 신뢰도" value={`${analysis.confidence || 0}%`} tone="blue" />
              <Metric label="표 후보" value={`${analysis.tableCount || 0}개`} />
              <Metric label="확인 필요" value={`${analysis.issueCount || 0}건`} tone="amber" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard icon="📄" title="무슨 문서인가요?" value={analysis.documentType} desc={analysis.purpose} />
          <InfoCard icon="📊" title="무엇이 들어있나요?" value={tableTypeLabel(table.tableType || table.table_type)} desc={`${table.rows?.length || 0}개 행을 표로 만들 수 있습니다.`} />
          <InfoCard icon="🧾" title="어떤 양식에 넣나요?" value="선택 산출 방식" desc="자유형 또는 등록 양식 기준으로 엑셀 생성" />
          <InfoCard icon="⚠️" title="무엇을 확인하나요?" value={`${issues.length}건`} desc={issues[0]?.message || '현재 확인 필요 항목이 없습니다.'} warning={issues.length > 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {!!(analysis.fileProfiles || []).length && (
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card xl:col-span-2">
            <h4 className="text-lg font-black text-slate-950">첨부 파일별 분석 결과</h4>
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {(analysis.fileProfiles || []).map((file) => (
                <div key={`${file.index}-${file.fileName}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-black text-slate-950">{file.fileName}</p>
                    <Badge tone={file.role === 'COMPARE_TARGET' ? 'blue' : file.role === 'REFERENCE_PRICE' ? 'green' : 'slate'}>{file.roleLabel || file.role}</Badge>
                  </div>
                  <p className="mt-2 text-xs font-black text-brand-700">{file.documentType}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{file.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <h4 className="text-lg font-black text-slate-950">문서에서 읽은 핵심 데이터</h4>
          <p className="mt-1 text-xs font-bold text-slate-500">첫 행 1개가 아니라 현재 표 전체 기준으로 요약합니다.</p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {coreDataCards.map((item, index) => (
              <div key={`${item.label}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-black text-slate-400">{item.label}</p>
                <p className="mt-1 break-words text-sm font-black text-slate-900">{String(item.value || '-')}</p>
              </div>
            ))}
            {!coreDataCards.length && <p className="col-span-2 text-sm font-bold text-slate-400">분석 후 핵심 데이터가 표시됩니다.</p>}
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <h4 className="text-lg font-black text-slate-950">LLM 분석 적용 상태</h4>
          {analysis.llmUsage && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ['의도분석', analysis.llmUsage.intentAnalysis],
                ['표 추출', analysis.llmUsage.tableExtraction],
                ['단가 계산', analysis.llmUsage.priceCalculation],
                ['요약/검증', analysis.llmUsage.summaryAnalysis],
                ['LLM 직접 표 생성', analysis.llmUsage.structureGeneration]
              ].map(([label, item]) => (
                <div key={label} className="rounded-2xl border border-brand-100 bg-brand-50 px-3 py-3">
                  <p className="text-xs font-black text-brand-500">{label}</p>
                  <p className="mt-1 break-words text-sm font-black text-slate-900">{item?.status || '-'}</p>
                  <p className="mt-1 break-words text-[11px] font-bold text-slate-500">{item?.source || ''}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(analysis.keyValues || []).filter((kv) => /LLM|의도|검색 키워드|모델/.test(String(kv.label || ''))).slice(0, 8).map((kv, index) => (
              <div key={`${kv.label}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-black text-slate-500">{kv.label}</p>
                <p className="mt-1 break-words text-sm font-black text-slate-900">{String(kv.value ?? '-')}</p>
              </div>
            ))}
            {!analysis.llmUsage && !(analysis.keyValues || []).some((kv) => /LLM|의도|검색 키워드|모델/.test(String(kv.label || ''))) && (
              <p className="col-span-full text-sm font-bold text-slate-400">LLM 적용 상태가 아직 표시되지 않았습니다. 분석 서버 응답의 keyValues를 확인하세요.</p>
            )}
          </div>
        </div>
        {isCompareTable && vendorSummaryCards.length > 0 && (
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card xl:col-span-2">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h4 className="text-lg font-black text-slate-950">업체별 비교 요약</h4>
                <p className="mt-1 text-xs font-bold text-slate-500">현재 표에 실제 표시된 업체 컬럼만 기준으로 합계·평균·최저 횟수를 계산합니다.</p>
              </div>
              <Badge tone="blue">표 기준 자동 계산</Badge>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {vendorSummaryCards.map((item) => (
                <div key={item.vendor} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="break-words text-sm font-black text-slate-950">{item.vendor}</p>
                    {item.lowestCount > 0 && <Badge tone="green">최저 {item.lowestCount}건</Badge>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-2xl bg-white px-3 py-2">
                      <p className="text-[11px] font-black text-slate-400">합계 금액</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{item.totalAmount ? `${item.totalAmount.toLocaleString()}원` : '-'}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2">
                      <p className="text-[11px] font-black text-slate-400">평균 단가</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{item.avgUnitPrice ? `${item.avgUnitPrice.toLocaleString()}원` : '-'}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {analysisTextCards.length > 0 && (
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card xl:col-span-2">
            <h4 className="text-lg font-black text-slate-950">AI 분석 내용</h4>
            <p className="mt-1 text-xs font-bold text-slate-500">LLM 요약·검토 의견은 설명용으로 표시하고, 표 추출과 금액 계산은 파서 결과를 기준으로 유지합니다.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {analysisTextCards.map((item, index) => (
                <div key={`${item.label}-${index}`} className="rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-4">
                  <p className="text-xs font-black text-brand-600">{item.label}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{String(item.value)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <h4 className="text-lg font-black text-slate-950">엑셀화 방향</h4>
          <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50 p-4">
            <p className="text-xs font-black text-brand-700">만들 결과</p>
            <p className="mt-1 text-sm font-black text-slate-950">검토 가능한 표 기반 엑셀</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">엑셀 미리보기에서 먼저 수정하고 재검증한 뒤 엑셀로 다운로드합니다.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onMoveTable} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500">미리보기 편집</button>
            <button onClick={onMoveExcel} className="rounded-2xl bg-brand-50 px-4 py-2.5 text-xs font-black text-brand-700">엑셀 미리보기</button>
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded-[28px] border border-amber-100 bg-amber-50 p-5 shadow-card">
          <h4 className="text-lg font-black text-amber-800">사용자 확인이 필요한 항목</h4>
          <div className="mt-3 space-y-2">
            {issues.map((issue, index) => <p key={index} className="text-sm font-bold leading-6 text-amber-700">• {issue.message}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}

function formatPreviewDate() {
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}.${parts.month}.${parts.day}`;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function toPreviewNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const num = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value) {
  if (value === '' || value == null) return '';
  const num = toPreviewNumber(value);
  if (!num) return String(value ?? '');
  return num.toLocaleString();
}

function normalizePreviewVendorLabel(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*(단가|금액|견적가|견적단가)$/g, '')
    .trim();
}

function comparableCompanyName(name) {
  return String(name || '')
    .replace(/주식회사|\(주\)|㈜|（주）/g, '')
    .replace(/[\s._\-()（）\[\]{}·,]/g, '')
    .toLowerCase();
}

function isIgnoredVendorLabel(label) {
  const normalized = normalizePreviewVendorLabel(label);
  return /^(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출|공급|세액|금액|단가)$/i.test(normalized)
    || /(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출)\s*(단가|금액)?$/i.test(label || '');
}

function inferPreviewVendors(table) {
  const columns = table.columns || [];
  const rows = table.rows || [];
  const metaVendors = Array.isArray(table.tableJson?.meta?.vendors) ? table.tableJson.meta.vendors : [];
  const metaVendorByIndex = new Map();
  metaVendors.forEach((vendor, index) => {
    const actualIndex = Number.isFinite(Number(vendor?.index)) ? Number(vendor.index) : index;
    const name = vendor?.name || vendor?.vendorName || vendor?.label || vendor;
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
    const name = vendor?.name || vendor?.vendorName || vendor?.label || vendor;
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
      // vendor_1_unit_price는 1부터, meta.vendors index는 0부터 저장된다.
      const zeroIndex = rawIdx > 0 ? rawIdx - 1 : rawIdx;
      const field = keyMatch[2].toLowerCase();
      const metaVendor = metaVendorByIndex.get(zeroIndex) || metaVendorByIndex.get(rawIdx);
      const rowName = String(metaVendor?.name || metaVendor?.vendorName || metaVendor?.label || '').trim()
        || rows.find((row) => row?.[`vendor_${rawIdx}_name`] || row?.[`company_${rawIdx}_name`])?.[`vendor_${rawIdx}_name`]
        || rows.find((row) => row?.[`company_${rawIdx}_name`])?.[`company_${rawIdx}_name`];
      const labelName = normalizePreviewVendorLabel(label);
      const fallbackName = !isIgnoredVendorLabel(labelName) && /(단가|금액|견적가|견적단가)$/i.test(label) ? labelName : '';
      // 실제 회사명을 모르면 업체2/업체3 같은 가짜 업체명을 만들지 않는다.
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

function getVendorPreviewValue(row, vendor, key) {
  if (!row) return '';
  const priceMap = row.vendor_prices || row.vendorPrices || row.vendor_unit_prices || row.vendorUnitPrices;
  const amountMap = row.vendor_amounts || row.vendorAmounts;
  if (key === 'spec') return row[vendor.specKey] || row.spec || '';
  if (key === 'quantity') return row[vendor.quantityKey] || row.quantity || row.request_quantity || row.requested_quantity || '';
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

function buildTemplateVendorSlots(vendors, layoutMode) {
  const cleanVendors = vendors.filter((vendor) => vendor?.name);
  const minSlots = layoutMode === 'COMPACT_VENDOR_GROUPS' ? Math.max(cleanVendors.length, 1) : Math.max(cleanVendors.length, 3);
  const slots = [...cleanVendors];
  while (slots.length < minSlots) slots.push({ name: slots.length === 0 ? 'A업체' : `${String.fromCharCode(65 + slots.length)}업체`, empty: true });
  return slots;
}

function TemplateCell({ children, className = '', colSpan, rowSpan, align = 'center' }) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={`border border-slate-700 px-2 py-2 align-middle ${align === 'left' ? 'text-left' : 'text-center'} ${className}`}>{children}</td>
  );
}

function EditableTemplateCell({ value = '', onChange, className = '', colSpan, rowSpan, align = 'center', money = false, disabled = false, placeholder = '' }) {
  const displayValue = money ? formatMoney(value) : String(value ?? '');
  return (
    <TemplateCell colSpan={colSpan} rowSpan={rowSpan} align={align} className={`p-0 ${className}`}>
      <input
        value={displayValue}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled || !onChange}
        placeholder={placeholder}
        className={`h-full min-h-[34px] w-full border-0 bg-transparent px-2 py-2 text-[11px] font-black outline-none focus:bg-brand-50 focus:ring-2 focus:ring-inset focus:ring-brand-400 ${align === 'left' ? 'text-left' : 'text-center'} disabled:cursor-default disabled:text-slate-900`}
      />
    </TemplateCell>
  );
}

function PreviewEditToolbar({ table, addRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, candidateFields = [], onCandidateAction }) {
  return (
    <div className="mb-4 rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black text-slate-900">엑셀 미리보기 직접 편집</p>
          <p className="mt-1 text-xs font-bold text-slate-500">아래 엑셀 미리보기 안에서 직접 수정합니다. 행삭제는 각 행의 ×, 컬럼삭제는 아래 컬럼 관리에서 처리합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addRow} disabled={disabled} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">행 추가</button>
          <button type="button" onClick={addColumn} disabled={disabled} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">컬럼 추가</button>
          <button type="button" onClick={saveTable} disabled={disabled} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2 text-xs font-black text-white shadow-glow disabled:from-slate-300 disabled:to-slate-300">수정 저장</button>
        </div>
      </div>
      {(table?.columns || []).length > 0 && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-3">
          <p className="mb-2 text-xs font-black text-slate-800">컬럼 관리 · 이름 수정 / 컬럼 삭제</p>
          <div className="flex flex-wrap gap-2">
            {(table.columns || []).map((col) => (
              <div key={col.key} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1">
                <input
                  value={cleanTableColumnLabel(col.label || col.key)}
                  onChange={(event) => updateColumnLabel?.(col.key, event.target.value)}
                  disabled={disabled}
                  className="w-[120px] rounded-lg px-2 py-1 text-[11px] font-black outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-400"
                />
                <button type="button" onClick={() => removeColumn?.(col.key)} disabled={disabled} className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-600 hover:bg-rose-100 disabled:opacity-40">컬럼삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {candidateFields.length > 0 && (
        <div className="mt-3 space-y-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs font-bold text-amber-800">
          <p className="font-black">신규 컬럼 후보</p>
          {candidateFields.map((item) => (
            <div key={item.id || item.suggestedFieldKey || item.originalLabel} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 px-3 py-2">
              <span>{item.originalLabel} → {item.suggestedFieldKey} / {item.suggestedDataType}</span>
              <span className="flex flex-wrap gap-1">
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'ADD_STANDARD')} className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">표준필드 추가</button>
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'USE_CUSTOM')} className="rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-black text-brand-700">이번 문서만</button>
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'EXCLUDE')} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">제외</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function vendorEditKey(vendor = {}, fieldKey = '', vendorIndex = 0) {
  const idx = Number.isFinite(Number(vendor.index)) ? Number(vendor.index) + 1 : vendorIndex + 1;
  if (fieldKey === 'spec') return vendor.specKey || 'spec';
  if (fieldKey === 'quantity') return vendor.quantityKey || 'quantity';
  if (fieldKey === 'unit_price') return vendor.unitPriceKey || `vendor_${idx}_unit_price`;
  if (fieldKey === 'amount') return vendor.amountKey || `vendor_${idx}_amount`;
  return fieldKey;
}

function removeRowButton(removeRow, rowIndex, disabled) {
  if (!removeRow) return null;
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); removeRow(rowIndex); }}
      disabled={disabled}
      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-[11px] font-black text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 disabled:opacity-40"
      title="행 삭제"
    >×</button>
  );
}

function getTemplateDisplayName(selectedTemplate) {
  return String(
    selectedTemplate?.templateName
    || selectedTemplate?.template_name
    || selectedTemplate?.name
    || selectedTemplate?.title
    || ''
  );
}


function isAiGeneratedTemplate(selectedTemplate) {
  const mapping = selectedTemplate?.mapping || selectedTemplate?.mappingJson || {};
  const layout = String(mapping?.layout || '').toUpperCase();
  const code = String(selectedTemplate?.templateCode || selectedTemplate?.template_code || '').toUpperCase();
  return Boolean(mapping?.aiGenerated) || layout.startsWith('AI_GENERATED') || code.startsWith('AI_');
}

function normalizeAiPreviewFieldKey(fieldKey = '') {
  const key = String(fieldKey || '').trim();
  if (key === 'vendor_unit_price') return 'unit_price';
  if (key === 'vendor_amount') return 'amount';
  return key;
}

function uniqueAiPreviewFields(items = [], excludeKeys = []) {
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

function getAiPreviewLowest(row, vendors) {
  let best = null;
  vendors.filter((vendor) => !vendor.empty).forEach((vendor) => {
    const price = toPreviewNumber(getVendorPreviewValue(row, vendor, 'unit_price'));
    if (!price) return;
    if (!best || price < best.price) best = { vendor: vendor.name, price };
  });
  return best || { vendor: '', price: '' };
}

function getAiPreviewCellValue(row, fieldKey, rowIndex, vendors) {
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

function AiGeneratedTemplatePreview({ table, issues, selectedTemplate, writerName, updateCell, removeRow, disabled }) {
  const design = selectedTemplate?.mapping || selectedTemplate?.mappingJson || {};
  const rows = table.rows || [];
  const vendors = inferPreviewVendors(table);
  const visibleVendors = vendors.filter((vendor) => vendor?.name);
  const hasRepeatGroup = Array.isArray(design.repeatGroups) && design.repeatGroups.length > 0;
  const baseExclude = hasRepeatGroup ? ['unit_price', 'vendor_unit_price', 'amount', 'vendor_amount', 'total_amount'] : [];
  let baseColumns = uniqueAiPreviewFields(design.baseColumns, baseExclude);
  if (!baseColumns.length) {
    baseColumns = uniqueAiPreviewFields((table.columns || []).map((col) => ({ fieldKey: col.key, label: col.label || col.key })), baseExclude);
  }
  if (!baseColumns.some((item) => item.fieldKey === 'row_no')) baseColumns = [{ fieldKey: 'row_no', label: 'NO' }, ...baseColumns];

  const repeatColumns = hasRepeatGroup
    ? uniqueAiPreviewFields(design.repeatGroups?.[0]?.columns || [{ fieldKey: 'unit_price', label: '단가' }, { fieldKey: 'amount', label: '금액' }])
    : [];
  const summaryColumns = uniqueAiPreviewFields(design.summaryColumns || []);
  const outputColumns = [
    ...baseColumns.map((item) => ({ ...item, kind: 'base' })),
    ...visibleVendors.flatMap((vendor) => repeatColumns.map((item) => ({ ...item, kind: 'vendor', vendor, label: `${cleanTableColumnLabel(vendor.name)} ${item.label || item.fieldKey}` }))),
    ...summaryColumns.map((item) => ({ ...item, kind: 'summary' })),
  ];
  const hasIssues = issues.length > 0;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">AI 생성 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">DB 표준필드 기반 생성 양식에 실제 데이터가 들어갈 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{getTemplateDisplayName(selectedTemplate) || 'AI 생성 양식'}</Badge>
          <Badge tone="blue">업체 {visibleVendors.length || 0}개</Badge>
        </div>
      </div>

      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <colgroup>
            {outputColumns.map((col, index) => <col key={`ai-col-${index}`} className={col.fieldKey === 'item_name' ? 'w-[180px]' : 'w-[110px]'} />)}
          </colgroup>
          <tbody>
            <tr><TemplateCell colSpan={Math.max(outputColumns.length, 1)} className="py-4 text-xl font-black">{design.title || getTemplateDisplayName(selectedTemplate) || 'AI 추천양식'}</TemplateCell></tr>
            <tr><TemplateCell colSpan={Math.max(outputColumns.length, 1)} className="h-4 border-slate-300 bg-white"></TemplateCell></tr>
            <tr>
              <TemplateCell className="bg-slate-200">견적일자</TemplateCell>
              <TemplateCell>{formatPreviewDate()}</TemplateCell>
              <TemplateCell className="bg-slate-200">작성자</TemplateCell>
              <TemplateCell colSpan={Math.max(outputColumns.length - 3, 1)}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              {outputColumns.map((col, index) => <TemplateCell key={`ai-head-${index}`} className="bg-slate-200">{cleanTableColumnLabel(col.label || col.fieldKey)}</TemplateCell>)}
            </tr>
            {rows.map((row, rowIndex) => (
              <tr key={`ai-row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}>
                {outputColumns.map((col, colIndex) => {
                  const value = col.kind === 'vendor'
                    ? getVendorPreviewValue(row, col.vendor, col.fieldKey)
                    : getAiPreviewCellValue(row, col.fieldKey, rowIndex, visibleVendors);
                  const moneyLike = /(price|amount|cost|total|단가|금액)/i.test(String(col.fieldKey || col.label || ''));
                  const editKey = col.kind === 'vendor' ? vendorEditKey(col.vendor, col.fieldKey, colIndex) : col.fieldKey;
                  return (
                    <EditableTemplateCell
                      key={`ai-cell-${rowIndex}-${colIndex}`}
                      value={value}
                      money={moneyLike}
                      align={col.fieldKey === 'item_name' || col.fieldKey === 'remark' ? 'left' : 'center'}
                      disabled={disabled}
                      onChange={(nextValue) => updateCell?.(rowIndex, editKey, nextValue)}
                    />
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr><TemplateCell colSpan={Math.max(outputColumns.length, 1)} className="h-24 text-slate-400">행 추가 후 바로 입력할 수 있습니다.</TemplateCell></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function isProductPriceSurveyTemplate(selectedTemplate) {
  const raw = getTemplateDisplayName(selectedTemplate);
  const normalized = compactText(raw).replace(/[()_\-·ㆍ\[\]{}]/g, '');
  if (!normalized) return false;
  const hasVendor = /(업체별|업체|회사별|거래처별|vendor|company|supplier)/i.test(normalized);
  const hasPriceSurvey = /(제품가격|제품단가|가격조사|조사현황|가격현황|단가조사|productprice|pricesurvey|survey)/i.test(normalized);
  return hasVendor && hasPriceSurvey;
}

function buildProductPriceVendorSlots(vendors, templateLayoutMode) {
  const cleanVendors = vendors.filter((vendor) => vendor?.name);
  const slotCount = templateLayoutMode === 'COMPACT_VENDOR_GROUPS'
    ? Math.max(cleanVendors.length, 1)
    : Math.max(5, cleanVendors.length || 0);
  const slots = [...cleanVendors];
  while (slots.length < slotCount) slots.push({ name: `업체 ${slots.length + 1}`, empty: true });
  return slots;
}

function pickRowValue(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

function getProductPriceAverage(row, vendors) {
  const explicit = pickRowValue(row, ['average_price', 'avg_price', 'average_unit_price', '평균가격', '평균단가'], '');
  if (explicit !== '') return explicit;
  const prices = vendors
    .filter((vendor) => !vendor.empty)
    .map((vendor) => toPreviewNumber(getVendorPreviewValue(row, vendor, 'unit_price')))
    .filter((value) => value > 0);
  if (!prices.length) return '';
  return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
}

function getSelectedVendorValue(row) {
  return cleanTableColumnLabel(pickRowValue(row, [
    'selected_vendor',
    'selected_company',
    'chosen_vendor',
    'lowest_vendor',
    'best_vendor',
    'vendor_selection',
    '업체선정',
    '최저업체'
  ], ''));
}

function ProductPriceSurveyTemplatePreview({ table, issues, selectedTemplate, templateLayoutMode = 'PRESERVE_TEMPLATE', updateCell, removeRow, disabled }) {
  const vendors = inferPreviewVendors(table);
  const visibleVendors = buildProductPriceVendorSlots(vendors, templateLayoutMode);
  const rows = table.rows || [];
  const rowAreaLength = 15;
  const headerColSpan = 4 + visibleVendors.length + 3;
  const hasIssues = issues.length > 0;
  const hasDataVendorCount = vendors.length;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">등록 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">선택한 업체별 제품가격 조사현황표 양식 구조로 실제 입력 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{getTemplateDisplayName(selectedTemplate) || '업체별 제품가격 조사현황표'}</Badge>
          <Badge tone="blue">업체 {hasDataVendorCount || 0}개 · {templateLayoutMode === 'COMPACT_VENDOR_GROUPS' ? '실제 업체만 표시' : '원본 5칸 유지'}</Badge>
        </div>
      </div>

      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <colgroup>
            <col className="w-[58px]" />
            <col className="w-[180px]" />
            <col className="w-[100px]" />
            <col className="w-[70px]" />
            {visibleVendors.map((vendor, index) => <col key={`product-vendor-col-${index}`} className="w-[92px]" />)}
            <col className="w-[100px]" />
            <col className="w-[110px]" />
            <col className="w-[120px]" />
          </colgroup>
          <tbody>
            <tr><TemplateCell colSpan={headerColSpan} className="py-4 text-xl font-black">업체별 제품가격 조사현황표</TemplateCell></tr>
            <tr><TemplateCell colSpan={headerColSpan} className="h-4 border-slate-300 bg-white"></TemplateCell></tr>
            <tr>
              <TemplateCell rowSpan={2} className="bg-emerald-100">번호</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">제품명</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">규격</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">단위</TemplateCell>
              <TemplateCell colSpan={visibleVendors.length} className="bg-emerald-100">제품 단가 조사현황</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">평균가격</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">업체선정</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">비고</TemplateCell>
            </tr>
            <tr>
              {visibleVendors.map((vendor, index) => (
                <TemplateCell key={`product-vendor-head-${index}`} className={`${vendor.empty ? 'bg-emerald-50 text-slate-400' : 'bg-emerald-100'}`}>
                  {vendor.empty ? `업체 ${index + 1}` : cleanTableColumnLabel(vendor.name)}
                </TemplateCell>
              ))}
            </tr>
            {rows.slice(0, rowAreaLength).map((row, rowIndex) => (
              <tr key={`product-row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || row.no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell align="left" className="break-keep" value={pickRowValue(row, ['product_name', 'item_name', 'work_item_name', '공종명칭', '제품명'])} onChange={(value) => updateCell?.(rowIndex, row.product_name !== undefined ? 'product_name' : 'item_name', value)} disabled={disabled} />
                <EditableTemplateCell value={pickRowValue(row, ['spec', 'standard', 'size', '규격'])} onChange={(value) => updateCell?.(rowIndex, 'spec', value)} disabled={disabled} />
                <EditableTemplateCell value={pickRowValue(row, ['unit', '단위'])} onChange={(value) => updateCell?.(rowIndex, 'unit', value)} disabled={disabled} />
                {visibleVendors.map((vendor, vendorIndex) => (
                  <EditableTemplateCell key={`product-value-${rowIndex}-${vendorIndex}`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'unit_price')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'unit_price', vendorIndex), value)} disabled={disabled || vendor.empty} />
                ))}
                <TemplateCell>{formatMoney(getProductPriceAverage(row, visibleVendors))}</TemplateCell>
                <EditableTemplateCell value={getSelectedVendorValue(row)} onChange={(value) => updateCell?.(rowIndex, 'selected_vendor', value)} disabled={disabled} />
                <EditableTemplateCell align="left" value={pickRowValue(row, ['remark', 'note', 'memo', '비고'])} onChange={(value) => updateCell?.(rowIndex, 'remark', value)} disabled={disabled} />
              </tr>
            ))}
            {Array.from({ length: Math.max(0, rowAreaLength - rows.slice(0, rowAreaLength).length) }).map((_, idx) => (
              <tr key={`product-empty-${idx}`} className={idx % 2 ? 'bg-slate-50' : 'bg-white'}>
                <TemplateCell>{rows.length + idx + 1}</TemplateCell>
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
                {visibleVendors.map((vendor, vendorIndex) => <TemplateCell key={`product-empty-${idx}-${vendorIndex}`}></TemplateCell>)}
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyTemplatePreview({ table, issues, selectedTemplate, writerName, templateLayoutMode = 'PRESERVE_TEMPLATE', updateCell, removeRow, disabled }) {
  if (isAiGeneratedTemplate(selectedTemplate)) {
    return <AiGeneratedTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (isProductPriceSurveyTemplate(selectedTemplate)) {
    return <ProductPriceSurveyTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} templateLayoutMode={templateLayoutMode} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }

  const vendors = inferPreviewVendors(table);
  const visibleVendors = buildTemplateVendorSlots(vendors, templateLayoutMode);
  const rows = table.rows || [];
  const headerColSpan = 2 + visibleVendors.length * 4;
  const hasIssues = issues.length > 0;
  const rowAreaLength = 16;
  const headerLeftSpan = Math.max(2, headerColSpan - 8);
  const hasDataVendorCount = vendors.length;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">등록 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">원본 비교견적서 양식 구조를 기준으로 실제 입력 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{selectedTemplate?.templateName || '등록 양식'}</Badge>
          <Badge tone="blue">업체 {hasDataVendorCount || 0}개 · {templateLayoutMode === 'COMPACT_VENDOR_GROUPS' ? '빈칸 숨김' : '원본 양식 유지'}</Badge>
        </div>
      </div>

      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <colgroup>
            <col className="w-[54px]" />
            <col className="w-[180px]" />
            {visibleVendors.flatMap((vendor) => [
              <col key={`${vendor.name}-spec-col`} className="w-[70px]" />,
              <col key={`${vendor.name}-qty-col`} className="w-[64px]" />,
              <col key={`${vendor.name}-price-col`} className="w-[84px]" />,
              <col key={`${vendor.name}-amount-col`} className="w-[92px]" />
            ])}
          </colgroup>
          <tbody>
            <tr><TemplateCell colSpan={headerColSpan} className="py-4 text-xl font-black">비교 견적서</TemplateCell></tr>
            <tr><TemplateCell colSpan={headerColSpan} className="h-4 border-slate-300 bg-white"></TemplateCell></tr>
            <tr>
              <TemplateCell colSpan={headerLeftSpan} align="left" className="font-semibold">아래와 같이 비교 견적서를 제출합니다.</TemplateCell>
              <TemplateCell colSpan={2} className="bg-slate-200">견적일자</TemplateCell>
              <TemplateCell colSpan={2}>{formatPreviewDate()}</TemplateCell>
              <TemplateCell colSpan={2} className="bg-slate-200">작성자</TemplateCell>
              <TemplateCell colSpan={2}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              <TemplateCell rowSpan={2} className="bg-slate-200">NO</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-slate-200">품목</TemplateCell>
              {visibleVendors.map((vendor, index) => <TemplateCell key={`vendor-head-${index}`} colSpan={4} className={`${vendor.empty ? 'bg-slate-100 text-slate-400' : 'bg-slate-200'}`}>{vendor.empty ? '' : vendor.name}</TemplateCell>)}
            </tr>
            <tr>
              {visibleVendors.flatMap((vendor, index) => ['규격', '수량', '단가', '금액'].map((label) => <TemplateCell key={`vendor-sub-${index}-${label}`} className="bg-slate-200">{label}</TemplateCell>))}
            </tr>
            {rows.slice(0, rowAreaLength).map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell align="left" className="break-keep" value={row.item_name || row.work_item_name || ''} onChange={(value) => updateCell?.(rowIndex, row.work_item_name !== undefined && row.item_name === undefined ? 'work_item_name' : 'item_name', value)} disabled={disabled} />
                {visibleVendors.flatMap((vendor, vendorIndex) => [
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-spec`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'spec')} onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'spec', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-qty`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'quantity')} onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'quantity', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-price`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'unit_price')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'unit_price', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-amount`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'amount')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'amount', vendorIndex), value)} disabled={disabled || vendor.empty} />
                ])}
              </tr>
            ))}
            {Array.from({ length: Math.max(0, rowAreaLength - rows.slice(0, rowAreaLength).length) }).map((_, idx) => (
              <tr key={`empty-${idx}`}>
                <TemplateCell>&nbsp;</TemplateCell>
                <TemplateCell></TemplateCell>
                {visibleVendors.flatMap((vendor, vendorIndex) => ['spec', 'qty', 'price', 'amount'].map((key) => <TemplateCell key={`empty-${idx}-${vendorIndex}-${key}`}></TemplateCell>))}
              </tr>
            ))}
            <tr>
              <TemplateCell colSpan={2} className="bg-slate-200 font-black">합계</TemplateCell>
              {visibleVendors.flatMap((vendor, vendorIndex) => [
                <TemplateCell key={`total-blank-${vendorIndex}`} colSpan={3}></TemplateCell>,
                <TemplateCell key={`total-value-${vendorIndex}`} className="font-black">{vendor.empty ? '' : formatMoney(rows.reduce((sum, row) => sum + toPreviewNumber(getVendorPreviewValue(row, vendor, 'amount')), 0))}</TemplateCell>
              ])}
            </tr>
            <tr>
              <TemplateCell rowSpan={2} colSpan={2} className="bg-slate-200 font-black">기타사항</TemplateCell>
              <TemplateCell colSpan={headerColSpan - 2} className="h-9 bg-emerald-50"></TemplateCell>
            </tr>
            <tr><TemplateCell colSpan={headerColSpan - 2} className="h-9 bg-emerald-50"></TemplateCell></tr>
            <tr>
              <TemplateCell colSpan={2} className="bg-slate-200 font-black">최종의견</TemplateCell>
              <TemplateCell colSpan={headerColSpan - 2} className="h-12 bg-emerald-50"></TemplateCell>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


function designBaseColumns(design = {}, table = {}) {
  const raw = Array.isArray(design.baseColumns) && design.baseColumns.length
    ? design.baseColumns
    : (table.columns || []).map((col) => ({ fieldKey: col.key, label: col.label || col.key }));
  const seen = new Set();
  return raw.map((item) => ({ key: normalizeAiPreviewFieldKey(item.fieldKey || item.key), label: item.label || item.fieldLabel || item.key || item.fieldKey }))
    .filter((item) => item.key && !seen.has(item.key) && seen.add(item.key));
}


function DesignCandidatePreview({ table, issues, design, writerName, updateCell, removeRow, disabled, updateColumnLabel, removeColumn }) {
  const layout = String(design?.layout || '').toUpperCase();
  const designId = String(design?.designId || '').toUpperCase();
  if (layout.includes('DYNAMIC_VENDOR') || layout.includes('VENDOR_COMPARE') || designId.includes('VENDOR_COMPARE')) {
    return <DesignVendorComparePreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('ESTIMATE') || designId.includes('ESTIMATE')) {
    return <DesignEstimatePreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('PRICE')) {
    return <DesignPriceTablePreview table={table} issues={issues} design={design} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('MEETING')) {
    return <DesignMeetingPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('OFFICIAL')) {
    return <DesignOfficialLetterPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('REPORT') || layout.includes('SECTION') || layout.includes('SUMMARY') || layout.includes('APPROVAL') || layout.includes('HEADER_TABLE')) {
    return <DesignReportPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />;
  }
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">{design?.name || '기본 표 양식'} 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">선택한 디자인을 단순 엑셀 표 형태로 바로 편집합니다.</p>
        </div>
        <Badge tone={issues.length ? 'amber' : 'green'}>{issues.length ? '확인 필요 행 포함' : '정상'}</Badge>
      </div>
      <EditableGrid table={table} issues={issues} updateCell={updateCell} addRow={() => {}} removeRow={removeRow} addColumn={() => {}} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={() => {}} disabled={disabled} compact={false} showToolbar={false} />
    </div>
  );
}

function getRowItemName(row = '') {
  return row.item_name || row.work_item_name || row.product_name || row.material_name || row.title || row.agenda || '';
}

function DesignEstimatePreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  const vendors = inferPreviewVendors(table).filter((vendor) => vendor?.name);
  const primaryVendor = vendors[0] || { name: '견적업체', unitPriceKey: 'unit_price', amountKey: 'amount' };
  const total = rows.reduce((sum, row) => sum + toPreviewNumber(getVendorPreviewValue(row, primaryVendor, 'amount') || row.amount), 0);
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">견적서 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">견적서 전용 구조입니다. 공급자/수신처/견적 내역/합계가 표와 다르게 배치됩니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 견적서</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-390px)] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-full min-w-[1000px] border-collapse text-center text-[12px] font-bold text-slate-900">
          <tbody>
            <tr><TemplateCell colSpan={8} className="py-5 text-3xl font-black tracking-[0.2em]">{design?.title || '견 적 서'}</TemplateCell></tr>
            <tr>
              <TemplateCell className="w-[120px] bg-slate-200">견적일자</TemplateCell><TemplateCell>{formatPreviewDate()}</TemplateCell>
              <TemplateCell className="bg-slate-200">수신</TemplateCell><EditableTemplateCell colSpan={2} align="left" value={rows[0]?.recipient || ''} onChange={(v) => updateCell?.(0, 'recipient', v)} disabled={disabled} placeholder="수신처" />
              <TemplateCell className="bg-slate-200">작성자</TemplateCell><TemplateCell colSpan={2}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              <TemplateCell className="bg-slate-200">공급자</TemplateCell><EditableTemplateCell colSpan={3} align="left" value={primaryVendor.name || ''} onChange={(v) => updateCell?.(0, 'vendor_name', v)} disabled={disabled} />
              <TemplateCell className="bg-slate-200">견적명</TemplateCell><EditableTemplateCell colSpan={3} align="left" value={rows[0]?.document_title || table.tableName || ''} onChange={(v) => updateCell?.(0, 'document_title', v)} disabled={disabled} />
            </tr>
            <tr>{['NO', '품명', '규격', '수량', '단위', '단가', '금액', '비고'].map((h) => <TemplateCell key={h} className="bg-slate-200">{h}</TemplateCell>)}</tr>
            {rows.map((row, rowIndex) => (
              <tr key={`estimate-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell align="left" value={getRowItemName(row)} onChange={(v) => updateCell?.(rowIndex, 'item_name', v)} disabled={disabled} />
                <EditableTemplateCell value={row.spec || ''} onChange={(v) => updateCell?.(rowIndex, 'spec', v)} disabled={disabled} />
                <EditableTemplateCell value={row.quantity || ''} onChange={(v) => updateCell?.(rowIndex, 'quantity', v)} disabled={disabled} />
                <EditableTemplateCell value={row.unit || ''} onChange={(v) => updateCell?.(rowIndex, 'unit', v)} disabled={disabled} />
                <EditableTemplateCell money value={getVendorPreviewValue(row, primaryVendor, 'unit_price') || row.unit_price || ''} onChange={(v) => updateCell?.(rowIndex, vendorEditKey(primaryVendor, 'unit_price', 0), v)} disabled={disabled} />
                <EditableTemplateCell money value={getVendorPreviewValue(row, primaryVendor, 'amount') || row.amount || ''} onChange={(v) => updateCell?.(rowIndex, vendorEditKey(primaryVendor, 'amount', 0), v)} disabled={disabled} />
                <EditableTemplateCell align="left" value={row.remark || ''} onChange={(v) => updateCell?.(rowIndex, 'remark', v)} disabled={disabled} />
              </tr>
            ))}
            <tr><TemplateCell colSpan={6} className="bg-slate-100 text-right font-black">합계</TemplateCell><TemplateCell className="font-black">{formatMoney(total)}</TemplateCell><TemplateCell></TemplateCell></tr>
            <tr><TemplateCell colSpan={2} className="bg-slate-200">특기사항</TemplateCell><EditableTemplateCell colSpan={6} align="left" value={rows[0]?.special_note || ''} onChange={(v) => updateCell?.(0, 'special_note', v)} disabled={disabled} placeholder="견적 조건, 납기, 유효기간 등" /></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DesignPriceTablePreview({ table, issues, design, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">단가표 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">단가표 전용 구조입니다. 견적서처럼 수신/합계 중심이 아니라 공종·규격·단가 관리 중심입니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 단가표</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-390px)] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-full min-w-[980px] border-collapse text-center text-[12px] font-bold text-slate-900">
          <tbody>
            <tr><TemplateCell colSpan={9} className="py-4 text-2xl font-black">{design?.title || '표준 단가표'}</TemplateCell></tr>
            <tr><TemplateCell colSpan={2} className="bg-slate-200">기준일</TemplateCell><TemplateCell>{formatPreviewDate()}</TemplateCell><TemplateCell colSpan={2} className="bg-slate-200">적용범위</TemplateCell><TemplateCell colSpan={4}>공사/자재/장비 단가 관리</TemplateCell></tr>
            <tr>{['NO', '공종코드', '공종명/품명', '규격', '단위', '수량', '기준단가', '금액', '비고'].map((h) => <TemplateCell key={h} className="bg-slate-200">{h}</TemplateCell>)}</tr>
            {rows.map((row, rowIndex) => (
              <tr key={`price-table-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell value={row.construction_code || row.work_code || ''} onChange={(v) => updateCell?.(rowIndex, 'construction_code', v)} disabled={disabled} />
                <EditableTemplateCell align="left" value={getRowItemName(row)} onChange={(v) => updateCell?.(rowIndex, 'item_name', v)} disabled={disabled} />
                <EditableTemplateCell value={row.spec || ''} onChange={(v) => updateCell?.(rowIndex, 'spec', v)} disabled={disabled} />
                <EditableTemplateCell value={row.unit || ''} onChange={(v) => updateCell?.(rowIndex, 'unit', v)} disabled={disabled} />
                <EditableTemplateCell value={row.quantity || ''} onChange={(v) => updateCell?.(rowIndex, 'quantity', v)} disabled={disabled} />
                <EditableTemplateCell money value={row.standard_unit_price || row.unit_price || row.vendor_unit_price || ''} onChange={(v) => updateCell?.(rowIndex, 'standard_unit_price', v)} disabled={disabled} />
                <EditableTemplateCell money value={row.amount || ''} onChange={(v) => updateCell?.(rowIndex, 'amount', v)} disabled={disabled} />
                <EditableTemplateCell align="left" value={row.remark || ''} onChange={(v) => updateCell?.(rowIndex, 'remark', v)} disabled={disabled} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DesignVendorComparePreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const vendors = inferPreviewVendors(table);
  const visibleVendors = buildTemplateVendorSlots(vendors, 'COMPACT_VENDOR_GROUPS');
  const rows = table.rows || [];
  const headerColSpan = 5 + visibleVendors.length * 2 + 3;
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">업체 비교형 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">업체별 단가·금액을 가로 반복 컬럼으로 표시하고 바로 수정합니다.</p>
        </div>
        <Badge tone="blue">업체 {vendors.length || 0}개</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-390px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <tbody>
            <tr><TemplateCell colSpan={headerColSpan} className="py-4 text-xl font-black">{design?.title || '업체별 단가 비교표'}</TemplateCell></tr>
            <tr>
              <TemplateCell colSpan={2} className="bg-slate-100">작성일</TemplateCell><TemplateCell>{formatPreviewDate()}</TemplateCell>
              <TemplateCell colSpan={2} className="bg-slate-100">작성자</TemplateCell><TemplateCell colSpan={Math.max(headerColSpan - 5, 1)}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              {['NO', '품명', '규격', '수량', '단위'].map((label) => <TemplateCell key={label} rowSpan={2} className="bg-slate-200">{label}</TemplateCell>)}
              {visibleVendors.map((vendor, index) => <TemplateCell key={`dvh-${index}`} colSpan={2} className="bg-slate-200">{vendor.empty ? '' : cleanTableColumnLabel(vendor.name)}</TemplateCell>)}
              {['최저 업체', '최저 단가', '비고'].map((label) => <TemplateCell key={label} rowSpan={2} className="bg-slate-200">{label}</TemplateCell>)}
            </tr>
            <tr>{visibleVendors.flatMap((vendor, index) => ['단가', '금액'].map((label) => <TemplateCell key={`dvs-${index}-${label}`} className="bg-slate-100">{label}</TemplateCell>))}</tr>
            {rows.map((row, rowIndex) => {
              const lowest = getAiPreviewLowest(row, visibleVendors.filter((v) => !v.empty));
              return (
                <tr key={`design-vendor-row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                  <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                  <EditableTemplateCell align="left" value={getRowItemName(row)} onChange={(value) => updateCell?.(rowIndex, 'item_name', value)} disabled={disabled} />
                  <EditableTemplateCell value={row.spec || ''} onChange={(value) => updateCell?.(rowIndex, 'spec', value)} disabled={disabled} />
                  <EditableTemplateCell value={row.quantity || ''} onChange={(value) => updateCell?.(rowIndex, 'quantity', value)} disabled={disabled} />
                  <EditableTemplateCell value={row.unit || ''} onChange={(value) => updateCell?.(rowIndex, 'unit', value)} disabled={disabled} />
                  {visibleVendors.flatMap((vendor, vendorIndex) => [
                    <EditableTemplateCell key={`dv-${rowIndex}-${vendorIndex}-p`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'unit_price')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'unit_price', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                    <EditableTemplateCell key={`dv-${rowIndex}-${vendorIndex}-a`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'amount')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'amount', vendorIndex), value)} disabled={disabled || vendor.empty} />
                  ])}
                  <EditableTemplateCell value={lowest.vendor} onChange={(value) => updateCell?.(rowIndex, 'lowest_target', value)} disabled={disabled} />
                  <EditableTemplateCell value={lowest.price} money onChange={(value) => updateCell?.(rowIndex, 'calculated_unit_price', value)} disabled={disabled} />
                  <EditableTemplateCell align="left" value={row.remark || ''} onChange={(value) => updateCell?.(rowIndex, 'remark', value)} disabled={disabled} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportSection({ number, title, value, onChange, disabled, placeholder = '' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-slate-900">{number}. {title}</p>
      <textarea
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        rows={4}
        placeholder={placeholder}
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold leading-6 text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400 disabled:bg-white"
      />
    </div>
  );
}

function DesignReportPreview({ table, issues, design, writerName, updateCell, removeRow, disabled, updateColumnLabel, removeColumn }) {
  const rows = table.rows || [];
  const first = rows[0] || {};
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">보고서 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">회사 보고서형입니다. 표 제목만 바꾸는 방식이 아니라 보고 목적·검토내용·결론·조치계획 섹션으로 편집합니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 보고서</Badge>
      </div>

      <div className="mt-5 rounded-[28px] border border-slate-300 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div>
            <p className="text-xs font-black text-slate-500">보고서 제목</p>
            <input
              value={first.report_title || first.document_title || design?.title || '업무 보고서'}
              onChange={(event) => updateCell?.(0, 'report_title', event.target.value)}
              disabled={disabled}
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-2xl font-black text-slate-950 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-300 text-center text-xs font-black">
            <div className="grid grid-cols-2 border-b border-slate-300"><div className="bg-slate-100 py-2">작성일</div><div className="py-2">{formatPreviewDate()}</div></div>
            <div className="grid grid-cols-2 border-b border-slate-300"><div className="bg-slate-100 py-2">작성자</div><div className="py-2">{writerName || '-'}</div></div>
            <div className="grid grid-cols-2"><div className="bg-slate-100 py-2">검토건수</div><div className="py-2">{rows.length}건</div></div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <ReportSection number="1" title="보고 목적" value={firstNonEmpty(sanitizeBusinessPurpose(first.report_purpose), sanitizeBusinessPurpose(first.purpose), inferBusinessPurposeFromRow(first))} onChange={(v) => updateCell?.(0, 'report_purpose', v)} disabled={disabled} placeholder="보고 목적을 입력하세요." />
          <ReportSection number="2" title="주요 검토 내용" value={first.summary || first.content || ''} onChange={(v) => updateCell?.(0, 'summary', v)} disabled={disabled} placeholder="문서 분석 내용 또는 검토 내용을 입력하세요." />
          <ReportSection number="3" title="검토 결과" value={first.issue_summary || first.review_result || first.review_opinion || ''} onChange={(v) => updateCell?.(0, 'issue_summary', v)} disabled={disabled} placeholder="검토 결과를 입력하세요." />
          <ReportSection number="4" title="조치 계획" value={first.action_plan || ''} onChange={(v) => updateCell?.(0, 'action_plan', v)} disabled={disabled} placeholder="후속 조치 계획을 입력하세요." />
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-black text-slate-900">보고서 하단 메모</p>
          <textarea
            value={first.footer_note || ''}
            onChange={(event) => updateCell?.(0, 'footer_note', event.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="추가 참고사항이나 결재 요청 문구를 입력하세요. 불필요하면 비워두면 됩니다."
            className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-white"
          />
        </div>
      </div>
    </div>
  );
}

function DesignMeetingPreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  const first = rows[0] || {};
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">회의록 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">회의록 전용 양식입니다. 회의 개요, 참석자, 안건, 결정사항, 조치사항을 분리해서 편집합니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 회의록</Badge>
      </div>

      <div className="mt-5 rounded-[28px] border border-slate-300 bg-white p-6 shadow-sm">
        <input
          value={first.meeting_title || first.document_title || design?.title || '회의록'}
          onChange={(event) => updateCell?.(0, 'meeting_title', event.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border-0 border-b-2 border-slate-300 px-3 py-3 text-center text-3xl font-black tracking-[0.25em] outline-none focus:border-brand-400"
        />
        <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-2xl border border-slate-300 text-sm font-bold md:grid-cols-4">
          <div className="bg-slate-100 px-3 py-2 text-center font-black">회의일시</div>
          <input value={first.meeting_date || formatPreviewDate()} onChange={(e) => updateCell?.(0, 'meeting_date', e.target.value)} disabled={disabled} className="border-b border-slate-300 px-3 py-2 outline-none focus:bg-brand-50 md:border-b-0 md:border-r" />
          <div className="bg-slate-100 px-3 py-2 text-center font-black">회의장소</div>
          <input value={first.meeting_place || ''} onChange={(e) => updateCell?.(0, 'meeting_place', e.target.value)} disabled={disabled} className="px-3 py-2 outline-none focus:bg-brand-50" />
          <div className="bg-slate-100 px-3 py-2 text-center font-black">작성자</div>
          <div className="border-b border-slate-300 px-3 py-2 md:border-b-0 md:border-r">{writerName || '-'}</div>
          <div className="bg-slate-100 px-3 py-2 text-center font-black">참석자</div>
          <input value={first.attendees || ''} onChange={(e) => updateCell?.(0, 'attendees', e.target.value)} disabled={disabled} className="px-3 py-2 outline-none focus:bg-brand-50" placeholder="참석자 입력" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-black text-slate-900">1. 회의 안건</p>
            <textarea value={first.agenda || getRowItemName(first)} onChange={(e) => updateCell?.(0, 'agenda', e.target.value)} disabled={disabled} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold leading-6 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400" />
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-black text-slate-900">2. 주요 논의 내용</p>
            <textarea value={first.discussion || first.content || ''} onChange={(e) => updateCell?.(0, 'discussion', e.target.value)} disabled={disabled} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold leading-6 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400" />
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-black text-slate-900">3. 결정 사항</p>
            <textarea value={first.decision || ''} onChange={(e) => updateCell?.(0, 'decision', e.target.value)} disabled={disabled} rows={4} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold leading-6 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400" />
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-sm font-black text-slate-900">4. 비고</p>
            <textarea value={first.remark || ''} onChange={(e) => updateCell?.(0, 'remark', e.target.value)} disabled={disabled} rows={4} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold leading-6 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400" />
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-black text-slate-900">5. 조치 사항</p>
          <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] border-collapse text-sm font-bold">
              <thead className="bg-slate-100"><tr>{['관리', '조치내용', '담당자', '기한', '상태'].map((h) => <th key={h} className="border border-slate-200 px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`meeting-action-${rowIndex}`}>
                    <td className="border border-slate-200 px-2 py-2 text-center">{rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</td>
                    <td className="border border-slate-200 p-1"><input value={row.action_item || row.decision || getRowItemName(row)} onChange={(e) => updateCell?.(rowIndex, 'action_item', e.target.value)} disabled={disabled} className="w-full rounded-lg px-2 py-2 outline-none focus:bg-brand-50" /></td>
                    <td className="border border-slate-200 p-1"><input value={row.owner || row.manager || ''} onChange={(e) => updateCell?.(rowIndex, 'owner', e.target.value)} disabled={disabled} className="w-full rounded-lg px-2 py-2 outline-none focus:bg-brand-50" /></td>
                    <td className="border border-slate-200 p-1"><input value={row.due_date || ''} onChange={(e) => updateCell?.(rowIndex, 'due_date', e.target.value)} disabled={disabled} className="w-full rounded-lg px-2 py-2 outline-none focus:bg-brand-50" /></td>
                    <td className="border border-slate-200 p-1"><input value={row.status || row.remark || ''} onChange={(e) => updateCell?.(rowIndex, 'status', e.target.value)} disabled={disabled} className="w-full rounded-lg px-2 py-2 outline-none focus:bg-brand-50" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignOfficialLetterPreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  const first = rows[0] || {};
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">공문 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">공문 전용 양식입니다. 수신/참조/제목/본문/붙임/발신 영역으로 편집합니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 공문</Badge>
      </div>

      <div className="mt-5 rounded-[28px] border border-slate-300 bg-white p-8 shadow-sm">
        <input
          value={first.letter_title || design?.title || '공 문'}
          onChange={(event) => updateCell?.(0, 'letter_title', event.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border-0 border-b-2 border-slate-300 px-3 py-4 text-center text-4xl font-black tracking-[0.45em] outline-none focus:border-brand-400"
        />
        <div className="mt-6 grid grid-cols-1 gap-2 text-sm font-bold">
          <div className="grid grid-cols-[120px_1fr_120px_1fr] overflow-hidden rounded-xl border border-slate-300">
            <div className="bg-slate-100 px-3 py-2 text-center font-black">문서번호</div>
            <input value={first.document_no || ''} onChange={(e) => updateCell?.(0, 'document_no', e.target.value)} disabled={disabled} className="border-r border-slate-300 px-3 py-2 outline-none focus:bg-brand-50" />
            <div className="bg-slate-100 px-3 py-2 text-center font-black">시행일자</div>
            <div className="px-3 py-2">{formatPreviewDate()}</div>
          </div>
          <div className="grid grid-cols-[120px_1fr] overflow-hidden rounded-xl border border-slate-300"><div className="bg-slate-100 px-3 py-2 text-center font-black">수신</div><input value={first.recipient || ''} onChange={(e) => updateCell?.(0, 'recipient', e.target.value)} disabled={disabled} className="px-3 py-2 outline-none focus:bg-brand-50" /></div>
          <div className="grid grid-cols-[120px_1fr] overflow-hidden rounded-xl border border-slate-300"><div className="bg-slate-100 px-3 py-2 text-center font-black">참조</div><input value={first.reference || ''} onChange={(e) => updateCell?.(0, 'reference', e.target.value)} disabled={disabled} className="px-3 py-2 outline-none focus:bg-brand-50" /></div>
          <div className="grid grid-cols-[120px_1fr] overflow-hidden rounded-xl border border-slate-300"><div className="bg-slate-100 px-3 py-2 text-center font-black">제목</div><input value={first.document_title || first.title || table.tableName || ''} onChange={(e) => updateCell?.(0, 'document_title', e.target.value)} disabled={disabled} className="px-3 py-2 font-black outline-none focus:bg-brand-50" /></div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 p-5">
          <p className="text-sm font-black text-slate-900">본문</p>
          <textarea value={first.body || first.content || first.summary || ''} onChange={(e) => updateCell?.(0, 'body', e.target.value)} disabled={disabled} rows={10} className="mt-3 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-7 outline-none focus:bg-white focus:ring-2 focus:ring-brand-400" placeholder="공문 본문을 입력하세요." />
        </div>

        <div className="mt-4 grid grid-cols-[120px_1fr] overflow-hidden rounded-xl border border-slate-300 text-sm font-bold"><div className="bg-slate-100 px-3 py-2 text-center font-black">붙임</div><input value={first.attachment_note || ''} onChange={(e) => updateCell?.(0, 'attachment_note', e.target.value)} disabled={disabled} className="px-3 py-2 outline-none focus:bg-brand-50" /></div>

        <div className="mt-8 text-right text-sm font-black leading-8">
          <input value={first.sender || '공사팀'} onChange={(e) => updateCell?.(0, 'sender', e.target.value)} disabled={disabled} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right outline-none focus:ring-2 focus:ring-brand-400" />
          <p className="mt-2 text-slate-500">작성자: {writerName || '-'}</p>
        </div>

        {rows.slice(1).length > 0 && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-900">참고 항목</p>
            <div className="mt-2 space-y-2">
              {rows.slice(1).map((row, rowIndex) => (
                <div key={`official-extra-${rowIndex}`} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold ring-1 ring-slate-200">
                  <span className="w-16 text-slate-500">참고 {rowIndex + 1}{removeRowButton(removeRow, rowIndex + 1, disabled)}</span>
                  <input value={row.content || getRowItemName(row) || ''} onChange={(e) => updateCell?.(rowIndex + 1, 'content', e.target.value)} disabled={disabled} className="min-w-0 flex-1 rounded-lg px-2 py-2 outline-none focus:bg-brand-50" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DesignSummaryPreview({ table, issues, design, updateCell, removeRow, disabled, updateColumnLabel, removeColumn }) {
  return <DesignReportPreview table={table} issues={issues} design={design} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />;
}

function EditableGrid({ table, issues = [], updateCell, addRow, removeRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, compact = false, showToolbar = true }) {
  const visibleColumns = getVisibleColumns(table.columns, table.rows);
  return (
    <div className="mt-5">
      {showToolbar && (
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addRow} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200">행 추가</button>
            <button type="button" onClick={addColumn} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200">컬럼 추가</button>
          </div>
          <button disabled={disabled} onClick={saveTable} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300">
            수정 저장
          </button>
        </div>
      )}
      <div className={`scroll-thin overflow-auto rounded-3xl border border-slate-200 ${compact ? 'max-h-[360px]' : 'max-h-[calc(100vh-420px)] min-h-[260px]'}`}>
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
            <tr>
              {visibleColumns.map((col) => (
                <th key={col.key} className="border-b border-slate-200 px-2 py-2 text-left font-black align-top">
                  <div className="flex min-w-[130px] items-center gap-1">
                    <input
                      value={cleanTableColumnLabel(col.label || col.key)}
                      onChange={(e) => updateColumnLabel?.(col.key, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1 text-xs font-black outline-none ring-1 ring-slate-200 focus:ring-brand-400"
                    />
                    <button type="button" onClick={() => removeColumn?.(col.key)} className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-600">×</button>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{col.key}</p>
                </th>
              ))}
              <th className="w-20 border-b border-slate-200 px-3 py-3">관리</th>
            </tr>
          </thead>
          <tbody>
            {(table.rows || []).map((row, rowIndex) => (
              <tr key={rowIndex} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                {visibleColumns.map((col) => (
                  <td key={col.key} className="border-b border-slate-100 p-1">
                    <input value={row[col.key] ?? ''} onChange={(e) => updateCell(rowIndex, col.key, e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm font-bold outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500" />
                  </td>
                ))}
                <td className="border-b border-slate-100 p-1"><button onClick={() => removeRow(rowIndex)} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">삭제</button></td>
              </tr>
            ))}
            {(!table.rows || table.rows.length === 0) && <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-12 text-center font-bold text-slate-400">행 추가 또는 파일 분석 후 수정할 수 있습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExcelPreview({ table, issues, outputMode, selectedTemplate, selectedDesign, writerName, templateLayoutMode, updateCell, addRow, removeRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, candidateFields = [], onCandidateAction }) {
  const isRegisteredTemplate = outputMode === 'COMPANY_TEMPLATE' && selectedTemplate;
  const activeDesign = !isRegisteredTemplate ? selectedDesign : null;
  return (
    <div className="space-y-4">
      <PreviewEditToolbar table={table} addRow={addRow} addColumn={addColumn} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={saveTable} disabled={disabled} candidateFields={candidateFields} onCandidateAction={onCandidateAction} />
      {isRegisteredTemplate ? (
        <CompanyTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} writerName={writerName} templateLayoutMode={templateLayoutMode} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />
      ) : activeDesign ? (
        <DesignCandidatePreview table={table} issues={issues} design={activeDesign} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />
      ) : (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h4 className="text-xl font-black text-slate-950">AI/자유 편집 미리보기</h4>
              <p className="mt-1 text-sm text-slate-500">추출된 데이터를 엑셀 형태로 바로 수정합니다.</p>
            </div>
            <Badge tone={issues.length ? 'amber' : 'green'}>{issues.length ? '확인 필요 행 포함' : '정상'}</Badge>
          </div>
          <EditableGrid table={table} issues={issues} updateCell={updateCell} addRow={addRow} removeRow={removeRow} addColumn={addColumn} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={saveTable} disabled={disabled} compact={false} showToolbar={false} />
        </div>
      )}
    </div>
  );
}

function TableEditor({ table, updateCell, addRow, removeRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, candidateFields = [], onCandidateAction }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">엑셀 미리보기 수정</h4>
          <p className="mt-1 text-sm text-slate-500">셀·행·컬럼을 수정한 뒤 저장 또는 재검증을 실행하세요. 신규 컬럼은 후보 필드로 저장됩니다.</p>
        </div>
        <Badge tone="green">수정 후 재검증 권장</Badge>
      </div>
      {(table?.columns || []).length > 0 && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-3">
          <p className="mb-2 text-xs font-black text-slate-800">컬럼 관리 · 이름 수정 / 컬럼 삭제</p>
          <div className="flex flex-wrap gap-2">
            {(table.columns || []).map((col) => (
              <div key={col.key} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1">
                <input
                  value={cleanTableColumnLabel(col.label || col.key)}
                  onChange={(event) => updateColumnLabel?.(col.key, event.target.value)}
                  disabled={disabled}
                  className="w-[120px] rounded-lg px-2 py-1 text-[11px] font-black outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-400"
                />
                <button type="button" onClick={() => removeColumn?.(col.key)} disabled={disabled} className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-600 hover:bg-rose-100 disabled:opacity-40">컬럼삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {candidateFields.length > 0 && (
        <div className="mt-4 space-y-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
          <p className="font-black">신규 컬럼 후보</p>
          {candidateFields.map((item) => (
            <div key={item.id || item.suggestedFieldKey} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2">
              <span>{item.originalLabel} → {item.suggestedFieldKey} / {item.suggestedDataType}</span>
              <span className="flex flex-wrap gap-1">
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'ADD_STANDARD')} className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">표준필드 추가</button>
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'USE_CUSTOM')} className="rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-black text-brand-700">이번 문서만</button>
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'EXCLUDE')} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">제외</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <EditableGrid table={table} issues={[]} updateCell={updateCell} addRow={addRow} removeRow={removeRow} addColumn={addColumn} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={saveTable} disabled={disabled} />
    </div>
  );
}

function SourceView({ files, sourceText }) {
  const normalizedFiles = files || [];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h4 className="text-lg font-black text-slate-950">첨부 파일</h4>
        <div className="mt-4 space-y-2">
          {normalizedFiles.map((file, index) => (
            <div key={file.id || index} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              <p className="truncate font-black">{file.originalName || file.name}</p>
              <p className="mt-1 text-xs text-slate-400">{file.pageCount ? `${Number(file.pageCount).toLocaleString()}페이지` : '페이지 수 미확인'} · 텍스트/OCR 보조</p>
              {file.parseMetrics?.text?.engine && <p className="mt-1 text-xs text-slate-400">엔진: {file.parseMetrics.text.engine}</p>}
            </div>
          ))}
          {!normalizedFiles.length && <p className="text-sm font-bold text-slate-400">첨부 파일 없음</p>}
        </div>

        <div className="mt-5 rounded-3xl border border-brand-100 bg-brand-50 p-4">
          <p className="text-xs font-black text-brand-700">파싱 상태</p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
            전체 텍스트는 아래 영역에 표시됩니다. LLM 입력은 설정된 글자 수만큼만 잘라서 사용하지만, 원본 파싱 텍스트 저장은 전체 기준입니다.
          </p>
        </div>
      </div>
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h4 className="text-lg font-black text-slate-950">파싱 텍스트</h4>
        <pre className="scroll-thin mt-4 max-h-[620px] overflow-auto whitespace-pre-wrap rounded-3xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">{sourceText || '분석 후 원본 텍스트가 표시됩니다.'}</pre>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, disabled, highlight }) {
  return <label className="block"><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded-2xl px-4 py-3 text-sm font-black outline-none ${highlight ? 'border-2 border-brand-500 bg-brand-50 text-brand-700' : 'border border-slate-200 bg-white text-slate-800 focus:border-brand-500'} disabled:bg-slate-100 disabled:text-slate-400`}>{options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>;
}
function Input({ label, value, onChange }) { return <label className="block"><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-brand-500" /></label>; }
function ActionButton({ label, tone, onClick, disabled }) { return <button onClick={onClick} disabled={disabled} className={`mt-5 rounded-2xl px-4 py-3 text-sm font-black disabled:bg-slate-200 disabled:text-slate-400 ${tone === 'blue' ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-glow hover:from-brand-600 hover:to-brand-500' : 'border border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{label}</button>; }
function TabButton({ active, onClick, children }) { return <button onClick={onClick} className={`rounded-2xl px-4 py-2.5 text-sm font-black ${active ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-glow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{children}</button>; }
function Badge({ tone, children }) { const cls = tone === 'blue' ? 'bg-brand-50 text-brand-700 border-brand-100' : tone === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-slate-100 text-slate-500 border-slate-200'; return <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black ${cls}`}>{children}</span>; }
function Metric({ label, value, tone }) { const color = tone === 'blue' ? 'text-brand-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-950'; return <div className="rounded-3xl border border-slate-200 bg-white p-4 text-center"><p className="text-xs font-black text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p></div>; }
function InfoCard({ icon, title, value, desc, warning }) { return <div className={`rounded-3xl border p-4 ${warning ? 'border-amber-100 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-lg">{icon}</div><p className={`mt-3 text-xs font-black ${warning ? 'text-amber-600' : 'text-slate-400'}`}>{title}</p><p className={`mt-1 text-base font-black ${warning ? 'text-amber-800' : 'text-slate-950'}`}>{value}</p><p className={`mt-1 text-sm leading-5 ${warning ? 'text-amber-700' : 'text-slate-500'}`}>{desc}</p></div>; }
