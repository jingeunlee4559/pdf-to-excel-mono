import { Badge } from '../ui.jsx';
import { formatPreviewDate, removeRowButton, getRowItemName } from '../utils.js';

export function DesignOfficialLetterPreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
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
