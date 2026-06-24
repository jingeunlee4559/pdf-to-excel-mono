import { Badge } from '../ui.jsx';
import { TemplateCell, EditableTemplateCell } from '../ui.jsx';
import {
  inferPreviewVendors,
  buildProductPriceVendorSlots,
  getTemplateDisplayName,
  formatPreviewDate,
  formatMoney,
  getVendorPreviewValue,
  vendorEditKey,
  getProductPriceAverage,
  getSelectedVendorValue,
  pickRowValue,
  removeRowButton,
  cleanTableColumnLabel,
} from '../utils.js';

export function ProductPriceSurveyTemplatePreview({ table, issues, selectedTemplate, templateLayoutMode = 'PRESERVE_TEMPLATE', updateCell, removeRow, disabled }) {
  const vendors = inferPreviewVendors(table);
  const visibleVendors = buildProductPriceVendorSlots(vendors, templateLayoutMode);
  const rows = table.rows || [];
  const rowAreaLength = 15;
  const headerColSpan = 4 + visibleVendors.length + 3;
  const hasIssues = issues.length > 0;
  const hasDataVendorCount = vendors.length;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">등록 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">선택한 업체별 제품가격 조사현황표 양식 구조로 실제 입력 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{getTemplateDisplayName(selectedTemplate) || '업체별 제품가격 조사현황표'}</Badge>
          <Badge tone="blue">업체 {hasDataVendorCount || 0}개 · {templateLayoutMode === 'COMPACT_VENDOR_GROUPS' ? '실제 업체만 표시' : '원본 5칸 유지'}</Badge>
        </div>
      </div>

      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <colgroup>
            <col className="w-[58px]" />
            <col className="w-[180px]" />
            <col className="w-[100px]" />
            <col className="w-[70px]" />
            {visibleVendors.map((vendor, index) => <col key={`product-vendor-col-${index}`} className="w-[92px]" />)}
            <col className="w-[100px]" />
            <col className="w-[110px]" />
            <col className="w-[120px]" />
          </colgroup>
          <tbody>
            <tr><TemplateCell colSpan={headerColSpan} className="py-4 text-xl font-black">업체별 제품가격 조사현황표</TemplateCell></tr>
            <tr><TemplateCell colSpan={headerColSpan} className="h-4 border-slate-300 bg-white"></TemplateCell></tr>
            <tr>
              <TemplateCell rowSpan={2} className="bg-emerald-100">번호</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">제품명</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">규격</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">단위</TemplateCell>
              <TemplateCell colSpan={visibleVendors.length} className="bg-emerald-100">제품 단가 조사현황</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">평균가격</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">업체선정</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-emerald-100">비고</TemplateCell>
            </tr>
            <tr>
              {visibleVendors.map((vendor, index) => (
                <TemplateCell key={`product-vendor-head-${index}`} className={`${vendor.empty ? 'bg-emerald-50 text-slate-400' : 'bg-emerald-100'}`}>
                  {vendor.empty ? `업체 ${index + 1}` : cleanTableColumnLabel(vendor.name)}
                </TemplateCell>
              ))}
            </tr>
            {rows.slice(0, rowAreaLength).map((row, rowIndex) => (
              <tr key={`product-row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || row.no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell align="left" className="break-keep" value={pickRowValue(row, ['product_name', 'item_name', 'work_item_name', '공종명칭', '제품명'])} onChange={(value) => updateCell?.(rowIndex, row.product_name !== undefined ? 'product_name' : 'item_name', value)} disabled={disabled} />
                <EditableTemplateCell value={pickRowValue(row, ['spec', 'standard', 'size', '규격'])} onChange={(value) => updateCell?.(rowIndex, 'spec', value)} disabled={disabled} />
                <EditableTemplateCell value={pickRowValue(row, ['unit', '단위'])} onChange={(value) => updateCell?.(rowIndex, 'unit', value)} disabled={disabled} />
                {visibleVendors.map((vendor, vendorIndex) => (
                  <EditableTemplateCell key={`product-value-${rowIndex}-${vendorIndex}`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'unit_price')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'unit_price', vendorIndex), value)} disabled={disabled || vendor.empty} />
                ))}
                <TemplateCell>{formatMoney(getProductPriceAverage(row, visibleVendors))}</TemplateCell>
                <EditableTemplateCell value={getSelectedVendorValue(row)} onChange={(value) => updateCell?.(rowIndex, 'selected_vendor', value)} disabled={disabled} />
                <EditableTemplateCell align="left" value={pickRowValue(row, ['remark', 'note', 'memo', '비고'])} onChange={(value) => updateCell?.(rowIndex, 'remark', value)} disabled={disabled} />
              </tr>
            ))}
            {Array.from({ length: Math.max(0, rowAreaLength - rows.slice(0, rowAreaLength).length) }).map((_, idx) => (
              <tr key={`product-empty-${idx}`} className={idx % 2 ? 'bg-slate-50' : 'bg-white'}>
                <TemplateCell>{rows.length + idx + 1}</TemplateCell>
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
                {visibleVendors.map((vendor, vendorIndex) => <TemplateCell key={`product-empty-${idx}-${vendorIndex}`}></TemplateCell>)}
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
                <TemplateCell></TemplateCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
