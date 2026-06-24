import { Badge, ReportSection } from '../ui.jsx';
import { formatPreviewDate, firstNonEmpty, sanitizeBusinessPurpose, inferBusinessPurposeFromRow } from '../utils.js';

export function DesignReportPreview({ table, issues, design, writerName, updateCell, removeRow, disabled, updateColumnLabel, removeColumn }) {
  const rows = table.rows || [];
  const first = rows[0] || {};
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xl font-black text-slate-950">보고서 양식 미리보기</h4>
          <p className="mt-1 text-sm text-slate-500">회사 보고서형입니다. 표 제목만 바꾸는 방식이 아니라 보고 목적·검토내용·결론·조치계획 섹션으로 편집합니다.</p>
        </div>
        <Badge tone="blue">AI 생성 양식 · 보고서</Badge>
      </div>

      <div className="mt-5 rounded-[28px] border border-slate-300 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div>
            <p className="text-xs font-black text-slate-500">보고서 제목</p>
            <input
              value={first.report_title || first.document_title || design?.title || '업무 보고서'}
              onChange={(event) => updateCell?.(0, 'report_title', event.target.value)}
              disabled={disabled}
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-2xl font-black text-slate-950 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-300 text-center text-xs font-black">
            <div className="grid grid-cols-2 border-b border-slate-300"><div className="bg-slate-100 py-2">작성일</div><div className="py-2">{formatPreviewDate()}</div></div>
            <div className="grid grid-cols-2 border-b border-slate-300"><div className="bg-slate-100 py-2">작성자</div><div className="py-2">{writerName || '-'}</div></div>
            <div className="grid grid-cols-2"><div className="bg-slate-100 py-2">검토건수</div><div className="py-2">{rows.length}건</div></div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <ReportSection number="1" title="보고 목적" value={firstNonEmpty(sanitizeBusinessPurpose(first.report_purpose), sanitizeBusinessPurpose(first.purpose), inferBusinessPurposeFromRow(first))} onChange={(v) => updateCell?.(0, 'report_purpose', v)} disabled={disabled} placeholder="보고 목적을 입력하세요." />
          <ReportSection number="2" title="주요 검토 내용" value={first.summary || first.content || ''} onChange={(v) => updateCell?.(0, 'summary', v)} disabled={disabled} placeholder="문서 분석 내용 또는 검토 내용을 입력하세요." />
          <ReportSection number="3" title="검토 결과" value={first.issue_summary || first.review_result || first.review_opinion || ''} onChange={(v) => updateCell?.(0, 'issue_summary', v)} disabled={disabled} placeholder="검토 결과를 입력하세요." />
          <ReportSection number="4" title="조치 계획" value={first.action_plan || ''} onChange={(v) => updateCell?.(0, 'action_plan', v)} disabled={disabled} placeholder="후속 조치 계획을 입력하세요." />
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-black text-slate-900">보고서 하단 메모</p>
          <textarea
            value={first.footer_note || ''}
            onChange={(event) => updateCell?.(0, 'footer_note', event.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="추가 참고사항이나 결재 요청 문구를 입력하세요. 불필요하면 비워두면 됩니다."
            className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-white"
          />
        </div>
      </div>
    </div>
  );
}
