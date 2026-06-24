import { Badge, ReportSection } from '../ui.jsx';
import { formatPreviewDate } from '../utils.js';

export function DesignReviewOpinionPreview({ table, issues, design, writerName, updateCell, removeRow, disabled }) {
  const rows = table.rows || [];
  const first = rows[0] || {};
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">검토 의견서 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">보고서와 다른 검토 의견서 전용 구조입니다. 확인사항, 이슈, 검토의견, 보완요청을 분리합니다.</p>
        </div>
        <Badge tone={issues.length ? 'amber' : 'blue'}>{issues.length ? '확인 필요 포함' : '검토 의견서'}</Badge>
      </div>

      <div className="mt-5 rounded-[28px] border border-slate-300 bg-white p-6 shadow-sm">
        <input
          value={first.report_title || first.document_title || design?.title || '검토 의견서'}
          onChange={(event) => updateCell?.(0, 'report_title', event.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border-0 border-b-2 border-slate-300 px-3 py-3 text-center text-3xl font-black tracking-[0.18em] outline-none focus:border-brand-400"
        />
        <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-2xl border border-slate-300 text-sm font-bold md:grid-cols-4">
          <div className="bg-slate-100 px-3 py-2 text-center font-black">작성일</div>
          <div className="border-b border-slate-300 px-3 py-2 md:border-b-0 md:border-r">{formatPreviewDate()}</div>
          <div className="bg-slate-100 px-3 py-2 text-center font-black">작성자</div>
          <div className="px-3 py-2">{writerName || '-'}</div>
          <div className="bg-slate-100 px-3 py-2 text-center font-black">문서구분</div>
          <input value={first.document_type || first.documentType || '내부 검토'} onChange={(e) => updateCell?.(0, 'document_type', e.target.value)} disabled={disabled} className="border-b border-slate-300 px-3 py-2 outline-none focus:bg-brand-50 md:border-b-0 md:border-r" />
          <div className="bg-slate-100 px-3 py-2 text-center font-black">검토상태</div>
          <input value={first.status || '확인 필요'} onChange={(e) => updateCell?.(0, 'status', e.target.value)} disabled={disabled} className="px-3 py-2 outline-none focus:bg-brand-50" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <ReportSection number="1" title="검토 대상" value={first.document_title || first.report_title || ''} onChange={(v) => updateCell?.(0, 'document_title', v)} disabled={disabled} placeholder="원문 문서명 또는 검토 대상을 입력하세요." />
          <ReportSection number="2" title="주요 확인사항" value={first.summary || first.content || ''} onChange={(v) => updateCell?.(0, 'summary', v)} disabled={disabled} placeholder="원문에서 확인된 주요 내용을 입력하세요." />
          <ReportSection number="3" title="주요 이슈" value={first.issue_summary || first.review_result || ''} onChange={(v) => updateCell?.(0, 'issue_summary', v)} disabled={disabled} placeholder="보완 또는 확인이 필요한 이슈를 입력하세요." />
          <ReportSection number="4" title="검토 의견" value={first.review_opinion || first.review_result || first.issue_summary || ''} onChange={(v) => updateCell?.(0, 'review_opinion', v)} disabled={disabled} placeholder="검토 의견을 입력하세요." />
          <ReportSection number="5" title="보완/조치 요청" value={first.action_plan || ''} onChange={(v) => updateCell?.(0, 'action_plan', v)} disabled={disabled} placeholder="원문에 명시된 보완 또는 조치사항을 입력하세요." />
        </div>
      </div>
    </div>
  );
}
