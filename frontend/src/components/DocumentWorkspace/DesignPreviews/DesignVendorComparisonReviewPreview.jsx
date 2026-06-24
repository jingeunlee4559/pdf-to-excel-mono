import { Badge, ReportSection } from '../ui.jsx';
import { formatPreviewDate, firstNonEmpty, sanitizeBusinessPurpose, inferBusinessPurposeFromRow } from '../utils.js';

export function DesignVendorComparisonReviewPreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  const first = rows[0] || {};
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">업체별 단가 비교 검토보고서 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">업체 비교표가 아니라 비교 검토보고서 전용 문서형 구조입니다. 비교 기준, 요약, 검토의견, 확인사항을 나눕니다.</p>
        </div>
        <Badge tone={issues.length ? 'amber' : 'blue'}>{issues.length ? '확인 필요 포함' : '비교 검토보고서'}</Badge>
      </div>

      <div className="mt-5 rounded-[28px] border border-slate-300 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div>
            <p className="text-xs font-black text-slate-500">검토보고서 제목</p>
            <input
              value={first.report_title || first.document_title || design?.title || '업체별 단가 비교 검토보고서'}
              onChange={(event) => updateCell?.(0, 'report_title', event.target.value)}
              disabled={disabled}
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-2xl font-black text-slate-950 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-300 text-center text-xs font-black">
            <div className="grid grid-cols-2 border-b border-slate-300"><div className="bg-slate-100 py-2">작성일</div><div className="py-2">{formatPreviewDate()}</div></div>
            <div className="grid grid-cols-2 border-b border-slate-300"><div className="bg-slate-100 py-2">작성자</div><div className="py-2">{writerName || '-'}</div></div>
            <div className="grid grid-cols-2"><div className="bg-slate-100 py-2">확인행</div><div className="py-2">{rows.length}건</div></div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <ReportSection number="1" title="검토 목적" value={firstNonEmpty(sanitizeBusinessPurpose(first.report_purpose), sanitizeBusinessPurpose(first.purpose), inferBusinessPurposeFromRow(first))} onChange={(v) => updateCell?.(0, 'report_purpose', v)} disabled={disabled} placeholder="원문에 명시된 검토 목적을 입력하세요." />
          <ReportSection number="2" title="비교/검토 기준" value={first.comparison_basis || first.criteria || first.summary || ''} onChange={(v) => updateCell?.(0, 'comparison_basis', v)} disabled={disabled} placeholder="단가, 금액, 업체, 검토 기준을 입력하세요." />
          <ReportSection number="3" title="주요 비교 내용" value={first.summary || first.content || ''} onChange={(v) => updateCell?.(0, 'summary', v)} disabled={disabled} placeholder="원문 기준 비교 내용을 입력하세요." />
          <ReportSection number="4" title="검토 결과/의견" value={first.issue_summary || first.review_result || first.review_opinion || ''} onChange={(v) => updateCell?.(0, 'issue_summary', v)} disabled={disabled} placeholder="비교 검토 결과를 입력하세요." />
          <ReportSection number="5" title="확인 및 조치사항" value={first.action_plan || ''} onChange={(v) => updateCell?.(0, 'action_plan', v)} disabled={disabled} placeholder="원문에 명시된 확인 또는 조치사항을 입력하세요." />
        </div>
      </div>
    </div>
  );
}
