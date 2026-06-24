import { Badge } from '../ui.jsx';
import { getTemplateDisplayName } from '../utils.js';
import { ExcelTemplateOriginalGrid } from '../ExcelPreview/ExcelTemplateOriginalGrid.jsx';
import { RegisteredTemplateDataGrid } from './RegisteredTemplateDataGrid.jsx';

export function GenericRegisteredTemplatePreview({ table, issues, selectedTemplate, templatePreview, templatePreviewLoading, templatePreviewError, updateCell, removeRow, disabled }) {
  const hasIssues = issues.length > 0;
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">등록 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">선택한 엑셀 원본 구조를 그대로 확인합니다. 비교견적서가 아닌 양식은 고정 비교표로 표시하지 않습니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={hasIssues ? 'amber' : 'green'}>{hasIssues ? '확인 필요 행 포함' : '정상'}</Badge>
          <Badge tone="slate">{getTemplateDisplayName(selectedTemplate) || '등록 양식'}</Badge>
          <Badge tone="blue">일반 등록 양식</Badge>
        </div>
      </div>

      <div className="mt-5">
        {templatePreviewLoading && <div className="flex min-h-[360px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm font-black text-slate-400">원본 엑셀 양식 미리보기를 불러오는 중입니다.</div>}
        {!templatePreviewLoading && templatePreview && <ExcelTemplateOriginalGrid preview={templatePreview} />}
        {!templatePreviewLoading && !templatePreview && (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center">
            <p className="text-sm font-black text-slate-600">원본 엑셀 미리보기를 표시할 수 없습니다.</p>
            <p className="mt-1 text-xs font-bold text-slate-400">{templatePreviewError || '템플릿 파일 경로 또는 ai-server 미리보기 API를 확인하세요.'}</p>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black text-slate-900">추출 데이터 편집</p>
            <p className="mt-1 text-xs font-bold text-slate-500">컬럼 구조는 원본 템플릿 매핑을 따릅니다. 여기서는 값과 행만 수정합니다.</p>
          </div>
          <Badge tone="slate">컬럼 변경 잠금</Badge>
        </div>
        <RegisteredTemplateDataGrid table={table} issues={issues} updateCell={updateCell} removeRow={removeRow} disabled={disabled} />
      </div>
    </div>
  );
}
