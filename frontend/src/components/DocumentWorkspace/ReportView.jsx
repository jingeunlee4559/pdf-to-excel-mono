import { toDisplayText, escapeHtmlText } from './utils.js';

const SECTION_LABELS = {
  overview: '문서 개요',
  background: '검토 배경 및 목적',
  current_status: '주요 현황',
  key_issues: '핵심 쟁점',
  cost_schedule_impact: '비용 및 일정 영향',
  department_actions: '부서별 조치 필요사항',
  risks: '리스크 및 확인 필요사항',
  overall_opinion: '종합 검토의견',
};

function buildPrintHtml(report) {
  const sections = report.sections || {};
  const followUpActions = Array.isArray(report.follow_up_actions) ? report.follow_up_actions : [];
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const sectionRows = Object.entries(SECTION_LABELS)
    .map(([key, label]) => [key, label, toDisplayText(sections[key], '')])
    .filter(([, , content]) => content)
    .map(([, label, content]) => `
      <div class="section">
        <div class="section-label">${escapeHtmlText(label)}</div>
        <div class="section-body">${escapeHtmlText(content).replace(/\n/g, '<br>')}</div>
      </div>`)
    .join('');

  const followUpRows = followUpActions.map((item, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtmlText(item.department || '확인 필요')}</td>
      <td>${escapeHtmlText(item.action || '')}</td>
      <td>${escapeHtmlText(item.due_date || '확인 필요')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtmlText(report.report_title || '보고서')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; color: #1e293b; background: #fff; padding: 30px 40px; }
  .header { border-bottom: 3px solid #1e3a5f; padding-bottom: 16px; margin-bottom: 24px; }
  .label-top { font-size: 9pt; font-weight: 900; letter-spacing: 4px; color: #2563eb; text-transform: uppercase; margin-bottom: 8px; }
  .title { font-size: 20pt; font-weight: 900; color: #0f172a; }
  .subtitle { font-size: 9pt; color: #94a3b8; margin-top: 8px; }
  .date-row { font-size: 9pt; color: #64748b; margin-top: 4px; }
  .section { border-bottom: 1px solid #e2e8f0; padding: 16px 0; }
  .section:last-child { border-bottom: none; }
  .section-label { font-size: 10pt; font-weight: 900; color: #0f172a; margin-bottom: 8px; }
  .section-body { font-size: 10pt; line-height: 1.9; color: #334155; white-space: pre-wrap; }
  .followup-title { font-size: 13pt; font-weight: 900; color: #0f172a; margin: 28px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { background: #1e3a5f; color: #fff; padding: 8px 10px; font-weight: 700; text-align: left; }
  td { border: 1px solid #e2e8f0; padding: 7px 10px; color: #334155; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 8.5pt; color: #94a3b8; }
  @media print {
    body { padding: 15mm 20mm; }
    @page { size: A4; margin: 20mm; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="label-top">내부 보고서</div>
  <div class="title">${escapeHtmlText(report.report_title || '보고서')}</div>
  <div class="subtitle">본 보고서는 첨부 원문에 근거하여 AI가 초안을 작성하였습니다. 확인 필요 항목은 담당자 검토 후 확정하시기 바랍니다.</div>
  <div class="date-row">작성일: ${today}</div>
</div>
${sectionRows}
${followUpActions.length > 0 ? `
<div class="followup-title">후속 조치사항</div>
<table>
  <thead><tr><th style="width:36px">No</th><th>담당부서</th><th>조치내용</th><th style="width:110px">목표기한</th></tr></thead>
  <tbody>${followUpRows}</tbody>
</table>` : ''}
<div class="footer">AI 자동 생성 초안 — 최종 확정 전 담당자 검토 필요</div>
</body>
</html>`;
}

function downloadReportAsPdf(report) {
  const html = buildPrintHtml(report);
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('팝업이 차단되었습니다. 브라우저 팝업 차단을 해제해 주세요.'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

export function ReportView({ analysis }) {
  const report = analysis?.narrativeReport || analysis?.narrative_report;

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-16 text-center">
        <p className="text-base font-black text-slate-400">보고서가 생성되지 않았습니다.</p>
        <p className="max-w-sm text-sm font-bold leading-6 text-slate-400">
          분석 요청 시 <span className="text-brand-600">"보고서 형식으로 작성해줘"</span> 또는
          <span className="text-brand-600"> "내부 보고서로 정리해줘"</span>를 포함해 요청해 주세요.
        </p>
      </div>
    );
  }

  const sections = report.sections || {};
  const followUpActions = Array.isArray(report.follow_up_actions) ? report.follow_up_actions : [];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 bg-gradient-to-br from-brand-50 via-white to-slate-50 p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-xs font-black tracking-widest text-brand-600 uppercase">내부 보고서</div>
              <h2 className="text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">
                {toDisplayText(report.report_title, '보고서')}
              </h2>
              <p className="mt-3 text-xs font-bold leading-5 text-slate-400">
                본 보고서는 첨부 원문에 근거하여 AI가 초안을 작성하였습니다.
                확인 필요 항목은 담당자 검토 후 확정하시기 바랍니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadReportAsPdf(report)}
              className="shrink-0 rounded-2xl bg-linear-to-r from-red-500 to-rose-500 px-4 py-2.5 text-xs font-black text-white shadow-glow hover:from-red-600 hover:to-rose-600 whitespace-nowrap"
            >
              PDF 다운로드
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100 px-8 py-2">
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const content = toDisplayText(sections[key], '');
            if (!content) return null;
            return (
              <div key={key} className="py-6">
                <h3 className="mb-3 text-sm font-black text-slate-950">{label}</h3>
                <p className="whitespace-pre-wrap text-sm font-bold leading-7 text-slate-700">{content}</p>
              </div>
            );
          })}
        </div>
      </div>

      {followUpActions.length > 0 && (
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-card">
          <h3 className="mb-1 text-lg font-black text-slate-950">후속 조치사항</h3>
          <p className="mb-4 text-xs font-bold text-slate-400">담당부서·조치내용·목표기한 기준으로 정리합니다.</p>
          <div className="space-y-2">
            {followUpActions.map((item, index) => (
              <div
                key={index}
                className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4"
              >
                <div className="flex-shrink-0 rounded-full bg-brand-100 px-3 py-1 text-xs font-black text-brand-700">
                  {toDisplayText(item.department, '확인 필요')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">{toDisplayText(item.action, '')}</p>
                  {toDisplayText(item.due_date, '') && (
                    <p className="mt-1 text-xs font-bold text-slate-400">목표기한: {toDisplayText(item.due_date, '')}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
