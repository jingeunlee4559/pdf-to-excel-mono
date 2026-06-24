import { Badge } from '../ui.jsx';
import { TemplateCell, EditableTemplateCell } from '../ui.jsx';
import {
  inferPreviewVendors,
  buildTemplateVendorSlots,
  formatPreviewDate,
  getVendorPreviewValue,
  vendorEditKey,
  getAiPreviewLowest,
  removeRowButton,
  cleanTableColumnLabel,
  getRowItemName,
} from '../utils.js';

export function DesignVendorComparePreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const vendors = inferPreviewVendors(table);
  const visibleVendors = buildTemplateVendorSlots(vendors, 'COMPACT_VENDOR_GROUPS');
  const rows = table.rows || [];
  const headerColSpan = 5 + visibleVendors.length * 2 + 3;
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">업체 비교형 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">업체별 단가·금액을 가로 반복 컬럼으로 표시하고 바로 수정합니다.</p>
        </div>
        <Badge tone="blue">업체 {vendors.length || 0}개</Badge>
      </div>
      <div className="scroll-thin mt-5 max-h-[calc(100vh-390px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <tbody>
            <tr><TemplateCell colSpan={headerColSpan} className="py-4 text-xl font-black">{design?.title || '업체별 단가 비교표'}</TemplateCell></tr>
            <tr>
              <TemplateCell colSpan={2} className="bg-slate-100">작성일</TemplateCell><TemplateCell>{formatPreviewDate()}</TemplateCell>
              <TemplateCell colSpan={2} className="bg-slate-100">작성자</TemplateCell><TemplateCell colSpan={Math.max(headerColSpan - 5, 1)}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              {['NO', '품명', '규격', '수량', '단위'].map((label) => <TemplateCell key={label} rowSpan={2} className="bg-slate-200">{label}</TemplateCell>)}
              {visibleVendors.map((vendor, index) => <TemplateCell key={`dvh-${index}`} colSpan={2} className="bg-slate-200">{vendor.empty ? '' : cleanTableColumnLabel(vendor.name)}</TemplateCell>)}
              {['최저 업체', '최저 단가', '비고'].map((label) => <TemplateCell key={label} rowSpan={2} className="bg-slate-200">{label}</TemplateCell>)}
            </tr>
            <tr>{visibleVendors.flatMap((vendor, index) => ['단가', '금액'].map((label) => <TemplateCell key={`dvs-${index}-${label}`} className="bg-slate-100">{label}</TemplateCell>))}</tr>
            {rows.map((row, rowIndex) => {
              const lowest = getAiPreviewLowest(row, visibleVendors.filter((v) => !v.empty));
              return (
                <tr key={`design-vendor-row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                  <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                  <EditableTemplateCell align="left" value={getRowItemName(row)} onChange={(value) => updateCell?.(rowIndex, 'item_name', value)} disabled={disabled} />
                  <EditableTemplateCell value={row.spec || ''} onChange={(value) => updateCell?.(rowIndex, 'spec', value)} disabled={disabled} />
                  <EditableTemplateCell value={row.quantity || ''} onChange={(value) => updateCell?.(rowIndex, 'quantity', value)} disabled={disabled} />
                  <EditableTemplateCell value={row.unit || ''} onChange={(value) => updateCell?.(rowIndex, 'unit', value)} disabled={disabled} />
                  {visibleVendors.flatMap((vendor, vendorIndex) => [
                    <EditableTemplateCell key={`dv-${rowIndex}-${vendorIndex}-p`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'unit_price')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'unit_price', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                    <EditableTemplateCell key={`dv-${rowIndex}-${vendorIndex}-a`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'amount')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'amount', vendorIndex), value)} disabled={disabled || vendor.empty} />
                  ])}
                  <EditableTemplateCell value={lowest.vendor} onChange={(value) => updateCell?.(rowIndex, 'lowest_target', value)} disabled={disabled} />
                  <EditableTemplateCell value={lowest.price} money onChange={(value) => updateCell?.(rowIndex, 'calculated_unit_price', value)} disabled={disabled} />
                  <EditableTemplateCell align="left" value={row.remark || ''} onChange={(value) => updateCell?.(rowIndex, 'remark', value)} disabled={disabled} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
