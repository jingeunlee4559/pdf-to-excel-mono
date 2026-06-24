import { Badge } from '../ui.jsx';
import { TemplateCell, EditableTemplateCell } from '../ui.jsx';
import {
  inferPreviewVendors,
  uniqueAiPreviewFields,
  cleanTableColumnLabel,
  getTemplateDisplayName,
  formatPreviewDate,
  getVendorPreviewValue,
  getAiPreviewCellValue,
  vendorEditKey,
} from '../utils.js';

export function AiGeneratedTemplatePreview({ table, issues, selectedTemplate, writerName, updateCell, removeRow, disabled }) {
  const design = selectedTemplate?.mapping || selectedTemplate?.mappingJson || {};
  const rows = table.rows || [];
  const vendors = inferPreviewVendors(table);
  const visibleVendors = vendors.filter((vendor) => vendor?.name);
  const hasRepeatGroup = Array.isArray(design.repeatGroups) && design.repeatGroups.length > 0;
  const baseExclude = hasRepeatGroup ? ['unit_price', 'vendor_unit_price', 'amount', 'vendor_amount', 'total_amount'] : [];
  let baseColumns = uniqueAiPreviewFields(design.baseColumns, baseExclude);
  if (!baseColumns.length) {
    baseColumns = uniqueAiPreviewFields((table.columns || []).map((col) => ({ fieldKey: col.key, label: col.label || col.key })), baseExclude);
  }
  if (!baseColumns.some((item) => item.fieldKey === 'row_no')) baseColumns = [{ fieldKey: 'row_no', label: 'NO' }, ...baseColumns];

  const repeatColumns = hasRepeatGroup
    ? uniqueAiPreviewFields(design.repeatGroups?.[0]?.columns || [{ fieldKey: 'unit_price', label: '단가' }, { fieldKey: 'amount', label: '금액' }])
    : [];
  const summaryColumns = uniqueAiPreviewFields(design.summaryColumns || []);
  const outputColumns = [
    ...baseColumns.map((item) => ({ ...item, kind: 'base' })),
    ...visibleVendors.flatMap((vendor) => repeatColumns.map((item) => ({ ...item, kind: 'vendor', vendor, label: `${cleanTableColumnLabel(vendor.name)} ${item.label || item.fieldKey}` }))),
    ...summaryColumns.map((item) => ({ ...item, kind: 'summary' })),
  ];
  const hasIssues = issues.length > 0;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">AI 생성 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">DB 표준필드 기반 생성 양식에 실제 데이터가 들어갈 위치를 미리 확인합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{getTemplateDisplayName(selectedTemplate) || 'AI 생성 양식'}</Badge>
          <Badge tone="blue">업체 {visibleVendors.length || 0}개</Badge>
        </div>
      </div>

      <div className="scroll-thin mt-5 max-h-[calc(100vh-420px)] min-h-[420px] overflow-auto rounded-3xl border border-slate-200 bg-white p-3">
        <table className="w-max min-w-full border-collapse table-fixed text-center text-[11px] font-bold text-slate-900">
          <colgroup>
            {outputColumns.map((col, index) => <col key={`ai-col-${index}`} className={col.fieldKey === 'item_name' ? 'w-[180px]' : 'w-[110px]'} />)}
          </colgroup>
          <tbody>
            <tr><TemplateCell colSpan={Math.max(outputColumns.length, 1)} className="py-4 text-xl font-black">{design.title || getTemplateDisplayName(selectedTemplate) || 'AI 추천양식'}</TemplateCell></tr>
            <tr><TemplateCell colSpan={Math.max(outputColumns.length, 1)} className="h-4 border-slate-300 bg-white"></TemplateCell></tr>
            <tr>
              <TemplateCell className="bg-slate-200">견적일자</TemplateCell>
              <TemplateCell>{formatPreviewDate()}</TemplateCell>
              <TemplateCell className="bg-slate-200">작성자</TemplateCell>
              <TemplateCell colSpan={Math.max(outputColumns.length - 3, 1)}>{writerName || '-'}</TemplateCell>
            </tr>
            <tr>
              {outputColumns.map((col, index) => <TemplateCell key={`ai-head-${index}`} className="bg-slate-200">{cleanTableColumnLabel(col.label || col.fieldKey)}</TemplateCell>)}
            </tr>
            {rows.map((row, rowIndex) => (
              <tr key={`ai-row-${rowIndex}`} className={issues.some((issue) => Number(issue.rowIndex) === rowIndex) ? 'bg-amber-50' : rowIndex % 2 ? 'bg-slate-50' : 'bg-white'}>
                {outputColumns.map((col, colIndex) => {
                  const value = col.kind === 'vendor'
                    ? getVendorPreviewValue(row, col.vendor, col.fieldKey)
                    : getAiPreviewCellValue(row, col.fieldKey, rowIndex, visibleVendors);
                  const moneyLike = /(price|amount|cost|total|단가|금액)/i.test(String(col.fieldKey || col.label || ''));
                  const editKey = col.kind === 'vendor' ? vendorEditKey(col.vendor, col.fieldKey, colIndex) : col.fieldKey;
                  return (
                    <EditableTemplateCell
                      key={`ai-cell-${rowIndex}-${colIndex}`}
                      value={value}
                      money={moneyLike}
                      align={col.fieldKey === 'item_name' || col.fieldKey === 'remark' ? 'left' : 'center'}
                      disabled={disabled}
                      onChange={(nextValue) => updateCell?.(rowIndex, editKey, nextValue)}
                    />
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr><TemplateCell colSpan={Math.max(outputColumns.length, 1)} className="h-24 text-slate-400">행 추가 후 바로 입력할 수 있습니다.</TemplateCell></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
