import { Badge } from '../ui.jsx';
import { EditableGrid } from '../ExcelPreview/EditableGrid.jsx';
import { DesignEstimatePreview } from './DesignEstimatePreview.jsx';
import { DesignPriceTablePreview } from './DesignPriceTablePreview.jsx';
import { DesignVendorComparePreview } from './DesignVendorComparePreview.jsx';
import { DesignReportPreview } from './DesignReportPreview.jsx';
import { DesignReviewOpinionPreview } from './DesignReviewOpinionPreview.jsx';
import { DesignVendorComparisonReviewPreview } from './DesignVendorComparisonReviewPreview.jsx';
import { DesignMeetingPreview } from './DesignMeetingPreview.jsx';
import { DesignOfficialLetterPreview } from './DesignOfficialLetterPreview.jsx';

export function DesignCandidatePreview({ table, issues, design, writerName, updateCell, removeRow, disabled, updateColumnLabel, removeColumn }) {
  const layout = String(design?.layout || '').toUpperCase();
  const layoutType = String(design?.layoutType || design?.layout_type || '').toUpperCase();
  const designId = String(design?.designId || '').toUpperCase();
  if (layoutType === 'VENDOR_COMPARISON_REVIEW_FORM' || layout.includes('VENDOR_COMPARISON_REVIEW') || designId.includes('VENDOR_COMPARE_REVIEW')) {
    return <DesignVendorComparisonReviewPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layoutType === 'REVIEW_OPINION_FORM' || layout.includes('REVIEW_OPINION') || designId.includes('REVIEW_OPINION')) {
    return <DesignReviewOpinionPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('DYNAMIC_VENDOR') || layoutType === 'VENDOR_COMPARISON_TABLE' || (layout.includes('VENDOR_COMPARE') && !layout.includes('REVIEW')) || (designId.includes('VENDOR_COMPARE') && !designId.includes('REVIEW'))) {
    return <DesignVendorComparePreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('ESTIMATE') || designId.includes('ESTIMATE')) {
    return <DesignEstimatePreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('PRICE')) {
    return <DesignPriceTablePreview table={table} issues={issues} design={design} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('MEETING')) {
    return <DesignMeetingPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('OFFICIAL')) {
    return <DesignOfficialLetterPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
  }
  if (layout.includes('REPORT') || layout.includes('CUSTOM_DOCUMENT_FORM') || layout.includes('DOCUMENT_FORM') || layoutType.includes('REPORT') || layout.includes('SECTION') || layout.includes('SUMMARY') || layout.includes('APPROVAL') || layout.includes('HEADER_TABLE')) {
    return <DesignReportPreview table={table} issues={issues} design={design} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />;
  }
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">{design?.name || '기본 표 양식'} 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">선택한 디자인을 단순 엑셀 표 형태로 바로 편집합니다.</p>
        </div>
        <Badge tone={issues.length ? 'amber' : 'green'}>{issues.length ? '확인 필요 행 포함' : '정상'}</Badge>
      </div>
      <EditableGrid table={table} issues={issues} updateCell={updateCell} addRow={() => {}} removeRow={removeRow} addColumn={() => {}} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={() => {}} disabled={disabled} compact={false} showToolbar={false} />
    </div>
  );
}
