export function SourceView({ files, sourceText }) {
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
