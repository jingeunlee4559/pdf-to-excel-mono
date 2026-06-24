import { cleanTableColumnLabel } from '../utils.js';

export function PreviewEditToolbar({ table, addRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, candidateFields = [], onCandidateAction, showColumnTools = true }) {
  return (
    <div className="mb-4 rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black text-slate-900">엑셀 미리보기 직접 편집</p>
          <p className="mt-1 text-xs font-bold text-slate-500">{showColumnTools ? '아래 데이터 표를 기준으로 셀·행·컬럼을 직접 수정합니다. 등록 회사 양식도 수정용 데이터 표에서 컬럼을 추가할 수 있습니다.' : '아래 엑셀 미리보기 안에서 직접 수정합니다. 행삭제는 각 행의 ×, 컬럼삭제는 아래 컬럼 관리에서 처리합니다.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addRow} disabled={disabled} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">행 추가</button>
          {showColumnTools && <button type="button" onClick={addColumn} disabled={disabled} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">컬럼 추가</button>}
          <button type="button" onClick={saveTable} disabled={disabled} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2 text-xs font-black text-white shadow-glow disabled:from-slate-300 disabled:to-slate-300">수정 저장</button>
        </div>
      </div>
      {showColumnTools && (table?.columns || []).length > 0 && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-3">
          <p className="mb-2 text-xs font-black text-slate-800">컬럼 관리 · 이름 수정 / 컬럼 삭제</p>
          <div className="flex flex-wrap gap-2">
            {(table.columns || []).map((col) => (
              <div key={col.key} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1">
                <input
                  value={cleanTableColumnLabel(col.label || col.key)}
                  onChange={(event) => updateColumnLabel?.(col.key, event.target.value)}
                  disabled={disabled}
                  className="w-[120px] rounded-lg px-2 py-1 text-[11px] font-black outline-none focus:bg-brand-50 focus:ring-2 focus:ring-brand-400"
                />
                <button type="button" onClick={() => removeColumn?.(col.key)} disabled={disabled} className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-600 hover:bg-rose-100 disabled:opacity-40">컬럼삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {candidateFields.length > 0 && (
        <div className="mt-3 space-y-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs font-bold text-amber-800">
          <p className="font-black">신규 컬럼 후보</p>
          {candidateFields.map((item) => (
            <div key={item.id || item.suggestedFieldKey || item.originalLabel} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 px-3 py-2">
              <span>{item.originalLabel} → {item.suggestedFieldKey} / {item.suggestedDataType}</span>
              <span className="flex flex-wrap gap-1">
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'ADD_STANDARD')} className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">표준필드 추가</button>
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'USE_CUSTOM')} className="rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-black text-brand-700">이번 문서만</button>
                <button type="button" onClick={() => onCandidateAction?.(item.id, 'EXCLUDE')} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">제외</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
