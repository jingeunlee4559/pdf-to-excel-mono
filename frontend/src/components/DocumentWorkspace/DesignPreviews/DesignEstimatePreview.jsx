import { Badge } from '../ui.jsx';
import { TemplateCell, EditableTemplateCell } from '../ui.jsx';
import {
  inferPreviewVendors,
  formatPreviewDate,
  formatMoney,
  toPreviewNumber,
  getVendorPreviewValue,
  vendorEditKey,
  removeRowButton,
  getRowItemName,
} from '../utils.js';

export function DesignEstimatePreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  const vendors = inferPreviewVendors(table).filter((vendor) => vendor?.name);
  const primaryVendor = vendors[0] || { name: '견적업체', unitPriceKey: 'unit_price', amountKey: 'amount' };
  const total = rows.reduce((sum, row) => sum + toPreviewNumber(getVendorPreviewValue(row, primaryVendor, 'amount') || row.amount), 0);
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">견적서 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">견적서 전용 구조입니다. 공급자/수신처/견적 내역/합계가 표와 다르게 배치됩니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 견적서</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-390px)] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-full min-w-[1000px] border-collapse text-center text-[12px] font-bold text-slate-900">
          <tbody>
            <tr><TemplateCell colSpan={8} className="py-5 text-3xl font-black tracking-[0.2em]">{design?.title || '견 적 서'}</TemplateCell></tr>
            <tr>
              <TemplateCell className="w-[120px] bg-slate-200">견적일자</TemplateCell><TemplateCell>{formatPreviewDate()}</TemplateCell>
              <TemplateCell className="bg-slate-200">수신</TemplateCell><EditableTemplateCell colSpan={2} align="left" value={rows[0]?.recipient || ''} onChange={(v) => updateCell?.(0, 'recipient', v)} disabled={disabled} placeholder="수신처" />
              <TemplateCell className="bg-slate-200">작성자</TemplateCell><TemplateCell colSpan={2}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              <TemplateCell className="bg-slate-200">공급자</TemplateCell><EditableTemplateCell colSpan={3} align="left" value={primaryVendor.name || ''} onChange={(v) => updateCell?.(0, 'vendor_name', v)} disabled={disabled} />
              <TemplateCell className="bg-slate-200">견적명</TemplateCell><EditableTemplateCell colSpan={3} align="left" value={rows[0]?.document_title || table.tableName || ''} onChange={(v) => updateCell?.(0, 'document_title', v)} disabled={disabled} />
            </tr>
            <tr>{['NO', '품명', '규격', '수량', '단위', '단가', '금액', '비고'].map((h) => <TemplateCell key={h} className="bg-slate-200">{h}</TemplateCell>)}</tr>
            {rows.map((row, rowIndex) => (
              <tr key={`estimate-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell align="left" value={getRowItemName(row)} onChange={(v) => updateCell?.(rowIndex, 'item_name', v)} disabled={disabled} />
                <EditableTemplateCell value={row.spec || ''} onChange={(v) => updateCell?.(rowIndex, 'spec', v)} disabled={disabled} />
                <EditableTemplateCell value={row.quantity || ''} onChange={(v) => updateCell?.(rowIndex, 'quantity', v)} disabled={disabled} />
                <EditableTemplateCell value={row.unit || ''} onChange={(v) => updateCell?.(rowIndex, 'unit', v)} disabled={disabled} />
                <EditableTemplateCell money value={getVendorPreviewValue(row, primaryVendor, 'unit_price') || row.unit_price || ''} onChange={(v) => updateCell?.(rowIndex, vendorEditKey(primaryVendor, 'unit_price', 0), v)} disabled={disabled} />
                <EditableTemplateCell money value={getVendorPreviewValue(row, primaryVendor, 'amount') || row.amount || ''} onChange={(v) => updateCell?.(rowIndex, vendorEditKey(primaryVendor, 'amount', 0), v)} disabled={disabled} />
                <EditableTemplateCell align="left" value={row.remark || ''} onChange={(v) => updateCell?.(rowIndex, 'remark', v)} disabled={disabled} />
              </tr>
            ))}
            <tr><TemplateCell colSpan={6} className="bg-slate-100 text-right font-black">합계</TemplateCell><TemplateCell className="font-black">{formatMoney(total)}</TemplateCell><TemplateCell></TemplateCell></tr>
            <tr><TemplateCell colSpan={2} className="bg-slate-200">특기사항</TemplateCell><EditableTemplateCell colSpan={6} align="left" value={rows[0]?.special_note || ''} onChange={(v) => updateCell?.(0, 'special_note', v)} disabled={disabled} placeholder="견적 조건, 납기, 유효기간 등" /></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
