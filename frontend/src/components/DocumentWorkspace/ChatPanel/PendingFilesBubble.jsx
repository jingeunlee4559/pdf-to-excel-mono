export function PendingFilesBubble({ files, onRemove, onClear, onOpenList, disabled }) {
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
