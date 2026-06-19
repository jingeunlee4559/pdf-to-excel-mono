import { useEffect, useMemo, useRef, useState } from 'react';
import { createDocumentJobApi, excelDownloadUrl, generateExcelApi, revalidateJobApi, sendAiChatApi, updateTableApi } from '../../api/documentApi.js';
import { listTemplatesApi } from '../../api/templateApi.js';

const emptyAnalysis = {
  summary: '아직 분석된 문서가 없습니다. 오른쪽 영역에서 파일과 요청 내용을 입력한 뒤 분석을 실행하세요.',
  documentType: '대기',
  confidence: 0,
  tableCount: 0,
  issueCount: 0,
  purpose: '문서 분석 대기',
  keyValues: []
};

const defaultColumns = [
  { key: 'vendor_name', label: '업체명' },
  { key: 'item_name', label: '품목명' },
  { key: 'spec', label: '규격' },
  { key: 'quantity', label: '수량' },
  { key: 'unit_price', label: '단가' },
  { key: 'amount', label: '금액' },
  { key: 'remark', label: '비고' }
];


const makeFileKey = (file) => `${file.name}__${file.size}__${file.lastModified || 0}`;

const toChatFile = (file) => ({
  name: file.name,
  size: file.size,
  type: file.type || '',
  lastModified: file.lastModified || 0
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

export default function DocumentWorkspacePage() {
  const [templates, setTemplates] = useState([]);
  const [tab, setTab] = useState('analysis');
  const [outputMode, setOutputMode] = useState('COMPANY_TEMPLATE');
  const [templateId, setTemplateId] = useState('');
  const [fileName, setFileName] = useState(`엑셀산출물_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [analyzedFiles, setAnalyzedFiles] = useState([]);
  const [userRequest, setUserRequest] = useState('');
  const [job, setJob] = useState(null);
  const [analysis, setAnalysis] = useState(emptyAnalysis);
  const [table, setTable] = useState({ columns: defaultColumns, rows: [] });
  const [issues, setIssues] = useState([]);
  const [sourceText, setSourceText] = useState('');
  const [generatedExcel, setGeneratedExcel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: '선택한 양식 기준으로 문서를 분석합니다. 파일을 첨부하거나 “안녕”, “이 문서 뭐야?”, “단가만 비교해줘”처럼 입력해보세요.',
      quickReplies: ['안녕', '이 문서 뭐야?', '단가만 비교해줘']
    }
  ]);
  const chatFileInputRef = useRef(null);

  useEffect(() => {
    listTemplatesApi().then((data) => {
      setTemplates(data.templates || []);
      if ((data.templates || []).length > 0) setTemplateId(String(data.templates[0].id));
    }).catch(() => setTemplates([]));
  }, []);

  const selectedTemplate = useMemo(() => templates.find((item) => String(item.id) === String(templateId)), [templates, templateId]);

  const handleFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setPendingFiles((prev) => mergeFileList(prev, incoming));
    setMessage('파일이 전송 대기 목록에 추가되었습니다. 요청 내용을 입력하고 Enter 또는 전송 버튼을 누르면 업로드와 분석이 시작됩니다.');
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearPendingFiles = () => {
    setPendingFiles([]);
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
        files: uploadFiles
      });
      bindJobResult(result.job);
      setAnalyzedFiles(uploadFiles);
      setPendingFiles([]);
      setTab('analysis');
      setMessage('문서 분석이 완료되었습니다. 표 데이터는 직접 수정할 수 있습니다.');
    } catch (err) {
      setMessage(err.response?.data?.message || '문서 분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const bindJobResult = (jobData) => {
    setJob(jobData);
    setAnalysis({
      summary: jobData?.analysis?.summary || emptyAnalysis.summary,
      documentType: jobData?.analysis?.documentType || jobData?.analysis?.document_type || '업무 문서',
      confidence: Math.round((Number(jobData?.analysis?.confidence) || 0.82) * 100),
      tableCount: jobData?.tables?.length || 0,
      issueCount: jobData?.issues?.length || 0,
      purpose: jobData?.analysis?.purpose || jobData?.analysis?.documentPurpose || '문서 데이터 엑셀화',
      keyValues: jobData?.analysis?.keyValues || []
    });
    const firstTable = jobData?.tables?.[0];
    setTable({
      columns: firstTable?.columns || defaultColumns,
      rows: firstTable?.rows || []
    });
    setIssues(jobData?.issues || []);
    setSourceText((jobData?.files || []).map((file) => file.extractedText).filter(Boolean).join('\n\n'));
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
        keyValues: analysis.keyValues || []
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
    const rowCount = jobData?.tables?.[0]?.rows?.length || 0;
    const issueCount = jobData?.issues?.length || 0;

    if (/(단가|비교|최저|가격)/i.test(requestText || '')) {
      return `단가 비교 기준으로 문서를 분석했습니다. 표 후보 ${rowCount}행을 만들었고, 확인 필요 항목은 ${issueCount}건입니다. 단위가 다른 항목은 환산 기준 확인 후 비교해야 합니다.`;
    }
    if (/(문서|뭐야|무슨|내용|요약)/i.test(requestText || '')) {
      return `이 문서는 ${docType}로 보입니다. ${summary}`;
    }
    return `문서 분석이 완료되었습니다. 표 후보 ${rowCount}행, 확인 필요 ${issueCount}건입니다.`;
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
        appendChat({ role: 'assistant', content: '첨부한 파일과 요청 내용을 함께 업로드하여 새 문서 분석을 시작합니다. 잠시만 기다려주세요.' });
        const result = await createDocumentJobApi({
          title: uploadFiles[0]?.name || '문서 분석 작업',
          userRequest: text,
          outputMode,
          templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : '',
          files: uploadFiles
        });
        bindJobResult(result.job);
        setAnalyzedFiles(uploadFiles);
        setPendingFiles([]);
        setTab(/(단가|비교|표)/i.test(text) ? 'table' : 'analysis');
        appendChat({
          role: 'assistant',
          content: answerFromJob(result.job, text),
          quickReplies: ['확인 필요한 부분만 보여줘', '금액 다시 확인', '엑셀 미리보기 보여줘']
        });
        return;
      }

      const result = await sendAiChatApi({
        message: text,
        context: buildChatContext()
      });
      const chat = result.chat || result;
      appendChat({
        role: 'assistant',
        content: chat.answer || '답변을 생성하지 못했습니다.',
        quickReplies: chat.quickReplies || ['이 문서 뭐야?', '단가만 비교해줘'],
        meta: chat.llmFallback ? 'fallback' : chat.model
      });
      if (chat.recommendedTab) setTab(chat.recommendedTab);
    } catch (err) {
      appendChat({
        role: 'assistant',
        content: err.response?.data?.message || 'AI 채팅 처리 중 오류가 발생했습니다. Ollama와 ai-server 실행 상태를 확인하세요.',
        meta: 'error'
      });
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
      const result = await generateExcelApi(job.id, { fileName, templateId: outputMode === 'COMPANY_TEMPLATE' ? templateId : null });
      setGeneratedExcel(result.excel);
      setMessage('엑셀 파일이 생성되었습니다. 다운로드 버튼을 누르세요.');
    } catch (err) {
      setMessage(err.response?.data?.message || '엑셀 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white/95 px-5 py-4 shadow-card backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">문서 분석 및 엑셀화 작업</h2>
            <p className="mt-1 text-sm text-slate-500">산출 방식을 선택한 뒤 파일을 첨부하고 요청하세요.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">작업 준비됨</Badge>
            <Badge tone="green">ai-server 저장</Badge>
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

          <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[190px_230px_minmax(230px,1fr)_130px_130px_130px]">
            <Select label="산출 방식" value={outputMode} onChange={setOutputMode} options={[{ value: 'COMPANY_TEMPLATE', label: '자사 양식 엑셀' }, { value: 'FREE_FORM', label: '자유형 엑셀' }]} highlight />
            <Select label="자사 양식" value={templateId} onChange={setTemplateId} disabled={outputMode !== 'COMPANY_TEMPLATE'} options={(templates.length ? templates : [{ id: '', templateName: '등록된 양식 없음' }]).map((tpl) => ({ value: String(tpl.id), label: tpl.templateName }))} />
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
        </div>
      </section>

      {message && <div className="rounded-3xl border border-brand-100 bg-brand-50 px-5 py-4 text-sm font-bold text-brand-700">{message}</div>}

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_470px]">
        <section className="min-h-[calc(100vh-260px)] overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft">
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

          <div className="p-5">
            {tab === 'analysis' && <AnalysisView analysis={analysis} issues={issues} table={table} onMoveTable={() => setTab('table')} onMoveExcel={() => setTab('excel')} />}
            {tab === 'excel' && <ExcelPreview table={table} issues={issues} />}
            {tab === 'table' && <TableEditor table={table} updateCell={updateCell} addRow={addRow} removeRow={removeRow} saveTable={saveTable} disabled={loading} />}
            {tab === 'source' && <SourceView files={analyzedFiles} sourceText={sourceText} />}
          </div>
        </section>

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
          job={job}
          generatedExcel={generatedExcel}
          runAnalysis={runAnalysis}
          onSend={handleChatSend}
          chatMessages={chatMessages}
          setTab={setTab}
        />
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
  onSend,
  chatMessages
}) {
  const hasFiles = files.length > 0;
  const quickRequests = ['안녕', '이 문서 뭐야?', '단가만 비교해줘'];
  const messagesEndRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, loading]);

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
      className={`relative min-h-[calc(100vh-260px)] overflow-hidden rounded-[32px] border bg-white shadow-soft 2xl:sticky 2xl:top-24 ${dragActive ? 'border-brand-400 ring-4 ring-brand-100' : 'border-slate-200'}`}
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
          <p className="mt-1 text-xs font-bold text-slate-500">파일은 전송 전까지 대기 목록에만 보관됩니다.</p>
        </div>
        <Badge tone={loading ? 'amber' : 'blue'}>{loading ? '처리 중' : '준비됨'}</Badge>
      </div>

      <div className="scroll-thin flex h-[620px] flex-col gap-4 overflow-y-auto bg-gradient-to-b from-white to-brand-50/30 px-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-indigo-600 text-sm font-black text-white shadow-card">AI</div>
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

        {loading && (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xs font-black text-brand-700">AI</div>
            <div className="max-w-[88%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500 shadow-card">
              답변을 생성하는 중입니다...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-4">
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

        {hasFiles && (
          <div className="mb-3 rounded-[22px] border border-brand-100 bg-brand-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-black text-brand-700">전송 대기 파일 {files.length}개</p>
              <button
                type="button"
                onClick={clearPendingFiles}
                disabled={loading}
                className="rounded-full px-2 py-1 text-[11px] font-black text-slate-500 hover:bg-white disabled:opacity-50"
              >전체 삭제</button>
            </div>
            <div className="space-y-2">
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

        <div className="flex items-end gap-2 rounded-[26px] border border-slate-200 bg-white p-2 shadow-card focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xl font-black text-brand-700 hover:bg-brand-100"
            aria-label="파일 첨부"
          >＋</button>
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-indigo-600 text-lg font-black text-white shadow-glow hover:from-brand-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-300"
            aria-label="요청 전송"
          >▶</button>
        </div>
      </div>
    </aside>
  );
}


function ChatBubble({ message, onQuickSend, disabled }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="ml-auto max-w-[88%] rounded-[24px] rounded-tr-md bg-gradient-to-r from-brand-600 to-indigo-600 px-4 py-3 text-sm font-black leading-6 text-white shadow-glow">
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
        {message.meta && <p className="mt-2 text-[11px] font-black text-slate-400">{message.meta}</p>}
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
          <InfoCard icon="📊" title="무엇이 들어있나요?" value="표 데이터" desc={`${table.rows?.length || 0}개 행을 표로 만들 수 있습니다.`} />
          <InfoCard icon="🧾" title="어떤 양식에 넣나요?" value="선택 산출 방식" desc="자유형 또는 자사 양식 기준으로 엑셀 생성" />
          <InfoCard icon="⚠️" title="무엇을 확인하나요?" value={`${issues.length}건`} desc={issues[0]?.message || '현재 확인 필요 항목이 없습니다.'} warning={issues.length > 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
          <h4 className="text-lg font-black text-slate-950">엑셀화 방향</h4>
          <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50 p-4">
            <p className="text-xs font-black text-brand-700">만들 결과</p>
            <p className="mt-1 text-sm font-black text-slate-950">검토 가능한 표 기반 엑셀</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">표 데이터를 먼저 수정하고 재검증한 뒤 엑셀로 다운로드합니다.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onMoveTable} className="rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white shadow-card hover:bg-brand-700">표 수정</button>
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

function ExcelPreview({ table, issues }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">엑셀 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">실제 엑셀 생성 전 표 배치 결과를 확인합니다.</p>
        </div>
        <Badge tone={issues.length ? 'amber' : 'green'}>{issues.length ? '확인 필요 행 포함' : '정상'}</Badge>
      </div>
      <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200">
        <table className="min-w-[760px] w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>{table.columns.map((col) => <th key={col.key} className="border-b border-slate-200 px-4 py-3 text-left font-black">{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                {table.columns.map((col) => <td key={col.key} className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">{String(row[col.key] ?? '')}</td>)}
              </tr>
            ))}
            {table.rows.length === 0 && <tr><td colSpan={table.columns.length} className="px-4 py-12 text-center font-bold text-slate-400">표 데이터가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableEditor({ table, updateCell, addRow, removeRow, saveTable, disabled }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">표 데이터 수정</h4>
          <p className="mt-1 text-sm text-slate-500">셀을 직접 수정한 뒤 저장 또는 재검증을 실행하세요.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={addRow} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700">행 추가</button>
          <button disabled={disabled} onClick={saveTable} className="rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-400">저장</button>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200">
        <table className="min-w-[900px] w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>{table.columns.map((col) => <th key={col.key} className="border-b border-slate-200 px-3 py-3 text-left font-black">{col.label}</th>)}<th className="w-20 border-b border-slate-200 px-3 py-3">관리</th></tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {table.columns.map((col) => (
                  <td key={col.key} className="border-b border-slate-100 p-1">
                    <input value={row[col.key] ?? ''} onChange={(e) => updateCell(rowIndex, col.key, e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm font-bold outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500" />
                  </td>
                ))}
                <td className="border-b border-slate-100 p-1"><button onClick={() => removeRow(rowIndex)} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">삭제</button></td>
              </tr>
            ))}
            {table.rows.length === 0 && <tr><td colSpan={table.columns.length + 1} className="px-4 py-12 text-center font-bold text-slate-400">행 추가 또는 파일 분석 후 수정할 수 있습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceView({ files, sourceText }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h4 className="text-lg font-black text-slate-950">첨부 파일</h4>
        <div className="mt-4 space-y-2">
          {files.map((file, index) => <div key={index} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{file.name}</div>)}
          {!files.length && <p className="text-sm font-bold text-slate-400">첨부 파일 없음</p>}
        </div>
      </div>
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h4 className="text-lg font-black text-slate-950">파싱 텍스트</h4>
        <pre className="scroll-thin mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap rounded-3xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">{sourceText || '분석 후 원본 텍스트가 표시됩니다.'}</pre>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, disabled, highlight }) {
  return <label className="block"><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded-2xl px-4 py-3 text-sm font-black outline-none ${highlight ? 'border-2 border-brand-500 bg-brand-50 text-brand-700' : 'border border-slate-200 bg-white text-slate-800 focus:border-brand-500'} disabled:bg-slate-100 disabled:text-slate-400`}>{options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>;
}
function Input({ label, value, onChange }) { return <label className="block"><span className="mb-1 block text-xs font-black text-slate-400">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-brand-500" /></label>; }
function ActionButton({ label, tone, onClick, disabled }) { return <button onClick={onClick} disabled={disabled} className={`mt-5 rounded-2xl px-4 py-3 text-sm font-black disabled:bg-slate-200 disabled:text-slate-400 ${tone === 'blue' ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{label}</button>; }
function TabButton({ active, onClick, children }) { return <button onClick={onClick} className={`rounded-2xl px-4 py-2.5 text-sm font-black ${active ? 'bg-brand-600 text-white shadow-card' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{children}</button>; }
function Badge({ tone, children }) { const cls = tone === 'blue' ? 'bg-brand-50 text-brand-700 border-brand-100' : tone === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-slate-100 text-slate-500 border-slate-200'; return <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black ${cls}`}>{children}</span>; }
function Metric({ label, value, tone }) { const color = tone === 'blue' ? 'text-brand-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-950'; return <div className="rounded-3xl border border-slate-200 bg-white p-4 text-center"><p className="text-xs font-black text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p></div>; }
function InfoCard({ icon, title, value, desc, warning }) { return <div className={`rounded-3xl border p-4 ${warning ? 'border-amber-100 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-lg">{icon}</div><p className={`mt-3 text-xs font-black ${warning ? 'text-amber-600' : 'text-slate-400'}`}>{title}</p><p className={`mt-1 text-base font-black ${warning ? 'text-amber-800' : 'text-slate-950'}`}>{value}</p><p className={`mt-1 text-sm leading-5 ${warning ? 'text-amber-700' : 'text-slate-500'}`}>{desc}</p></div>; }
