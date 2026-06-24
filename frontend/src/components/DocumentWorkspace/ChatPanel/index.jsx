import { useEffect, useRef, useState } from 'react';
import { excelDownloadUrl } from '../../../api/documentApi.js';
import { Badge } from '../ui.jsx';
import { statusLabel } from '../utils.js';
import { ChatBubble } from './ChatBubble.jsx';
import { PendingFilesBubble } from './PendingFilesBubble.jsx';

export function ChatAssistantPanel({
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
  onDeleteSession,
  setTab,
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
          <ChatBubble key={msg.id} message={msg} onQuickSend={onSend} disabled={loading} onPreview={() => setTab('excel')} />
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
