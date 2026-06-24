import { getVisibleColumns, cleanTableColumnLabel } from '../utils.js';

export function EditableGrid({ table, issues = [], updateCell, addRow, removeRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, compact = false, showToolbar = true }) {
  const visibleColumns = getVisibleColumns(table.columns, table.rows);
  return (
    <div className="mt-5">
      {showToolbar && (
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addRow} disabled={disabled} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200 disabled:opacity-50">행 추가</button>
            <button type="button" onClick={addColumn} disabled={disabled} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200 disabled:opacity-50">컬럼 추가</button>
          </div>
          <button disabled={disabled} onClick={saveTable} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300">
            수정 저장
          </button>
        </div>
      )}
      <div className={`scroll-thin overflow-auto rounded-3xl border border-slate-200 ${compact ? 'max-h-[360px]' : 'max-h-[calc(100vh-420px)] min-h-[260px]'}`}>
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 shadow-sm">
            <tr>
              {visibleColumns.map((col) => (
                <th key={col.key} className="border-b border-slate-200 px-2 py-2 text-left font-black align-top">
                  <div className="flex min-w-[130px] items-center gap-1">
                    <input
                      value={cleanTableColumnLabel(col.label || col.key)}
                      onChange={(e) => updateColumnLabel?.(col.key, e.target.value)}
                      disabled={disabled}
                      className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1 text-xs font-black outline-none ring-1 ring-slate-200 focus:ring-brand-400 disabled:opacity-70"
                    />
                    <button type="button" onClick={() => removeColumn?.(col.key)} disabled={disabled} className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-600 disabled:opacity-40">×</button>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{col.key}</p>
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
                    <input value={row[col.key] ?? ''} onChange={(e) => updateCell(rowIndex, col.key, e.target.value)} disabled={disabled} className="w-full rounded-xl px-3 py-2 text-sm font-bold outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 disabled:opacity-70" />
                  </td>
                ))}
                <td className="border-b border-slate-100 p-1"><button onClick={() => removeRow(rowIndex)} disabled={disabled} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-40">삭제</button></td>
              </tr>
            ))}
            {(!table.rows || table.rows.length === 0) && <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-12 text-center font-bold text-slate-400">행 추가 또는 파일 분석 후 수정할 수 있습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
