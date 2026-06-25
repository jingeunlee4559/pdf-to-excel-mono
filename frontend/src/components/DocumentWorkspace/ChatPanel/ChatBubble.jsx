import { excelDownloadUrl } from '../../../api/documentApi.js';
import { toDisplayText } from '../utils.js';

export function ChatBubble({ message, onQuickSend, disabled, onPreview }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="ml-auto max-w-[88%] rounded-[24px] rounded-tr-md bg-gradient-to-r from-brand-500 to-brand-300 px-4 py-3 text-sm font-black leading-6 text-white shadow-glow">
        <p className="whitespace-pre-wrap">{toDisplayText(message.content, '')}</p>
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

  const showPreviewButton = message.action === 'SHOW_PREVIEW' || message.showPreview;

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xs font-black text-brand-700">AI</div>
      <div className="max-w-[88%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card">
        <p className="whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{toDisplayText(message.content, '')}</p>
        {message.generatedExcel && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onPreview} className="inline-flex items-center gap-1 rounded-2xl bg-brand-50 px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-100">
              📊 엑셀 미리보기
            </button>
            <a href={excelDownloadUrl(message.generatedExcel.jobId, message.generatedExcel.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-2xl bg-gradient-to-r from-emerald-500 to-brand-500 px-3 py-2 text-xs font-black text-white">
              ⬇ 다운로드
            </a>
          </div>
        )}
        {showPreviewButton && !message.generatedExcel && (
          <div className="mt-3">
            <button type="button" onClick={onPreview} className="inline-flex items-center gap-1 rounded-2xl bg-brand-50 px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-100">
              📊 엑셀 미리보기 열기
            </button>
          </div>
        )}
        {Array.isArray(message.quickReplies) && message.quickReplies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.quickReplies.slice(0, 3).map((text) => (
              <button
                key={toDisplayText(text, '')}
                type="button"
                disabled={disabled}
                onClick={() => onQuickSend(toDisplayText(text, ''))}
                className="rounded-2xl bg-brand-50 px-3 py-1.5 text-[11px] font-black text-brand-700 hover:bg-brand-100 disabled:opacity-50"
              >{toDisplayText(text, '')}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
