import { Badge } from '../ui.jsx';
import { TemplateCell, EditableTemplateCell } from '../ui.jsx';
import {
  isAiGeneratedTemplate,
  isProductPriceSurveyTemplate,
  isComparisonEstimateTemplate,
  inferPreviewVendors,
  buildTemplateVendorSlots,
  formatPreviewDate,
  formatMoney,
  toPreviewNumber,
  getVendorPreviewValue,
  vendorEditKey,
  removeRowButton,
} from '../utils.js';
import { AiGeneratedTemplatePreview } from './AiGeneratedTemplatePreview.jsx';
import { ProductPriceSurveyTemplatePreview } from './ProductPriceSurveyTemplatePreview.jsx';
import { GenericRegisteredTemplatePreview } from './GenericRegisteredTemplatePreview.jsx';

export function CompanyTemplatePreview({ table, issues, selectedTemplate, writerName, templateLayoutMode = 'PRESERVE_TEMPLATE', templatePreview = null, generatedExcelPreview = null, templatePreviewLoading = false, templatePreviewError = '', updateCell, removeRow, disabled }) {
  if (isAiGeneratedTemplate(selectedTemplate)) {
    return <AiGeneratedTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (isProductPriceSurveyTemplate(selectedTemplate)) {
    return <ProductPriceSurveyTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} templateLayoutMode={templateLayoutMode} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (!isComparisonEstimateTemplate(selectedTemplate)) {
    return <GenericRegisteredTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} templatePreview={templatePreview} templatePreviewLoading={templatePreviewLoading} templatePreviewError={templatePreviewError} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }

  const vendors = inferPreviewVendors(table, { generatedExcelPreview });
  const visibleVendors = buildTemplateVendorSlots(vendors, templateLayoutMode);
  const rows = table.rows || [];
  const headerColSpan = 2 + visibleVendors.length * 4;
  const hasIssues = issues.length > 0;
  const rowAreaLength = 16;
  const headerLeftSpan = Math.max(2, headerColSpan - 8);
  const hasDataVendorCount = vendors.length;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">등록 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">원본 비교견적서 양식 구조를 기준으로 실제 입력 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{selectedTemplate?.templateName || '등록 양식'}</Badge>
          <Badge tone="blue">업체 {hasDataVendorCount || 0}개 · {templateLayoutMode === 'COMPACT_VENDOR_GROUPS' ? '빈칸 숨김' : '원본 양식 유지'}</Badge>
        </div>
      </div>

      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <colgroup>
            <col className="w-[54px]" />
            <col className="w-[180px]" />
            {visibleVendors.flatMap((vendor) => [
              <col key={`${vendor.name}-spec-col`} className="w-[70px]" />,
              <col key={`${vendor.name}-qty-col`} className="w-[64px]" />,
              <col key={`${vendor.name}-price-col`} className="w-[84px]" />,
              <col key={`${vendor.name}-amount-col`} className="w-[92px]" />
            ])}
          </colgroup>
          <tbody>
            <tr><TemplateCell colSpan={headerColSpan} className="py-4 text-xl font-black">비교 견적서</TemplateCell></tr>
            <tr><TemplateCell colSpan={headerColSpan} className="h-4 border-slate-300 bg-white"></TemplateCell></tr>
            <tr>
              <TemplateCell colSpan={headerLeftSpan} align="left" className="font-semibold">아래와 같이 비교 견적서를 제출합니다.</TemplateCell>
              <TemplateCell colSpan={2} className="bg-slate-200">견적일자</TemplateCell>
              <TemplateCell colSpan={2}>{formatPreviewDate()}</TemplateCell>
              <TemplateCell colSpan={2} className="bg-slate-200">작성자</TemplateCell>
              <TemplateCell colSpan={2}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              <TemplateCell rowSpan={2} className="bg-slate-200">NO</TemplateCell>
              <TemplateCell rowSpan={2} className="bg-slate-200">품목</TemplateCell>
              {visibleVendors.map((vendor, index) => <TemplateCell key={`vendor-head-${index}`} colSpan={4} className={`${vendor.empty ? 'bg-slate-100 text-slate-400' : 'bg-slate-200'}`}>{vendor.empty ? '' : vendor.name}</TemplateCell>)}
            </tr>
            <tr>
              {visibleVendors.flatMap((vendor, index) => ['규격', '수량', '단가', '금액'].map((label) => <TemplateCell key={`vendor-sub-${index}-${label}`} className="bg-slate-200">{label}</TemplateCell>))}
            </tr>
            {rows.slice(0, rowAreaLength).map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : 'bg-white'}>
                <TemplateCell>{row.row_no || rowIndex + 1}{removeRowButton(removeRow, rowIndex, disabled)}</TemplateCell>
                <EditableTemplateCell align="left" className="break-keep" value={row.item_name || row.work_item_name || ''} onChange={(value) => updateCell?.(rowIndex, row.work_item_name !== undefined && row.item_name === undefined ? 'work_item_name' : 'item_name', value)} disabled={disabled} />
                {visibleVendors.flatMap((vendor, vendorIndex) => [
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-spec`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'spec')} onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'spec', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-qty`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'quantity')} onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'quantity', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-price`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'unit_price')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'unit_price', vendorIndex), value)} disabled={disabled || vendor.empty} />,
                  <EditableTemplateCell key={`${rowIndex}-${vendorIndex}-amount`} value={vendor.empty ? '' : getVendorPreviewValue(row, vendor, 'amount')} money onChange={(value) => !vendor.empty && updateCell?.(rowIndex, vendorEditKey(vendor, 'amount', vendorIndex), value)} disabled={disabled || vendor.empty} />
                ])}
              </tr>
            ))}
            {Array.from({ length: Math.max(0, rowAreaLength - rows.slice(0, rowAreaLength).length) }).map((_, idx) => (
              <tr key={`empty-${idx}`}>
                <TemplateCell>&nbsp;</TemplateCell>
                <TemplateCell></TemplateCell>
                {visibleVendors.flatMap((vendor, vendorIndex) => ['spec', 'qty', 'price', 'amount'].map((key) => <TemplateCell key={`empty-${idx}-${vendorIndex}-${key}`}></TemplateCell>))}
              </tr>
            ))}
            <tr>
              <TemplateCell colSpan={2} className="bg-slate-200 font-black">합계</TemplateCell>
              {visibleVendors.flatMap((vendor, vendorIndex) => [
                <TemplateCell key={`total-blank-${vendorIndex}`} colSpan={3}></TemplateCell>,
                <TemplateCell key={`total-value-${vendorIndex}`} className="font-black">{vendor.empty ? '' : formatMoney(rows.reduce((sum, row) => sum + toPreviewNumber(getVendorPreviewValue(row, vendor, 'amount')), 0))}</TemplateCell>
              ])}
            </tr>
            <tr>
              <TemplateCell rowSpan={2} colSpan={2} className="bg-slate-200 font-black">기타사항</TemplateCell>
              <TemplateCell colSpan={headerColSpan - 2} className="h-9 bg-emerald-50"></TemplateCell>
            </tr>
            <tr><TemplateCell colSpan={headerColSpan - 2} className="h-9 bg-emerald-50"></TemplateCell></tr>
            <tr>
              <TemplateCell colSpan={2} className="bg-slate-200 font-black">최종의견</TemplateCell>
              <TemplateCell colSpan={headerColSpan - 2} className="h-12 bg-emerald-50"></TemplateCell>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
