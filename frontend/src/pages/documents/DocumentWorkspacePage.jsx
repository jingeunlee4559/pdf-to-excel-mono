import { useEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import { createAiTemplateApi, createChatSessionApi, createDocumentJobApi, deleteChatSessionApi, excelDownloadUrl, generateExcelApi, getExcelPreviewApi, generateExcelPreviewOnlyApi, getChatSessionApi, getDocumentJobApi, listChatSessionsApi, listDownloadsApi, revalidateJobApi, sendAiChatApi, updateCandidateFieldApi, updateTableApi } from '../../api/documentApi.js';
import { getTemplatePreviewApi, listTemplatesApi } from '../../api/templateApi.js';
import { useAuth } from '../../context/AuthContext.jsx';

// constants
import { emptyAnalysis, defaultColumns, backgroundStatuses, completeStatuses } from '../../components/DocumentWorkspace/constants.js';

// utils
import {
  isReferenceTableType,
  isStandardMarketTableType,
  isMultiVendorCompareTableType,
  isTextVendorComparisonReportType,
  isBackgroundRunning,
  statusLabel,
  makeFileKey,
  toChatFile,
  normalizeServerMessages,
  welcomeMessage,
  mergeFileList,
  isUserRegisteredCompanyTemplate,
  mergeAiDesignOptions,
  getDraftRowFromAnalysis,
  mergeDraftIntoRows,
  isProductPriceSurveyTemplate,
} from '../../components/DocumentWorkspace/utils.js';

// ui components
import { Badge, TabButton, ActionButton, Input, Select } from '../../components/DocumentWorkspace/ui.jsx';

// page components
import { TableSelector } from '../../components/DocumentWorkspace/TableSelector.jsx';
import { SourceView } from '../../components/DocumentWorkspace/SourceView.jsx';
import { AnalysisView } from '../../components/DocumentWorkspace/AnalysisView/index.jsx';
import { ReportView } from '../../components/DocumentWorkspace/ReportView.jsx';
import { ChatAssistantPanel } from '../../components/DocumentWorkspace/ChatPanel/index.jsx';
import { ExcelPreview } from '../../components/DocumentWorkspace/ExcelPreview/index.jsx';
import { AiTemplateRecommendationBox } from '../../components/DocumentWorkspace/AiTemplateRecommendationBox.jsx';

export default function DocumentWorkspacePage() {
  const { user } = useAuth();
  const writerName = user?.userName || user?.loginId || '';
  const [templates, setTemplates] = useState([]);
  const [aiTemplateRecommendations, setAiTemplateRecommendations] = useState([]);
  const [aiTemplateDesignCandidates, setAiTemplateDesignCandidates] = useState([]);
  const [candidateFields, setCandidateFields] = useState([]);
  const [selectedDesignId, setSelectedDesignId] = useState('');
  const [chatFormatDesign, setChatFormatDesign] = useState(null);
  const [chatFormatRequest, setChatFormatRequest] = useState(null); // 채팅에서 설정한 포맷 요청 유지
  const [aiTemplateCreating, setAiTemplateCreating] = useState(false);
  const [tab, setTab] = useState('analysis');
  const [outputMode, setOutputMode] = useState('FREE_FORM');
  const [templateLayoutMode, setTemplateLayoutMode] = useState('COMPACT_VENDOR_GROUPS');
  const [templateId, setTemplateId] = useState('');
  const [templatePreview, setTemplatePreview] = useState(null);
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);
  const [templatePreviewError, setTemplatePreviewError] = useState('');
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
  const [generatedExcelPreview, setGeneratedExcelPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(''); // 단계별 로딩 메시지
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
  const selectedDesignBase = useMemo(() => {
    if (!selectedDesignId) return null;
    return aiDesignOptions.find((item) => String(item.designId || '') === String(selectedDesignId || '')) || null;
  }, [aiDesignOptions, selectedDesignId]);
  const selectedDesign = chatFormatDesign || selectedDesignBase;

  useEffect(() => {
    let cancelled = false;
    const loadTemplatePreview = async () => {
      if (outputMode !== 'COMPANY_TEMPLATE' || !selectedTemplate?.id) {
        setTemplatePreview(null);
        setTemplatePreviewError('');
        setTemplatePreviewLoading(false);
        return;
      }
      setTemplatePreviewLoading(true);
      setTemplatePreviewError('');
      try {
        const data = await getTemplatePreviewApi(selectedTemplate.id, { maxRows: 80, maxCols: 30 });
        if (cancelled) return;
        setTemplatePreview(data.preview || null);
      } catch (err) {
        if (cancelled) return;
        setTemplatePreview(null);
        setTemplatePreviewError(err.response?.data?.message || '등록 양식 원본 미리보기를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setTemplatePreviewLoading(false);
      }
    };
    loadTemplatePreview();
    return () => { cancelled = true; };
  }, [outputMode, selectedTemplate?.id]);

  useEffect(() => {
    if (outputMode !== 'FREE_FORM') return;
    if (templateId) setTemplateId('');
    if (selectedDesignId && aiDesignOptions.length && !aiDesignOptions.some((item) => String(item.designId || '') === String(selectedDesignId || ''))) {
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
    setChatFormatDesign(null);
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
        const excel = session.activeJob.excels?.[0] || null;
        setGeneratedExcel(excel);
        if (excel?.id) {
          try {
            const previewData = await getExcelPreviewApi(session.activeJob.id, excel.id);
            const preview = previewData?.preview || previewData?.excel?.preview;
            if (preview && Array.isArray(preview.rows) && preview.rows.length > 0
              && Array.isArray(preview.columns) && preview.columns.length > 0) {
              setGeneratedExcelPreview(preview);
            }
          } catch (_) {}
        }
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
      setAiTemplateDesignCandidates([]);
      setSelectedDesignId('');
      setChatFormatDesign(null);
      setTables([]);
      setSelectedTableIndex(0);
      setAnalysis(emptyAnalysis);
      setTable({ columns: defaultColumns, rows: [] });
      setIssues([]);
      setAnalyzedFiles([]);
      setSourceText('');
      setGeneratedExcel(null);
      setGeneratedExcelPreview(null);
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
    const ALLOWED_TYPES = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt', '.hwp'];
    const MAX_SIZE_MB = 30;
    const rejected = [];
    const valid = incoming.filter((f) => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      if (!ALLOWED_TYPES.includes(ext)) { rejected.push(`${f.name} (지원하지 않는 형식)`); return false; }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) { rejected.push(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB → 최대 ${MAX_SIZE_MB}MB)`); return false; }
      return true;
    });
    if (rejected.length) setMessage(`첨부 불가 파일: ${rejected.join(', ')}`);
    if (!valid.length) return;
    setPendingFiles((prev) => mergeFileList(prev, valid));
    if (!rejected.length) setMessage(`파일 ${valid.length}개 첨부됨. 분석 요청을 입력하거나 바로 분석하세요.`);
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
    const { isConfirmed } = await Swal.fire({ title: '채팅 삭제', text: '채팅 기록만 삭제됩니다. 연결된 분석 작업과 엑셀 파일은 유지됩니다.', icon: 'warning', showCancelButton: true, confirmButtonText: '삭제', cancelButtonText: '취소', confirmButtonColor: '#ef4444', reverseButtons: true });
    if (!isConfirmed) return;
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
          if (isBackgroundRunning(nextJob.status)) {
            setLoadingStep('AI 문서 분석 중... 잠시 기다려 주세요.');
          }
          if (completeStatuses.has(String(nextJob.status || '').toUpperCase())) {
            setLoadingStep('');
            const failMsg = nextJob.errorMessage || nextJob.error_message || '문서 분석이 실패했습니다.';
            setMessage(nextJob.status === 'FAILED' ? `분석 실패: ${failMsg}` : '✓ 문서 분석이 완료되었습니다.');
            if (nextJob.tables?.length && nextJob.status !== 'FAILED') {
              const hasNarrative = !!(nextJob.analysis?.narrativeReport || nextJob.analysis?.narrative_report);
              if (hasNarrative) {
                // 보고서 요청 → 보고서 탭으로만 이동, Excel 자동 생성 안 함
                setTab('report');
                appendChat({
                  role: 'assistant',
                  content: '보고서가 준비됐습니다. "보고서" 탭에서 확인하시고 PDF 다운로드도 가능합니다. 엑셀로도 필요하시면 "엑셀 만들기"를 누르세요.',
                  quickReplies: ['PDF 다운로드', '엑셀로도 만들어줘', '내용 수정하기'],
                });
              } else {
                setTab((current) => (current === 'analysis' ? 'excel' : current));
                const rowCount = nextJob.tables?.[0]?.rows?.length || 0;
                try {
                  const autoResult = await generateExcelApi(nextJob.id, {
                    outputMode: 'FREE_FORM',
                    tableId: nextJob.tables?.[0]?.id || null,
                  });
                  if (autoResult?.excel) setGeneratedExcel(autoResult.excel);
                  const preview = autoResult?.excel?.preview || autoResult?.preview;
                  if (preview && Array.isArray(preview.rows) && preview.rows.length > 0
                      && Array.isArray(preview.columns) && preview.columns.length > 0) {
                    setGeneratedExcelPreview(preview);
                  }
                  await refreshDownloads();
                } catch (_) {}
                appendChat({
                  role: 'assistant',
                  content: `분석 완료: ${rowCount}행 추출됐습니다. 엑셀 미리보기에서 수정 후 다운로드하세요.`,
                  showPreview: true,
                  quickReplies: ['보고서로 만들어줘', '비교표로 만들어줘', '이 문서 뭐야?'],
                });
              }
            }
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
      setLoadingStep('파일 업로드 중...');
      const result = await createDocumentJobApi({
        title: uploadFiles[0]?.name || '문서 분석 작업',
        userRequest: userRequest || '첨부한 문서를 분석해줘',
        outputMode,
        templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : '',
        files: uploadFiles,
        chatSessionId: activeSessionId || null
      });
      setLoadingStep('분석 대기열 등록 중...');
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
      setChatFormatRequest(null); // 새 분석 시 이전 format 요청 초기화
      setTab('analysis');
      setMessage('작업이 백그라운드 대기열에 등록되었습니다. 완료되면 결과가 자동으로 표시됩니다.');
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || '문서 분석 작업 등록 중 오류가 발생했습니다.';
      const detail = err.response?.status === 413 ? '파일 크기가 너무 큽니다. 20MB 이하 파일을 사용해 주세요.' : err.response?.status === 415 ? '지원하지 않는 파일 형식입니다. PDF, Excel, Word 파일을 사용해 주세요.' : errMsg;
      setMessage(detail);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const bindJobResult = (jobData) => {
    if (!jobData) return;
    setJob(jobData);
    const nextRecommendations = Array.isArray(jobData?.aiTemplateRecommendations) ? jobData.aiTemplateRecommendations : [];
    const serverDesigns = Array.isArray(jobData?.aiTemplateDesignCandidates) ? jobData.aiTemplateDesignCandidates : [];
    const nextDesigns = serverDesigns;
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
      llmIntentUsed: Boolean(jobData?.analysis?.llmIntentUsed || jobData?.analysis?.raw?.llmIntentUsed),
      narrativeReport: jobData?.analysis?.narrativeReport || jobData?.analysis?.narrative_report || null,
    });
    const _nr = jobData?.analysis?.narrativeReport || jobData?.analysis?.narrative_report;
    if (_nr) {
      setTab('report');
    }
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

    if (/(보고서|회의록|공문|업무보고|검토보고|일보|점검표|비교표|비교견적서|업체별\s*비교|단가비교표)/i.test(text)) {
      const formatMap = {
        '회의록': 'MEETING_MINUTES', '공문': 'OFFICIAL_LETTER',
        '비교표': 'ESTIMATE_COMPARISON', '비교견적서': 'ESTIMATE_COMPARISON', '단가비교표': 'ESTIMATE_COMPARISON',
      };
      const targetFormat = Object.entries(formatMap).find(([k]) => text.includes(k))?.[1] || 'REPORT';
      const labelMap = { REPORT: '보고서', MEETING_MINUTES: '회의록', OFFICIAL_LETTER: '공문' };
      return {
        answer: `${labelMap[targetFormat] || '보고서'} 형식으로 엑셀을 생성합니다.`,
        action: 'GENERATE_EXCEL',
        targetFormat,
        recommendedTab: 'excel',
        quickReplies: ['다운로드', '비교표로 만들어줘', '다른 형식은?']
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

      // newTable 처리: FORMAT_REQUEST 시 테이블 구조 교체
      if (chat.newTable && chat.newTable.columns && chat.newTable.rows) {
        const nt = chat.newTable;
        setTable((prev) => ({
          ...prev,
          columns: nt.columns,
          rows: nt.rows,
          tableType: nt.tableType || prev.tableType,
          tableName: nt.tableName || prev.tableName,
          _theme: nt.theme || null,
        }));
        setGeneratedExcelPreview(null);
        setTab('excel');
        if (chat.targetFormat) setChatFormatRequest({ format: chat.targetFormat, label: text, theme: nt.theme });
      }

      // targetFormat 저장 (newTable 없어도)
      if (chat.targetFormat && !chat.newTable) {
        setChatFormatRequest({ format: chat.targetFormat, label: text, theme: null });
      }

      if (chat.action === 'GENERATE_EXCEL' && job?.id) {
        const isNarrativeRequest = chat.intent === 'NARRATIVE_REPORT' || chat.targetFormat === 'NARRATIVE_REPORT';
        const hasStoredReport = !!(analysis?.narrativeReport || analysis?.narrative_report);

        // 보고서 요청: 이미 보고서가 있으면 보고서 탭으로
        if (isNarrativeRequest) {
          if (hasStoredReport) {
            setTab('report');
            appendChat({
              role: 'assistant',
              content: '보고서가 준비됐습니다. "보고서" 탭에서 확인하세요. 엑셀로도 받고 싶으시면 "엑셀 만들기"를 누르세요.',
              quickReplies: ['엑셀로도 만들어줘', '내용 수정하기'],
            });
          } else {
            // 보고서 없음 → 파일 재업로드 안내
            appendChat({
              role: 'assistant',
              content: '보고서 형식으로 생성하려면 문서 분석 시 "보고서 형식으로" 요청이 함께 있어야 합니다. "+" 버튼으로 같은 파일을 다시 첨부해 "보고서양식으로 정리해줘"라고 입력하면 바로 보고서가 생성됩니다.',
              quickReplies: ['파일 다시 첨부하기'],
            });
          }
          return;
        }

        const FORMAT_LABEL_MAP = {
          NARRATIVE_REPORT: '검토보고서', REPORT: '보고서', MEETING_MINUTES: '회의록',
          OFFICIAL_LETTER: '공문', ESTIMATE_COMPARISON: '비교견적서', VENDOR_COMPARISON: '업체비교표',
        };
        const targetLabel = FORMAT_LABEL_MAP[chat.targetFormat] || '문서';
        const userRequestForDesign = `${text} (${targetLabel} 형식으로 작성)`;
        setAiTemplateCreating(true);
        try {
          await saveTable();
          const designResult = await createAiTemplateApi(job.id, {
            tableId: table?.id || null,
            forceGeminiDesign: true,
            userRequestOverride: userRequestForDesign,
          });
          const nextDesign = designResult.design;
          if (nextDesign?.designId) {
            setAiTemplateDesignCandidates((prev) => {
              const exists = (prev || []).some((item) => String(item.designId || '') === String(nextDesign.designId || ''));
              return exists ? prev : [nextDesign, ...(prev || [])];
            });
            setSelectedDesignId(nextDesign.designId);
            setChatFormatDesign(null);
          }
          setOutputMode('FREE_FORM');
          if (designResult.job) bindJobResult(designResult.job);
          const excelResult = await generateExcelApi(job.id, {
            fileName,
            outputMode: 'FREE_FORM',
            tableId: table?.id || null,
            chatSessionId: activeSessionId || null,
            design: nextDesign || null,
            designId: nextDesign?.designId || null,
            userFormatRequest: chat.targetFormat || null,
          });
          setGeneratedExcel(excelResult.excel);
          const preview = excelResult.excel?.preview || excelResult.preview;
          if (preview?.rows?.length && preview?.columns?.length) setGeneratedExcelPreview(preview);
          await refreshDownloads();
          setTab('excel');
          appendChat({
            role: 'assistant',
            content: `"${targetLabel}" 양식으로 엑셀을 생성했습니다. 미리보기와 다운로드 버튼에서 확인하세요.`,
            quickReplies: ['다운로드', '다른 형식으로', '수정하기'],
          });
        } catch (excelErr) {
          appendChat({
            role: 'assistant',
            content: `엑셀 생성 중 오류가 발생했습니다: ${excelErr.response?.data?.message || excelErr.message}`,
            quickReplies: ['다시 시도', '이 문서 뭐야?'],
          });
        } finally {
          setAiTemplateCreating(false);
        }
      }
    } catch (err) {
      const fallback = answerFromCurrentContext(text);
      appendChat({
        role: 'assistant',
        content: fallback?.answer || '채팅 서버 응답이 지연되어 현재 화면의 분석 결과 기준으로만 답변합니다. 문서 분석 결과와 미리보기 편집 데이터는 왼쪽 영역에서 확인하세요.',
        quickReplies: fallback?.quickReplies || ['이 문서 뭐야?', '확인 필요한 부분만 보여줘'],
      });
      if (fallback?.recommendedTab) setTab(fallback.recommendedTab);
      if (fallback?.action === 'GENERATE_EXCEL' && job?.id) {
        const FORMAT_LABEL_MAP = { REPORT: '보고서', MEETING_MINUTES: '회의록', OFFICIAL_LETTER: '공문' };
        const targetLabel = FORMAT_LABEL_MAP[fallback.targetFormat] || '보고서';
        const userRequestForDesign = `${text} (${targetLabel} 형식)`;
        setAiTemplateCreating(true);
        try {
          await saveTable();
          const designResult = await createAiTemplateApi(job.id, { tableId: table?.id || null, forceGeminiDesign: true, userRequestOverride: userRequestForDesign });
          const nextDesign = designResult.design;
          if (nextDesign?.designId) {
            setAiTemplateDesignCandidates((prev) => {
              const exists = (prev || []).some((item) => String(item.designId || '') === String(nextDesign.designId || ''));
              return exists ? prev : [nextDesign, ...(prev || [])];
            });
            setSelectedDesignId(nextDesign.designId);
            setChatFormatDesign(null);
          }
          setOutputMode('FREE_FORM');
          if (designResult.job) bindJobResult(designResult.job);
          const excelResult = await generateExcelApi(job.id, { fileName, outputMode: 'FREE_FORM', tableId: table?.id || null, chatSessionId: activeSessionId || null, design: nextDesign || null, designId: nextDesign?.designId || null });
          setGeneratedExcel(excelResult.excel);
          await refreshDownloads();
          setTab('excel');
          appendChat({ role: 'assistant', content: `Gemini가 "${targetLabel}" 양식을 새로 설계하고 엑셀을 생성했습니다.`, quickReplies: ['다운로드', '다른 형식으로 바꿔줘'] });
        } catch (excelErr) {
          appendChat({ role: 'assistant', content: `엑셀 생성 중 오류: ${excelErr.response?.data?.message || excelErr.message}`, quickReplies: ['다시 시도'] });
        } finally {
          setAiTemplateCreating(false);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewCellEdit = (address, newText) => {
    setGeneratedExcelPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) => ({
          ...row,
          cells: (row.cells || []).map((cell) =>
            cell.address === address ? { ...cell, text: newText } : cell
          ),
        })),
      };
    });
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
    setGeneratedExcelPreview((prev) => {
      if (!prev || !Array.isArray(prev.rows) || !Array.isArray(prev.columns) || prev.columns.length === 0) return prev;
      const lastRowNum = prev.rows.reduce((max, r) => Math.max(max, r.rowNumber || 0), 0);
      const newRowNum = lastRowNum + 1;
      return {
        ...prev,
        rows: [...prev.rows, {
          rowNumber: newRowNum,
          heightPx: 22,
          cells: prev.columns
            .filter((col) => !col.hidden)
            .map((col) => ({ address: `${col.letter}${newRowNum}`, text: '', style: { backgroundColor: '#ffffff', textAlign: 'left' } })),
        }],
      };
    });
  };

  const removeRow = (rowIndex) => {
    setTable((prev) => ({ ...prev, rows: prev.rows.filter((_, index) => index !== rowIndex) }));
  };

  const removePreviewRow = (rowNumber) => {
    setGeneratedExcelPreview((prev) => {
      if (!prev || !Array.isArray(prev.rows)) return prev;
      return { ...prev, rows: prev.rows.filter((r) => r.rowNumber !== rowNumber) };
    });
  };

  const makeUniqueColumnKey = (base, columns = []) => {
    const clean = String(base || 'custom_field').replace(/[^a-zA-Z0-9가-힣_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'custom_field';
    const existing = new Set((columns || []).map((col) => String(col.key)));
    if (!existing.has(clean)) return clean;
    let index = 2;
    while (existing.has(`${clean}_${index}`)) index += 1;
    return `${clean}_${index}`;
  };

  const addColumn = async () => {
    const { isConfirmed, value: label } = await Swal.fire({ title: '컬럼 추가', input: 'text', inputLabel: '추가할 컬럼명을 입력하세요', inputPlaceholder: '예: 납기일, 공급조건, 설치비', showCancelButton: true, confirmButtonText: '추가', cancelButtonText: '취소', confirmButtonColor: '#6366f1', inputValidator: (v) => !v?.trim() ? '컬럼명을 입력해주세요.' : undefined });
    if (!isConfirmed || !label?.trim()) return;
    setTable((prev) => {
      const key = makeUniqueColumnKey(label, prev.columns);
      return {
        ...prev,
        columns: [...(prev.columns || []), { key, label }],
        rows: (prev.rows || []).map((row) => ({ ...row, [key]: '' })),
      };
    });
    setGeneratedExcelPreview((prev) => {
      if (!prev || !Array.isArray(prev.columns) || !Array.isArray(prev.rows)) return prev;
      const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const usedLetters = new Set(prev.columns.map((c) => c.letter));
      const nextLetter = allLetters.split('').find((l) => !usedLetters.has(l));
      if (!nextLetter) return prev;

      // 헤더 row 감지: 첫 8행 중 스타일 있는(비흰색 배경) 셀 + 텍스트가 가장 많은 row
      const isNonWhite = (bg) => {
        if (!bg) return false;
        const n = bg.replace('#', '').toLowerCase();
        return n !== 'ffffff' && n !== 'fff' && n.length >= 3;
      };
      const firstRows = prev.rows.filter((r) => r.rowNumber <= 8);
      const headerRow = firstRows.reduce((best, r) => {
        const visibleCells = (r.cells || []).filter((c) => !c.isMergedHidden);
        const styledTextCount = visibleCells.filter((c) => c.text?.trim() && isNonWhite(c.style?.backgroundColor)).length;
        return styledTextCount > (best?.score || 0) ? { row: r, score: styledTextCount } : best;
      }, null)?.row
        // fallback: 첫 8행 중 텍스트 셀이 가장 많은 row (row 1 제외)
        || firstRows.filter((r) => r.rowNumber > 1).reduce((best, r) => {
          const cnt = (r.cells || []).filter((c) => !c.isMergedHidden && c.text?.trim()).length;
          return cnt > (best?.score || 0) ? { row: r, score: cnt } : best;
        }, null)?.row;

      const headerRowNum = headerRow?.rowNumber;
      const sampleHeaderStyle = headerRow?.cells?.find((c) => !c.isMergedHidden && c.text?.trim() && isNonWhite(c.style?.backgroundColor))?.style
        || { backgroundColor: '#374151', color: '#ffffff', textAlign: 'center', fontWeight: 700 };
      const colLetters = prev.columns.map((c) => c.letter);
      const currentColCount = colLetters.length;
      const newCols = [...prev.columns, { letter: nextLetter, widthPx: 80, hidden: false }];
      const newRows = prev.rows.map((r) => {
        // 기존 셀 중 colSpan이 마지막 컬럼까지 닿는 셀을 찾아 colSpan 확장
        const updatedCells = (r.cells || []).map((cell) => {
          // colSpan > 1 인 실제 병합셀만 처리 (colSpan:1 은 비병합 일반 셀)
          if (!cell.colSpan || cell.colSpan <= 1 || cell.isMergedHidden) return cell;
          const cellLetter = cell.address.match(/^([A-Z]+)/)?.[1] || '';
          const cellColIdx = colLetters.indexOf(cellLetter);
          if (cellColIdx >= 0 && cellColIdx + cell.colSpan === currentColCount) {
            return { ...cell, colSpan: cell.colSpan + 1 };
          }
          return cell;
        });
        // 이 행의 어떤 셀이 마지막 컬럼까지 병합돼 있으면 새 셀은 숨김 처리
        const isRowFullyMerged = updatedCells.some((cell) => {
          if (cell.isMergedHidden || !cell.colSpan || cell.colSpan <= 1) return false;
          const cellLetter = cell.address.match(/^([A-Z]+)/)?.[1] || '';
          const cellColIdx = colLetters.indexOf(cellLetter);
          return cellColIdx >= 0 && cellColIdx + cell.colSpan > currentColCount;
        });
        const newCell = {
          address: `${nextLetter}${r.rowNumber}`,
          text: !isRowFullyMerged && r.rowNumber === headerRowNum ? label.trim() : '',
          style: !isRowFullyMerged && r.rowNumber === headerRowNum ? { ...sampleHeaderStyle } : { backgroundColor: '#ffffff', textAlign: 'left' },
          ...(isRowFullyMerged ? { isMergedHidden: true } : {}),
        };
        return { ...r, cells: [...updatedCells, newCell] };
      });
      return { ...prev, columns: newCols, rows: newRows };
    });
  };

  const removePreviewColumn = (letter) => {
    setGeneratedExcelPreview((prev) => {
      if (!prev || !Array.isArray(prev.columns) || !Array.isArray(prev.rows)) return prev;
      const newCols = prev.columns.filter((c) => c.letter !== letter);
      const newRows = prev.rows.map((r) => ({
        ...r,
        cells: (r.cells || []).filter((c) => {
          const cellLetter = c.address.match(/^([A-Z]+)/)?.[1];
          return cellLetter !== letter;
        }),
      }));
      return { ...prev, columns: newCols, rows: newRows };
    });
  };

  const mergePreviewCells = (topLeftAddr, rowSpan, colSpan, allAddresses) => {
    const mergeSet = new Set(allAddresses);
    setGeneratedExcelPreview((prev) => {
      if (!prev || !Array.isArray(prev.rows)) return prev;
      const newRows = prev.rows.map((row) => ({
        ...row,
        cells: (row.cells || []).map((cell) => {
          if (cell.address === topLeftAddr) {
            return { ...cell, rowSpan: rowSpan > 1 ? rowSpan : undefined, colSpan: colSpan > 1 ? colSpan : undefined };
          }
          if (mergeSet.has(cell.address) && cell.address !== topLeftAddr) {
            return { ...cell, isMergedHidden: true };
          }
          return cell;
        }),
      }));
      return { ...prev, rows: newRows };
    });
  };

  const splitPreviewCell = (address) => {
    setGeneratedExcelPreview((prev) => {
      if (!prev || !Array.isArray(prev.rows)) return prev;
      let targetCell = null;
      for (const row of prev.rows) {
        for (const cell of (row.cells || [])) {
          if (cell.address === address) { targetCell = cell; break; }
        }
        if (targetCell) break;
      }
      if (!targetCell) return prev;
      const rowSpan = targetCell.rowSpan || 1;
      const colSpan = targetCell.colSpan || 1;
      if (rowSpan <= 1 && colSpan <= 1) return prev;
      const letter = address.match(/^([A-Z]+)/)?.[1];
      const rowNum = parseInt(address.match(/([0-9]+)$/)?.[1]);
      if (!letter || !rowNum) return prev;
      const allLetters = prev.columns.map((c) => c.letter);
      const startCI = allLetters.indexOf(letter);
      const affected = new Set();
      for (let r = rowNum; r < rowNum + rowSpan; r++) {
        for (let ci = startCI; ci < startCI + colSpan; ci++) {
          if (allLetters[ci]) affected.add(`${allLetters[ci]}${r}`);
        }
      }
      const newRows = prev.rows.map((row) => ({
        ...row,
        cells: (row.cells || []).map((cell) => {
          if (cell.address === address) {
            const { rowSpan: _rs, colSpan: _cs, ...rest } = cell;
            return rest;
          }
          if (affected.has(cell.address) && cell.address !== address) {
            return { ...cell, isMergedHidden: false };
          }
          return cell;
        }),
      }));
      return { ...prev, rows: newRows };
    });
  };

  const removeColumn = async (key) => {
    if (!key) return;
    const { isConfirmed } = await Swal.fire({ title: '컬럼 삭제', text: '이 컬럼과 해당 데이터를 삭제합니다.', icon: 'warning', showCancelButton: true, confirmButtonText: '삭제', cancelButtonText: '취소', confirmButtonColor: '#ef4444', reverseButtons: true });
    if (!isConfirmed) return;
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
      const result = await createAiTemplateApi(job.id, { tableId: table.id || null, forceGeminiDesign: true });
      const newTemplate = result.template;
      const nextDesign = result.design || null;
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
      setMessage(result.message || 'Gemini가 사용자 요청에 맞춘 AI 생성 엑셀 양식을 준비했습니다. 자사 등록 양식 목록에는 섞지 않습니다.');
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
        designId: outputMode === 'FREE_FORM' ? selectedDesign?.designId : null,
        userFormatRequest: chatFormatRequest?.format || null,
        theme: chatFormatRequest?.theme || table._theme || null,
      });
      setGeneratedExcel(result.excel);
      await refreshDownloads();
      setMessage('엑셀 파일이 생성되었습니다. 다운로드 버튼을 누르세요.');
      const preview = result.excel?.preview || result.preview;
      if (preview && Array.isArray(preview.rows) && preview.rows.length > 0
          && Array.isArray(preview.columns) && preview.columns.length > 0) {
        setGeneratedExcelPreview(preview);
      } else {
        setGeneratedExcelPreview(null);
      }
      setTab('excel');
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
            onSelectDesign={(id) => { setSelectedDesignId(id); setChatFormatDesign(null); setTemplateId(''); setOutputMode('FREE_FORM'); setTab('excel'); }}
            onChangeOutputMode={changeOutputMode}
            onCreateAiTemplate={createAiTemplateFromDbFields}
            creating={aiTemplateCreating}
            loading={loading}
          />
        )}
      </section>

      {/* 단계별 로딩 표시 */}
      {loadingStep && (
        <div className="flex items-center gap-3 rounded-3xl border border-blue-100 bg-blue-50 px-5 py-3.5 text-sm font-bold text-blue-700">
          <svg className="h-4 w-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          {loadingStep}
        </div>
      )}

      {message && (
        <div className={`rounded-3xl border px-5 py-4 text-sm font-bold ${message.startsWith('분석 실패') || message.startsWith('오류') ? 'border-red-200 bg-red-50 text-red-700' : message.startsWith('✓') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-brand-100 bg-brand-50 text-brand-700'}`}>
          {message}
        </div>
      )}

      {activeProcessingList.length > 0 && (
        <div className="flex items-center gap-3 rounded-3xl border border-amber-100 bg-amber-50 px-5 py-3.5 text-sm font-bold text-amber-800">
          <svg className="h-4 w-4 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          AI 분석 진행 중: {activeProcessingList.map((item) => item.title || `작업 ${item.id}`).join(', ')}
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
              {(analysis.narrativeReport || analysis.narrative_report) && (
                <TabButton active={tab === 'report'} onClick={() => setTab('report')}>보고서</TabButton>
              )}
              {((table?.rows?.length || 0) > 0 || generatedExcelPreview) && (
                <TabButton active={tab === 'excel'} onClick={() => setTab('excel')}>엑셀 미리보기</TabButton>
              )}
              <TabButton active={tab === 'source'} onClick={() => setTab('source')}>원본 문서</TabButton>
            </div>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
            <TableSelector tables={tables} selectedIndex={selectedTableIndex} onSelect={selectTableByIndex} />
            {tab === 'analysis' && <AnalysisView analysis={analysis} issues={issues} table={table} onMoveTable={() => setTab('excel')} onMoveExcel={() => setTab('excel')} />}
            {tab === 'report' && <ReportView analysis={analysis} />}
            {tab === 'excel' && <ExcelPreview table={table} issues={issues} outputMode={outputMode} selectedTemplate={selectedTemplate} selectedDesign={selectedDesign} writerName={writerName} templateLayoutMode={templateLayoutMode} templatePreview={templatePreview} templatePreviewLoading={templatePreviewLoading} templatePreviewError={templatePreviewError} updateCell={updateCell} addRow={addRow} removeRow={removeRow} addColumn={addColumn} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={saveTable} disabled={loading} candidateFields={candidateFields} onCandidateAction={handleCandidateFieldAction} generatedExcelPreview={generatedExcelPreview} analysis={analysis} onPreviewCellEdit={handlePreviewCellEdit} onRemovePreviewRow={removePreviewRow} onRemovePreviewColumn={removePreviewColumn} onMergePreview={mergePreviewCells} onSplitPreview={splitPreviewCell} onRefreshPreview={generatedExcel && job?.id ? createExcel : null} />}
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
