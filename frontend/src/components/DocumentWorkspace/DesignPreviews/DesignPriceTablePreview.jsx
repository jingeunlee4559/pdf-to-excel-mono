import { Badge } from '../ui.jsx';
import { TemplateCell, EditableTemplateCell } from '../ui.jsx';
import { formatPreviewDate, removeRowButton, getRowItemName } from '../utils.js';

export function DesignPriceTablePreview({ table, issues, design, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">단가표 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">단가표 전용 구조입니다. 견적서처럼 수신/합계 중심이 아니라 공종·규격·단가 관리 중심입니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 단가표</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-390px)] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-full min-w-[980px] border-collapse text-center text-[12px] font-bold text-slate-900">
          <tbody>
            <tr><TemplateCell colSpan={9} className="py-4 text-2xl font-black">{design?.title || '표준 단가표'}</TemplateCell></tr>
            <tr><TemplateCell colSpan={2} className="bg-slate-200">기준일</TemplateCell><TemplateCell>{formatPreviewDate()}</TemplateCell><TemplateCell colSpan={2} className="bg-slate-200">적용범위</TemplateCell><TemplateCell colSpan={4}>공사/자재/장비 단가 관리</TemplateCell></tr>
            <tr>{['NO', '공종코드', '공종명/품명', '규격', '단위', '수량', '기준단가', '금액', '비고'].map((h) => <TemplateCell key={h} className="bg-slate-200">{h}</TemplateCell>)}</tr>
            {rows.map((row, rowIndex) => (
              <tr key={`price-table-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell value={row.construction_code || row.work_code || ''} onChange={(v) => updateCell?.(rowIndex, 'construction_code', v)} disabled={disabled} />
                <EditableTemplateCell align="left" value={getRowItemName(row)} onChange={(v) => updateCell?.(rowIndex, 'item_name', v)} disabled={disabled} />
                <EditableTemplateCell value={row.spec || ''} onChange={(v) => updateCell?.(rowIndex, 'spec', v)} disabled={disabled} />
                <EditableTemplateCell value={row.unit || ''} onChange={(v) => updateCell?.(rowIndex, 'unit', v)} disabled={disabled} />
                <EditableTemplateCell value={row.quantity || ''} onChange={(v) => updateCell?.(rowIndex, 'quantity', v)} disabled={disabled} />
                <EditableTemplateCell money value={row.standard_unit_price || row.unit_price || row.vendor_unit_price || ''} onChange={(v) => updateCell?.(rowIndex, 'standard_unit_price', v)} disabled={disabled} />
                <EditableTemplateCell money value={row.amount || ''} onChange={(v) => updateCell?.(rowIndex, 'amount', v)} disabled={disabled} />
                <EditableTemplateCell align="left" value={row.remark || ''} onChange={(v) => updateCell?.(rowIndex, 'remark', v)} disabled={disabled} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
