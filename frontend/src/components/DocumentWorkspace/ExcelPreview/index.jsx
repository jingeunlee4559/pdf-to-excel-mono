import { Badge } from '../ui.jsx';
import {
  isMultiVendorCompareTableType,
  isTextVendorComparisonReportType,
  isStandardMarketTableType,
} from '../utils.js';
import { ExcelTemplateOriginalGrid } from './ExcelTemplateOriginalGrid.jsx';
import { EditableGrid } from './EditableGrid.jsx';
import { CompanyTemplatePreview } from '../CompanyTemplates/index.js';
import { DesignCandidatePreview } from '../DesignPreviews/index.js';
import { DesignVendorComparePreview } from '../DesignPreviews/DesignVendorComparePreview.jsx';
import { DesignPriceTablePreview } from '../DesignPreviews/DesignPriceTablePreview.jsx';
import { DesignMeetingPreview } from '../DesignPreviews/DesignMeetingPreview.jsx';
import { DesignOfficialLetterPreview } from '../DesignPreviews/DesignOfficialLetterPreview.jsx';
import { DesignReportPreview } from '../DesignPreviews/DesignReportPreview.jsx';

export function ExcelPreview({ table, issues = [], outputMode, selectedTemplate, selectedDesign, writerName, templateLayoutMode, templatePreview = null, templatePreviewLoading = false, templatePreviewError = '', updateCell, addRow, removeRow, addColumn, removeColumn, updateColumnLabel, saveTable, disabled, candidateFields = [], onCandidateAction, generatedExcelPreview = null, analysis = {}, onPreviewCellEdit, onRemovePreviewRow, onRemovePreviewColumn, onMergePreview, onSplitPreview, onRefreshPreview, onColumnWidthChange, onRowHeightChange, selectedPreviewColumn = '', onSelectedPreviewColumnChange }) {
  const isRegisteredTemplate = outputMode === 'COMPANY_TEMPLATE' && selectedTemplate;
  const activeDesign = !isRegisteredTemplate ? selectedDesign : null;
  const tableType = String(table?.tableType || table?.table_type || '');
  const hasRows = (table?.rows || []).length > 0;
  const docType = String(analysis?.documentType || analysis?.document_type || '').toLowerCase();

  const hasValidExcelPreview = Array.isArray(generatedExcelPreview?.rows) && generatedExcelPreview.rows.length > 0
    && Array.isArray(generatedExcelPreview?.columns) && generatedExcelPreview.columns.length > 0;

  const renderFallbackPreview = () => {
    if (!hasRows) return null;

    if (isMultiVendorCompareTableType(tableType) || isTextVendorComparisonReportType(tableType)) {
      return (
        <DesignVendorComparePreview
          table={table} issues={issues}
          design={{ layout: 'AI_GENERATED_DYNAMIC_VENDOR_TABLE', name: '업체별 단가 비교표' }}
          writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled}
        />
      );
    }

    if (isStandardMarketTableType(tableType)) {
      return <DesignPriceTablePreview table={table} issues={issues} design={{ layout: 'PRICE_TABLE' }} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
    }

    const isReportType = /(보고|보고서|리포트|report|일보|점검|감리|현황|검토)/i.test(docType) || tableType.includes('REPORT');
    const isMeetingType = /(회의|meeting|안건|minutes)/i.test(docType) || tableType.includes('MEETING');
    const isOfficialType = /(공문|official|letter|시행)/i.test(docType) || tableType.includes('OFFICIAL');

    if (isMeetingType) {
      return <DesignMeetingPreview table={table} issues={issues} design={{ layout: 'MEETING_MINUTES', name: '회의록' }} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
    }
    if (isOfficialType) {
      return <DesignOfficialLetterPreview table={table} issues={issues} design={{ layout: 'OFFICIAL_LETTER', name: '공문' }} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />;
    }
    if (isReportType) {
      return <DesignReportPreview table={table} issues={issues} design={{ layout: 'CUSTOM_DOCUMENT_FORM', name: '보고서' }} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />;
    }

    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xl font-black text-slate-950">추출 결과 미리보기</h4>
          <div className="flex items-center gap-2">
            <Badge tone="blue">{(table.rows || []).length}행</Badge>
            <span className="text-xs text-slate-400">채팅에서 "보고서 형식으로" 등 입력하면 양식 변경</span>
          </div>
        </div>
        <EditableGrid table={table} issues={issues} updateCell={updateCell} addRow={() => {}} removeRow={removeRow} addColumn={() => {}} removeColumn={removeColumn} updateColumnLabel={updateColumnLabel} saveTable={saveTable} disabled={disabled} compact={false} showToolbar={false} />
      </div>
    );
  };

  const toolbarButtons = (showRefresh) => (
    <div className="flex flex-wrap items-center gap-2">
      {hasRows && <Badge tone="blue">{(table.rows || []).length}행</Badge>}
      <button type="button" onClick={addRow} disabled={disabled} className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 disabled:opacity-50">+ 행 추가</button>
      <button type="button" onClick={addColumn} disabled={disabled} className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 disabled:opacity-50">+ 컬럼 추가</button>
      {showRefresh && onRefreshPreview && <button type="button" onClick={onRefreshPreview} disabled={disabled} className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-200 disabled:opacity-50">미리보기 새로고침</button>}
      <button type="button" onClick={saveTable} disabled={disabled} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-3 py-2 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300">수정 저장</button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Excel template grid view */}
      {hasValidExcelPreview && (
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-slate-100">
            <div>
              <h4 className="text-lg font-black text-slate-950">엑셀 미리보기</h4>
              <p className="text-xs text-slate-400">셀 클릭하여 편집 · 행/컬럼 추가 후 "수정 저장" 클릭</p>
            </div>
            {toolbarButtons(true)}
          </div>
          <div className="px-3 pt-3 pb-4">
            <ExcelTemplateOriginalGrid
              preview={generatedExcelPreview}
              onCellEdit={onPreviewCellEdit}
              onRemoveRow={onRemovePreviewRow}
              onRemoveColumn={onRemovePreviewColumn}
              onMergePreview={onMergePreview}
              onSplitPreview={onSplitPreview}
              onColumnWidthChange={onColumnWidthChange}
              onRowHeightChange={onRowHeightChange}
              selectedPreviewColumn={selectedPreviewColumn}
              onSelectedPreviewColumnChange={onSelectedPreviewColumnChange}
            />
          </div>
        </div>
      )}

      {/* Fallback editable views */}
      {!hasValidExcelPreview && (
        <>
          {hasRows && (
            <div className="rounded-[28px] border border-slate-200 bg-white shadow-card px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">행/컬럼 추가·삭제, 내용 수정 후 "수정 저장"을 눌러 반영하세요.</p>
                {toolbarButtons(false)}
              </div>
            </div>
          )}
          {isRegisteredTemplate ? (
            <CompanyTemplatePreview table={table} issues={issues} selectedTemplate={selectedTemplate} writerName={writerName} templateLayoutMode={templateLayoutMode} templatePreview={templatePreview}
          generatedExcelPreview={generatedExcelPreview} templatePreviewLoading={templatePreviewLoading} templatePreviewError={templatePreviewError} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />
          ) : activeDesign ? (
            <DesignCandidatePreview table={table} issues={issues} design={activeDesign} writerName={writerName} updateCell={updateCell} removeRow={removeRow} disabled={disabled} updateColumnLabel={updateColumnLabel} removeColumn={removeColumn} />
          ) : renderFallbackPreview()}
        </>
      )}
    </div>
  );
}
