import { getVisibleColumns, cleanTableColumnLabel } from '../utils.js';

export function RegisteredTemplateDataGrid({ table, issues = [], updateCell, removeRow, disabled }) {
  const visibleColumns = getVisibleColumns(table.columns, table.rows);
  return (
    <div className="scroll-thin overflow-auto rounded-3xl border border-slate-200">
      <table className="min-w-[920px] w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
          <tr>
            {visibleColumns.map((col) => (
              <th key={col.key} className="border-b border-slate-200 px-3 py-3 text-left font-black align-top">
                <span className="block min-w-[120px] truncate">{cleanTableColumnLabel(col.label || col.key)}</span>
                <span className="mt-1 block truncate text-[10px] font-bold text-slate-400">{col.key}</span>
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
                  <input value={row[col.key] ?? ''} onChange={(event) => updateCell?.(rowIndex, col.key, event.target.value)} disabled={disabled} className="w-full rounded-xl px-3 py-2 text-sm font-bold outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 disabled:cursor-default disabled:text-slate-900" />
                </td>
              ))}
              <td className="border-b border-slate-100 p-1"><button type="button" onClick={() => removeRow?.(rowIndex)} disabled={disabled} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-40">삭제</button></td>
            </tr>
          ))}
          {(!table.rows || table.rows.length === 0) && <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-12 text-center font-bold text-slate-400">행 추가 또는 파일 분석 후 수정할 수 있습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
