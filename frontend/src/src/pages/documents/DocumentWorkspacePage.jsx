import { useEffect, useMemo, useRef, useState } from 'react';
import { createChatSessionApi, createDocumentJobApi, deleteChatSessionApi, excelDownloadUrl, generateExcelApi, getChatSessionApi, getDocumentJobApi, listChatSessionsApi, listDownloadsApi, revalidateJobApi, sendAiChatApi, updateTableApi } from '../../api/documentApi.js';
import { listTemplatesApi } from '../../api/templateApi.js';
import { useAuth } from '../../context/AuthContext.jsx';

const emptyAnalysis = {
  summary: '아직 분석된 문서가 없습니다. 오른쪽 영역에서 파일과 요청 내용을 입력한 뒤 분석을 실행하세요.',
  documentType: '대기',
  confidence: 0,
  tableCount: 0,
  issueCount: 0,
  purpose: '문서 분석 대기',
  keyValues: [],
  fileProfiles: []
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

const tableTypeLabel = (tableType) => {
  if (isReferenceTableType(tableType)) return '기준서 항목 표';
  if (isStandardMarketTableType(tableType)) return '표준시장단가 표';
  if (isMultiVendorCompareTableType(tableType)) return '업체별 단가 비교표';
  return '표 데이터';
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


export default function DocumentWorkspacePage() {
  const { user } = useAuth();
  const writerName = user?.userName || user?.loginId || '';
  const [templates, setTemplates] = useState([]);
  const [tab, setTab] = useState('analysis');
  const [outputMode, setOutputMode] = useState('COMPANY_TEMPLATE');
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
  const chatFileInputRef = useRef(null);
  const pollingTimersRef = useRef({});
  const unmountedRef = useRef(false);

  useEffect(() => {
    listTemplatesApi().then((data) => {
      setTemplates(data.templates || []);
      if ((data.templates || []).length > 0) setTemplateId(String(data.templates[0].id));
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

  const selectedTemplate = useMemo(() => templates.find((item) => String(item.id) === String(templateId)), [templates, templateId]);

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
    const hasAnalysis = Boolean(jobData?.analysis);
    setAnalysis({
      summary: jobData?.analysis?.summary || (isBackgroundRunning(jobData?.status) ? '백그라운드에서 문서를 분석하고 있습니다. 완료되면 결과가 자동으로 표시됩니다.' : emptyAnalysis.summary),
      documentType: jobData?.analysis?.documentType || jobData?.analysis?.document_type || (isBackgroundRunning(jobData?.status) ? statusLabel(jobData?.status) : '업무 문서'),
      confidence: hasAnalysis ? Math.round((Number(jobData?.analysis?.confidence) || 0) * 100) : 0,
      tableCount: jobData?.tables?.length || 0,
      issueCount: jobData?.issues?.length || 0,
      purpose: jobData?.analysis?.purpose || jobData?.analysis?.documentPurpose || '문서 데이터 엑셀화',
      keyValues: jobData?.analysis?.keyValues || [],
      fileProfiles: jobData?.analysis?.fileProfiles || jobData?.analysis?.raw?.fileProfiles || []
    });
    const resultTables = Array.isArray(jobData?.tables) ? jobData.tables : [];
    setTables(resultTables);
    setSelectedTableIndex(0);
    const firstTable = resultTables[0];
    setTable({
      id: firstTable?.id,
      tableName: firstTable?.tableName || firstTable?.table_name || '문서 표 후보',
      tableType: firstTable?.tableType || firstTable?.table_type || 'NORMAL_TABLE',
      page: firstTable?.page || firstTable?.tableJson?.page || null,
      confidence: firstTable?.confidence || firstTable?.tableJson?.confidence || null,
      tableJson: firstTable?.tableJson || {},
      columns: firstTable?.columns || defaultColumns,
      rows: firstTable?.rows || []
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
    setSelectedTableIndex(nextIndex);
    setTable({
      id: selected?.id,
      tableName: selected?.tableName || selected?.table_name || '문서 표 후보',
      tableType: selected?.tableType || selected?.table_type || 'NORMAL_TABLE',
      page: selected?.page || selected?.tableJson?.page || null,
      confidence: selected?.confidence || selected?.tableJson?.confidence || null,
      tableJson: selected?.tableJson || {},
      columns: selected?.columns || defaultColumns,
      rows: selected?.rows || []
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
      return `업체별 단가 비교 기준으로 문서를 분석했습니다.${parseText} 요청한 공종/품목 기준 비교표 ${rowCount}행을 만들었습니다. 표 데이터 탭에서 A/B/C 업체 단가와 표준시장단가를 확인하세요.`;
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
        quickReplies: ['표 데이터 보여줘', '엑셀 미리보기 보여줘'],
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
          : '비교할 표 데이터가 없습니다. 원문에 근거 없는 품목·금액·단가는 만들지 않았습니다.',
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
        answer: rowCount ? `${isMultiCompareTable ? '업체별 단가 비교표' : (isReferenceTable ? '기준서 항목 표' : (isStandardMarketTable ? '표준시장단가 표' : '표 후보'))} ${rowCount}행이 있습니다. 왼쪽의 표 데이터 탭에서 직접 수정할 수 있습니다.` : '현재 표 후보 행은 없습니다. 원문에 근거 없는 품목·금액·단가는 만들지 않았습니다.',
        quickReplies: ['확인 필요한 부분만 보여줘', '엑셀 미리보기 보여줘'],
        recommendedTab: 'table'
      };
    }

    if (/(엑셀|xlsx|양식|산출|다운로드)/i.test(text)) {
      return {
        answer: generatedExcel ? '엑셀 파일이 생성되어 있습니다. 다운로드 버튼을 누르면 받을 수 있습니다.' : '엑셀을 만들려면 표 데이터를 확인한 뒤 상단의 엑셀 만들기 버튼을 누르세요.',
        quickReplies: ['표 데이터 보여줘', '확인 필요한 부분만 보여줘'],
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
        content: fallback?.answer || '채팅 서버 응답이 지연되어 현재 화면의 분석 결과 기준으로만 답변합니다. 문서 분석 결과와 표 데이터는 왼쪽 영역에서 확인하세요.',
        quickReplies: fallback?.quickReplies || ['이 문서 뭐야?', '확인 필요한 부분만 보여줘'],
      });
      if (fallback?.recommendedTab) setTab(fallback.recommendedTab);
    } finally {
      setLoading(false);
    }
  };

  const updateCell = (rowIndex, key, value) => {
    setTable((prev) => ({
      ...prev,
      rows: prev.rows.map((row, index) => index === rowIndex ? { ...row, [key]: value } : row)
    }));
  };

  const addRow = () => {
    setTable((prev) => ({ ...prev, rows: [...prev.rows, Object.fromEntries(prev.columns.map((col) => [col.key, '']))] }));
  };

  const removeRow = (rowIndex) => {
    setTable((prev) => ({ ...prev, rows: prev.rows.filter((_, index) => index !== rowIndex) }));
  };

  const saveTable = async () => {
    if (!job?.id) return;
    try {
      setLoading(true);
      const result = await updateTableApi(job.id, table);
      bindJobResult(result.job);
      setMessage('표 수정 내용을 저장했습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '표 저장 중 오류가 발생했습니다.');
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

  const createExcel = async () => {
    if (!job?.id) {
      setMessage('먼저 문서 분석을 실행하세요.');
      return;
    }
    try {
      setLoading(true);
      await saveTable();
      const result = await generateExcelApi(job.id, { fileName, templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : null, tableId: table.id || null, chatSessionId: activeSessionId || null, templateLayoutMode });
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
    <div className="space-y-4">
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
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center">
          <div className="flex min-w-[260px] items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-brand-600 font-black text-white shadow-glow">1</div>
            <div>
              <h3 className="text-lg font-black text-slate-950">엑셀 산출 설정</h3>
              <p className="text-sm text-slate-500">선택한 방식에 맞춰 데이터를 산출합니다.</p>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[170px_210px_190px_minmax(220px,1fr)_120px_120px_120px]">
            <Select label="산출 방식" value={outputMode} onChange={setOutputMode} options={[{ value: 'COMPANY_TEMPLATE', label: '자사 양식 엑셀' }, { value: 'FREE_FORM', label: '자유형 엑셀' }]} highlight />
            <Select label="자사 양식" value={templateId} onChange={setTemplateId} disabled={outputMode !== 'COMPANY_TEMPLATE'} options={(templates.length ? templates : [{ id: '', templateName: '등록된 양식 없음' }]).map((tpl) => ({ value: String(tpl.id), label: tpl.templateName }))} />
            <Select label="양식 배치" value={templateLayoutMode} onChange={setTemplateLayoutMode} disabled={outputMode !== 'COMPANY_TEMPLATE'} options={[{ value: 'COMPACT_VENDOR_GROUPS', label: '실제 업체만 표시' }, { value: 'PRESERVE_TEMPLATE', label: '원본 3칸 유지' }]} />
            <Input label="파일명" value={fileName} onChange={setFileName} />
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
        <div className="mt-3 flex flex-wrap items-center gap-2 2xl:pl-[60px]">
          <Badge tone={issues.length ? 'amber' : 'green'}>확인 필요 {issues.length}건</Badge>
          <Badge tone="green">양식 반영 {outputMode === 'COMPANY_TEMPLATE' ? '가능' : '미사용'}</Badge>
          <Badge tone="slate">선택 양식: {selectedTemplate?.templateName || '없음'}</Badge>
          {outputMode === 'COMPANY_TEMPLATE' && <Badge tone="blue">배치: {templateLayoutMode === 'COMPACT_VENDOR_GROUPS' ? '빈 업체칸 숨김' : '원본 양식 유지'}</Badge>}
        </div>
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

      <div className={`grid grid-cols-1 gap-5 2xl:h-[calc(100vh-250px)] 2xl:min-h-[680px] 2xl:items-stretch ${showResultPanel && showChatPanel ? '2xl:grid-cols-[minmax(0,1fr)_540px]' : '2xl:grid-cols-1'}`}>
        {showResultPanel && (
        <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft 2xl:h-full 2xl:min-h-0">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 lg:flex-row lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-black text-slate-950">문서 분석 및 결과 미리보기</h3>
                <Badge tone={issues.length ? 'amber' : 'green'}>확인 필요 {issues.length}건</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">문서 분석, 엑셀 미리보기, 표 데이터, 원본 텍스트를 확인합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>문서 분석</TabButton>
              <TabButton active={tab === 'excel'} onClick={() => setTab('excel')}>엑셀 미리보기</TabButton>
              <TabButton active={tab === 'table'} onClick={() => setTab('table')}>표 데이터</TabButton>
              <TabButton active={tab === 'source'} onClick={() => setTab('source')}>원본 문서</TabButton>
            </div>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
            <TableSelector tables={tables} selectedIndex={selectedTableIndex} onSelect={selectTableByIndex} />
            {tab === 'analysis' && <AnalysisView analysis={analysis} issues={issues} table={table} onMoveTable={() => setTab('table')} onMoveExcel={() => setTab('excel')} />}
            {tab === 'excel' && <ExcelPreview table={table} issues={issues} outputMode={outputMode} selectedTemplate={selectedTemplate} writerName={writerName} templateLayoutMode={templateLayoutMode} />}
            {tab === 'table' && <TableEditor table={table} updateCell={updateCell} addRow={addRow} removeRow={removeRow} saveTable={saveTable} disabled={loading} />}
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


function ChatAssistantPanel({
  files,
  handleFiles,
  removePendingFile,
  clearPendingFiles,
  fileInputRef,
  userRequest,
  setUserRequest,
  selectedTemplate,
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
  const messagesEndRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [showDownloadList, setShowDownloadList] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, loading, files.length]);

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

      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-gradient-to-b from-white to-brand-50/30 px-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-300 text-sm font-black text-white shadow-card">AI</div>
          <div className="max-w-[88%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card">
            <p className="text-sm font-bold leading-6 text-slate-700">파일을 첨부한 뒤 요청 내용을 입력하고 Enter를 누르면 파일과 요청이 함께 업로드됩니다. 분석 결과가 있으면 표/이슈 기준으로 답변합니다.</p>
            <div className="mt-3 rounded-2xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-black text-brand-700">
              현재 기준<br />{selectedTemplate?.templateName ? `자사 양식 엑셀 · ${selectedTemplate.templateName}` : '자사 양식 엑셀 · 템플릿 선택 필요'}
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
        <div ref={messagesEndRef} />
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

function AnalysisView({ analysis, issues, table, onMoveTable, onMoveExcel }) {
  const firstRow = table.rows?.[0] || {};
  return (
    <div className="space-y-4">
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
          <InfoCard icon="🧾" title="어떤 양식에 넣나요?" value="선택 산출 방식" desc="자유형 또는 자사 양식 기준으로 엑셀 생성" />
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
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(firstRow).slice(0, 6).map(([key, value]) => (
              <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-black text-slate-400">{key}</p>
                <p className="mt-1 truncate text-sm font-black text-slate-900">{String(value || '-')}</p>
              </div>
            ))}
            {!Object.keys(firstRow).length && <p className="col-span-2 text-sm font-bold text-slate-400">분석 후 핵심 데이터가 표시됩니다.</p>}
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <h4 className="text-lg font-black text-slate-950">LLM 분석 적용 상태</h4>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(analysis.keyValues || []).filter((kv) => /LLM|의도|검색 키워드|모델/.test(String(kv.label || ''))).slice(0, 8).map((kv, index) => (
              <div key={`${kv.label}-${index}`} className="rounded-2xl border border-brand-100 bg-brand-50 px-3 py-3">
                <p className="text-xs font-black text-brand-500">{kv.label}</p>
                <p className="mt-1 break-words text-sm font-black text-slate-900">{String(kv.value ?? '-')}</p>
              </div>
            ))}
            {!(analysis.keyValues || []).some((kv) => /LLM|의도|검색 키워드|모델/.test(String(kv.label || ''))) && (
              <p className="col-span-full text-sm font-bold text-slate-400">LLM 적용 상태가 아직 표시되지 않았습니다. 분석 서버 응답의 keyValues를 확인하세요.</p>
            )}
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <h4 className="text-lg font-black text-slate-950">엑셀화 방향</h4>
          <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50 p-4">
            <p className="text-xs font-black text-brand-700">만들 결과</p>
            <p className="mt-1 text-sm font-black text-slate-950">검토 가능한 표 기반 엑셀</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">표 데이터를 먼저 수정하고 재검증한 뒤 엑셀로 다운로드합니다.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onMoveTable} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500">표 수정</button>
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

function normalizeVendorName(name) {
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
  const normalized = normalizeVendorName(label);
  return /^(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출|공급|세액|금액|단가)$/i.test(normalized)
    || /(기준|표준|일반|최저|최고|차이|대비|요청|계산|산출)\s*(단가|금액)?$/i.test(label || '');
}

function inferPreviewVendors(table) {
  const columns = table.columns || [];
  const rows = table.rows || [];
  const metaVendors = Array.isArray(table.tableJson?.meta?.vendors) ? table.tableJson.meta.vendors : [];
  const map = new Map();
  const put = (name, patch = {}) => {
    const clean = normalizeVendorName(name);
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
      const idx = Number(keyMatch[1]);
      const field = keyMatch[2].toLowerCase();
      const rowName = rows.find((row) => row?.[`vendor_${idx}_name`] || row?.[`company_${idx}_name`])?.[`vendor_${idx}_name`]
        || rows.find((row) => row?.[`company_${idx}_name`])?.[`company_${idx}_name`];
      const labelName = normalizeVendorName(label);
      // vendor_1_unit_price 같은 동적 키는 숫자만으로 업체를 만들지 않는다.
      // 컬럼 라벨이 "㈜에프앤건설 단가"처럼 실제 회사명을 가진 경우 그 라벨을 사용하고,
      // 실제 이름을 알 수 없으면 가짜 "업체2" 컬럼을 만들지 않는다.
      const fallbackName = !isIgnoredVendorLabel(labelName) && /(단가|금액|견적가|견적단가)$/i.test(label) ? labelName : '';
      const vendor = put(rowName || fallbackName || (field === 'name' ? `업체${idx + 1}` : ''), { index: idx });
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

function CompanyTemplatePreview({ table, issues, selectedTemplate, writerName, templateLayoutMode = 'PRESERVE_TEMPLATE' }) {
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
          <h4 className="text-xl font-black text-slate-950">자사 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">원본 비교견적서 양식 구조를 기준으로 실제 입력 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{selectedTemplate?.templateName || '자사 양식'}</Badge>
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
                <TemplateCell>{row.row_no || rowIndex + 1}</TemplateCell>
                <TemplateCell align="left" className="break-keep">{row.item_name || row.work_item_name || ''}</TemplateCell>
                {visibleVendors.flatMap((vendor, vendorIndex) => [
                  <TemplateCell key={`${rowIndex}-${vendorIndex}-spec`}>{vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'spec')}</TemplateCell>,
                  <TemplateCell key={`${rowIndex}-${vendorIndex}-qty`}>{vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'quantity')}</TemplateCell>,
                  <TemplateCell key={`${rowIndex}-${vendorIndex}-price`}>{vendor.empty ? '' : formatMoney(getVendorPreviewValue(row, vendor, 'unit_price'))}</TemplateCell>,
                  <TemplateCell key={`${rowIndex}-${vendorIndex}-amount`}>{vendor.empty ? '' : formatMoney(getVendorPreviewValue(row, vendor, 'amount'))}</TemplateCell>
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

function ExcelPreview({ table, issues, outputMode, selectedTemplate, writerName, templateLayoutMode }) {
  if (outputMode === 'COMPANY_TEMPLATE' && selectedTemplate) {
    return <CompanyTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} writerName={writerName} templateLayoutMode={templateLayoutMode} />;
  }
  const visibleColumns = getVisibleColumns(table.columns, table.rows);
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">자유형 엑셀 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">실제 엑셀 생성 전 표 배치 결과를 확인합니다.</p>
        </div>
        <Badge tone={issues.length ? 'amber' : 'green'}>{issues.length ? '확인 필요 행 포함' : '정상'}</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[260px] overflow-auto rounded-3xl border border-slate-200">
        <table className="min-w-[760px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
            <tr>{visibleColumns.map((col) => <th key={col.key} className="border-b border-slate-200 px-4 py-3 text-left font-black">{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                {visibleColumns.map((col) => <td key={col.key} className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">{String(row[col.key] ?? '')}</td>)}
              </tr>
            ))}
            {table.rows.length === 0 && <tr><td colSpan={visibleColumns.length} className="px-4 py-12 text-center font-bold text-slate-400">표 데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableEditor({ table, updateCell, addRow, removeRow, saveTable, disabled }) {
  const visibleColumns = getVisibleColumns(table.columns, table.rows);
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">표 데이터 수정</h4>
          <p className="mt-1 text-sm text-slate-500">셀을 직접 수정한 뒤 저장 또는 재검증을 실행하세요.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={addRow} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700">행 추가</button>
          <button disabled={disabled} onClick={saveTable} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300">저장</button>
        </div>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[260px] overflow-auto rounded-3xl border border-slate-200">
        <table className="min-w-[900px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
            <tr>{visibleColumns.map((col) => <th key={col.key} className="border-b border-slate-200 px-3 py-3 text-left font-black">{col.label}</th>)}<th className="w-20 border-b border-slate-200 px-3 py-3">관리</th></tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {visibleColumns.map((col) => (
                  <td key={col.key} className="border-b border-slate-100 p-1">
                    <input value={row[col.key] ?? ''} onChange={(e) => updateCell(rowIndex, col.key, e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm font-bold outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500" />
                  </td>
                ))}
                <td className="border-b border-slate-100 p-1"><button onClick={() => removeRow(rowIndex)} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">삭제</button></td>
              </tr>
            ))}
            {table.rows.length === 0 && <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-12 text-center font-bold text-slate-400">행 추가 또는 파일 분석 후 수정할 수 있습니다.</td></tr>}
          </tbody>
        </table>
      </div>
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
