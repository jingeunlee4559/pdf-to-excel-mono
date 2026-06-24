import { Badge } from '../ui.jsx';
import { formatPreviewDate, removeRowButton, getRowItemName } from '../utils.js';

export function DesignMeetingPreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
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
