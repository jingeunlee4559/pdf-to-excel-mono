import { Badge, Metric, InfoCard } from '../ui.jsx';
import { isMultiVendorCompareTableType, tableTypeLabel, isTextVendorComparisonReportType, toDisplayText } from '../utils.js';

// ─── helpers ─────────────────────────────────────────────────────────────────
const toNum = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const cleanVendor = (v) => String(v ?? '').trim().replace(/^[A-Z]회사\s*/g, '').replace(/\s+/g, ' ').trim();
const fmtNum = (n) => n ? n.toLocaleString('ko-KR') : '-';

const SEVERITY_STYLE = { ERROR: 'text-red-700 bg-red-50 border-red-200', WARNING: 'text-amber-700 bg-amber-50 border-amber-200', INFO: 'text-blue-700 bg-blue-50 border-blue-200' };
const SEVERITY_ICON = { ERROR: '🔴', WARNING: '🟡', INFO: '🔵' };

const DOC_TYPE_META = {
  VENDOR_PRICE_COMPARISON: { icon: '📊', color: 'brand', label: '업체별 단가 비교표' },
  SINGLE_ESTIMATE: { icon: '📋', color: 'emerald', label: '단일 업체 견적서' },
  MEETING_MINUTES: { icon: '📝', color: 'teal', label: '회의록' },
  OFFICIAL_LETTER: { icon: '📬', color: 'purple', label: '공문' },
  CONTRACT: { icon: '📑', color: 'slate', label: '계약서' },
  APPROVAL_REQUEST: { icon: '✍️', color: 'amber', label: '품의서' },
  STANDARD_MARKET_PRICE: { icon: '💰', color: 'blue', label: '표준시장단가표' },
  REFERENCE_GUIDELINE: { icon: '📚', color: 'slate', label: '기준서/지침서' },
  INSPECTION_REPORT: { icon: '🔍', color: 'red', label: '점검/검사 보고서' },
  PROGRESS_REPORT: { icon: '📈', color: 'indigo', label: '공정/진도 보고서' },
  PURCHASE_ORDER: { icon: '🛒', color: 'orange', label: '발주서' },
  NARRATIVE_REPORT: { icon: '📄', color: 'brand', label: '검토보고서' },
  GENERAL_BUSINESS: { icon: '📂', color: 'slate', label: '일반 업무 문서' },
};

function getDocTypeCode(analysis, tableType) {
  const code = analysis?.documentTypeCode || analysis?.document_type_code || '';
  if (code) return code;
  if (isMultiVendorCompareTableType(tableType) || isTextVendorComparisonReportType(tableType)) return 'VENDOR_PRICE_COMPARISON';
  if (tableType?.includes('NARRATIVE_REPORT')) return 'NARRATIVE_REPORT';
  if (tableType?.includes('STANDARD_MARKET')) return 'STANDARD_MARKET_PRICE';
  if (tableType?.includes('MEETING')) return 'MEETING_MINUTES';
  if (tableType?.includes('OFFICIAL')) return 'OFFICIAL_LETTER';
  if (tableType?.includes('INSPECTION')) return 'INSPECTION_REPORT';
  if (tableType?.includes('PROGRESS')) return 'PROGRESS_REPORT';
  return 'GENERAL_BUSINESS';
}

function getVendorGroups(table) {
  const cols = Array.isArray(table?.columns) ? table.columns : [];
  const groups = new Map();
  cols.forEach((col) => {
    const label = String(col?.label || '').trim();
    if (!label || /최저|표준|기준|수량|공종|규격|단위|비고/.test(label)) return;
    if (!/(단가|금액)/.test(label)) return;
    const vendor = label.replace(/\s*(단가|금액|업체\s*단가|업체\s*금액)\s*$/g, '').trim();
    const key = vendor.replace(/[\s·㈜주식회사]/g, '').toLowerCase();
    if (!key) return;
    const ex = groups.get(key) || { vendor, unitPriceKey: null, amountKey: null };
    if (/단가/.test(label) && !ex.unitPriceKey) ex.unitPriceKey = col.key;
    if (/금액/.test(label) && !ex.amountKey) ex.amountKey = col.key;
    groups.set(key, ex);
  });
  return Array.from(groups.values());
}

// ─── 문서 유형별 핵심 데이터 카드 빌더 ─────────────────────────────────────

function buildTypeCards(docTypeCode, analysis, table, issues) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const keyValues = Array.isArray(analysis?.keyValues) ? analysis.keyValues : [];
  const getKV = (labels) => keyValues.find((kv) => labels.some((l) => String(kv.label || '').includes(l)))?.value || null;

  switch (docTypeCode) {
    case 'VENDOR_PRICE_COMPARISON': {
      const vendorGroups = getVendorGroups(table);
      const vendors = vendorGroups.map((g) => g.vendor);
      const lowestCounts = {};
      rows.forEach((r) => { const v = cleanVendor(r.lowest_vendor); if (v) lowestCounts[v] = (lowestCounts[v] || 0) + 1; });
      const bestVendor = Object.entries(lowestCounts).sort((a, b) => b[1] - a[1])[0];
      const allPrices = rows.flatMap((r) => vendorGroups.map((g) => toNum(r[g.unitPriceKey]))).filter((p) => p > 0);
      const stdPrices = rows.map((r) => toNum(r.standard_unit_price)).filter((p) => p > 0);
      return [
        { label: '비교 항목 수', value: `${rows.length}건`, tone: 'brand' },
        { label: '비교 업체', value: vendors.length ? vendors.join(', ') : (getKV(['업체', '비교']) || '-'), tone: 'blue' },
        { label: '최저가 다발 업체', value: bestVendor ? `${bestVendor[0]} (${bestVendor[1]}건)` : '-', tone: 'green' },
        { label: '단가 범위', value: allPrices.length ? `${fmtNum(Math.min(...allPrices))}원 ~ ${fmtNum(Math.max(...allPrices))}원` : '-' },
        { label: '표준시장단가 범위', value: stdPrices.length ? `${fmtNum(Math.min(...stdPrices))}원 ~ ${fmtNum(Math.max(...stdPrices))}원` : '-' },
        { label: '확인 필요', value: `${issues.length}건`, tone: issues.length ? 'amber' : 'green' },
      ];
    }
    case 'SINGLE_ESTIMATE': {
      const totalAmt = rows.reduce((s, r) => s + toNum(r.amount || r.total_amount), 0);
      return [
        { label: '품목 수', value: `${rows.length}건` },
        { label: '합계 금액', value: totalAmt ? `${fmtNum(totalAmt)}원` : (getKV(['합계', '금액']) || '-'), tone: 'brand' },
        { label: '작성일', value: getKV(['일자', '날짜', '작성일']) || '-' },
        { label: '발행처', value: getKV(['업체', '공급', '발행']) || '-' },
        { label: 'VAT', value: getKV(['VAT', '부가세', '세금']) || '확인 필요', tone: 'amber' },
        { label: '납기', value: getKV(['납기', '납품', '기한']) || '-' },
      ];
    }
    case 'MEETING_MINUTES': {
      const decisions = rows.filter((r) => r.decision || r.결정사항).length;
      const pending = rows.filter((r) => !r.decision && !r.결정사항).length;
      return [
        { label: '회의 안건 수', value: `${rows.length}건` },
        { label: '결정사항', value: `${decisions}건`, tone: 'green' },
        { label: '미결사항', value: `${pending}건`, tone: pending ? 'amber' : 'green' },
        { label: '회의 일시', value: getKV(['일시', '날짜', '일자']) || '-' },
        { label: '참석자', value: getKV(['참석', '참가']) || '-' },
        { label: '담당자/기한 있는 항목', value: `${rows.filter((r) => r.assignee || r.담당자 || r.due_date).length}건` },
      ];
    }
    case 'OFFICIAL_LETTER': {
      return [
        { label: '문서번호', value: getKV(['문서번호', '번호']) || '-' },
        { label: '수신', value: getKV(['수신']) || '-' },
        { label: '발신', value: getKV(['발신', '발송']) || '-' },
        { label: '처리기한', value: getKV(['기한', '처리', '납기']) || '-' },
        { label: '항목 수', value: `${rows.length}건` },
        { label: '확인 필요', value: `${issues.length}건`, tone: issues.length ? 'amber' : 'green' },
      ];
    }
    case 'INSPECTION_REPORT': {
      const pass = rows.filter((r) => String(r.judgment || r.판정 || '').includes('적합')).length;
      const fail = rows.filter((r) => String(r.judgment || r.판정 || '').includes('부적합')).length;
      return [
        { label: '점검 항목', value: `${rows.length}건` },
        { label: '적합', value: `${pass}건`, tone: 'green' },
        { label: '부적합', value: `${fail}건`, tone: fail ? 'red' : 'green' },
        { label: '점검일', value: getKV(['점검일', '날짜', '일자']) || '-' },
        { label: '점검자', value: getKV(['점검자', '담당자']) || '-' },
        { label: '조치 필요', value: `${rows.filter((r) => r.action || r.조치사항).length}건`, tone: 'amber' },
      ];
    }
    case 'PROGRESS_REPORT': {
      const plans = rows.map((r) => toNum(r.planned_rate || r.계획공정률)).filter((v) => v > 0);
      const actuals = rows.map((r) => toNum(r.actual_rate || r.실적공정률)).filter((v) => v > 0);
      const avgPlan = plans.length ? (plans.reduce((s, v) => s + v, 0) / plans.length).toFixed(1) : null;
      const avgActual = actuals.length ? (actuals.reduce((s, v) => s + v, 0) / actuals.length).toFixed(1) : null;
      return [
        { label: '공종 수', value: `${rows.length}건` },
        { label: '계획 공정률', value: avgPlan ? `${avgPlan}%` : '-' },
        { label: '실적 공정률', value: avgActual ? `${avgActual}%` : '-', tone: avgActual < avgPlan ? 'amber' : 'green' },
        { label: '지연 공종', value: `${rows.filter((r) => r.delay_reason || r.지연사유).length}건`, tone: 'amber' },
        { label: '보고 기준일', value: getKV(['기준일', '보고일', '날짜']) || '-' },
        { label: '확인 필요', value: `${issues.length}건` },
      ];
    }
    case 'NARRATIVE_REPORT': {
      const nr = analysis?.narrativeReport || {};
      const followUp = Array.isArray(nr.follow_up_actions) ? nr.follow_up_actions.length : 0;
      return [
        { label: '보고서 제목', value: nr.report_title || analysis?.documentType || '-' },
        { label: '후속 조치', value: followUp ? `${followUp}건` : '-', tone: followUp ? 'amber' : 'green' },
        { label: '작성일', value: nr.report_date || getKV(['날짜', '일자']) || '-' },
        { label: '문서 분류', value: nr.document_type || '-' },
        { label: '핵심 수치', value: Array.isArray(nr.key_figures) ? nr.key_figures.map((f) => `${f.label}: ${f.value}`).join(' / ') : '-' },
        { label: '확인 필요', value: `${issues.length}건`, tone: issues.length ? 'amber' : 'green' },
      ];
    }
    default: {
      return [
        { label: '문서 유형', value: analysis?.documentType || '-' },
        { label: '추출 항목', value: `${rows.length}건` },
        { label: '확인 필요', value: `${issues.length}건`, tone: issues.length ? 'amber' : 'green' },
        ...(keyValues.slice(0, 3).map((kv) => ({ label: kv.label, value: kv.value || '-' }))),
      ];
    }
  }
}

// ─── 유형별 상세 내용 섹션 ────────────────────────────────────────────────────

function TypeSpecificDetail({ docTypeCode, analysis, table }) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];

  if (docTypeCode === 'VENDOR_PRICE_COMPARISON') {
    const vendorGroups = getVendorGroups(table);
    if (!vendorGroups.length || !rows.length) return null;
    const lowestCounts = {};
    rows.forEach((r) => { const v = cleanVendor(r.lowest_vendor); if (v) lowestCounts[v] = (lowestCounts[v] || 0) + 1; });
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h4 className="text-base font-black text-slate-950">업체별 비교 요약</h4>
        <p className="mt-1 text-xs text-slate-400">원문 기준 업체별 합계·평균·최저 횟수</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendorGroups.map((g) => {
            const totalAmt = rows.reduce((s, r) => s + toNum(r[g.amountKey]), 0);
            const avgPrice = rows.length ? Math.round(rows.reduce((s, r) => s + toNum(r[g.unitPriceKey]), 0) / rows.length) : 0;
            const lowestCnt = lowestCounts[g.vendor] || 0;
            return (
              <div key={g.vendor} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-black text-slate-950">{g.vendor}</p>
                  {lowestCnt > 0 && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">최저 {lowestCnt}건</span>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white px-2.5 py-2"><p className="text-[10px] font-black text-slate-400">합계</p><p className="mt-0.5 text-xs font-black text-slate-800">{totalAmt ? `${fmtNum(totalAmt)}원` : '-'}</p></div>
                  <div className="rounded-xl bg-white px-2.5 py-2"><p className="text-[10px] font-black text-slate-400">평균단가</p><p className="mt-0.5 text-xs font-black text-slate-800">{avgPrice ? `${fmtNum(avgPrice)}원` : '-'}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (docTypeCode === 'MEETING_MINUTES' && rows.length > 0) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h4 className="text-base font-black text-slate-950">안건별 결정사항</h4>
        <div className="mt-4 space-y-2">
          {rows.slice(0, 6).map((r, i) => (
            <div key={i} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded-lg bg-brand-100 px-2 py-1 text-[11px] font-black text-brand-700">{r.agenda_no || i + 1}</span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{r.agenda_title || r.안건명 || '-'}</p>
                  {(r.decision || r.결정사항) && <p className="mt-1 text-xs text-slate-600 leading-5">✓ {r.decision || r.결정사항}</p>}
                  {(r.assignee || r.담당자) && <p className="mt-0.5 text-[11px] text-slate-400">담당: {r.assignee || r.담당자} {r.due_date ? `/ 기한: ${r.due_date}` : ''}</p>}
                </div>
              </div>
            </div>
          ))}
          {rows.length > 6 && <p className="text-xs text-slate-400 text-center">+ {rows.length - 6}개 더 있음</p>}
        </div>
      </div>
    );
  }

  if (docTypeCode === 'NARRATIVE_REPORT') {
    const nr = analysis?.narrativeReport || {};
    const sections = nr.sections || {};
    const followUps = Array.isArray(nr.follow_up_actions) ? nr.follow_up_actions : [];
    const sectionLabels = { overview: '문서 개요', background: '검토 배경', current_status: '주요 현황', key_issues: '핵심 쟁점', overall_opinion: '종합 검토의견' };
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card xl:col-span-2">
        <h4 className="text-base font-black text-slate-950">보고서 섹션 요약</h4>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Object.entries(sectionLabels).map(([key, label]) => {
            const content = toDisplayText(sections[key], '');
            return content ? (
              <div key={key} className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
                <p className="text-xs font-black text-brand-600">{label}</p>
                <p className="mt-1.5 text-sm leading-6 text-slate-700 line-clamp-4">{content}</p>
              </div>
            ) : null;
          }).filter(Boolean)}
        </div>
        {followUps.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-black text-slate-600 mb-2">후속 조치 ({followUps.length}건)</p>
            {followUps.slice(0, 4).map((f, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${f.priority === 'HIGH' ? 'bg-red-100 text-red-600' : f.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>{f.priority || '일반'}</span>
                <div className="min-w-0"><p className="text-xs font-black text-slate-800 truncate">{toDisplayText(f.action, '')}</p><p className="text-[10px] text-slate-400">{toDisplayText(f.department, '')} {toDisplayText(f.due_date, '') ? `/ ${toDisplayText(f.due_date, '')}` : ''}</p></div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (docTypeCode === 'INSPECTION_REPORT' && rows.length > 0) {
    const failItems = rows.filter((r) => String(r.judgment || r.판정 || '').includes('부적합'));
    if (!failItems.length) return null;
    return (
      <div className="rounded-[28px] border border-red-100 bg-red-50 p-5 shadow-card">
        <h4 className="text-base font-black text-red-800">부적합 항목 ({failItems.length}건)</h4>
        <div className="mt-3 space-y-2">
          {failItems.slice(0, 5).map((r, i) => (
            <div key={i} className="rounded-xl bg-white p-3">
              <p className="text-sm font-black text-slate-900">{r.check_item || r.점검항목 || `항목 ${i + 1}`}</p>
              {(r.defect || r.불량내용) && <p className="mt-1 text-xs text-red-600">{r.defect || r.불량내용}</p>}
              {(r.action || r.조치사항) && <p className="mt-0.5 text-xs text-slate-500">→ {r.action || r.조치사항}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// ─── AI 인사이트 ─────────────────────────────────────────────────────────────

function AiInsights({ analysis, docTypeCode, table, issues }) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const summary = analysis?.summary || '';
  const keyValues = Array.isArray(analysis?.keyValues) ? analysis.keyValues : [];

  const insights = [];
  if (docTypeCode === 'VENDOR_PRICE_COMPARISON') {
    const lowestCounts = {};
    rows.forEach((r) => { const v = cleanVendor(r.lowest_vendor); if (v) lowestCounts[v] = (lowestCounts[v] || 0) + 1; });
    const [bestVendor, bestCount] = Object.entries(lowestCounts).sort((a, b) => b[1] - a[1])[0] || [];
    if (bestVendor) insights.push(`${bestVendor}이(가) ${bestCount}건에서 최저단가를 기록했습니다.`);
    const unitMismatch = issues.filter((i) => i.issueType?.includes('UNIT_MISMATCH'));
    if (unitMismatch.length) insights.push(`단위 불일치 ${unitMismatch.length}건 → 최저가 확정 전 환산 기준 확인이 필요합니다.`);
    const amtMismatch = issues.filter((i) => i.issueType?.includes('AMOUNT_MISMATCH'));
    if (amtMismatch.length) insights.push(`수량×단가와 금액이 일치하지 않는 항목이 ${amtMismatch.length}건 있습니다.`);
  }
  if (summary && !insights.length) insights.push(summary);
  keyValues.filter((kv) => kv.label?.includes('특이') || kv.label?.includes('확인')).forEach((kv) => { if (kv.value) insights.push(`${kv.label}: ${kv.value}`); });

  if (!insights.length) return null;
  return (
    <div className="rounded-[28px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🤖</span>
        <h4 className="text-base font-black text-indigo-900">AI 인사이트</h4>
      </div>
      <ul className="space-y-2">
        {insights.slice(0, 4).map((insight, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-indigo-800">
            <span className="shrink-0 mt-0.5 text-indigo-400">•</span>
            <span className="leading-6">{insight}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── 추출 데이터 미리보기 ─────────────────────────────────────────────────────

function ExtractedDataPreview({ table, docTypeCode }) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const cols = Array.isArray(table?.columns) ? table.columns : [];
  if (!rows.length || !cols.length) return null;
  const previewCols = cols.slice(0, 5);
  const previewRows = rows.slice(0, 5);
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card xl:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-base font-black text-slate-950">추출 데이터 미리보기</h4>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-black text-brand-700">총 {rows.length}행 · {cols.length}열</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100">
            <tr>{previewCols.map((col) => <th key={col.key} className="px-3 py-2 text-left font-black text-slate-600 whitespace-nowrap">{col.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {previewRows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                {previewCols.map((col) => {
                  const val = row[col.key];
                  const isNum = col.dataType === 'number' || /price|amount|단가|금액|수량/.test(col.key);
                  return (
                    <td key={col.key} className="px-3 py-2 text-slate-700 max-w-[180px] truncate">
                      {val == null || val === '' ? <span className="text-slate-300">-</span>
                        : val === '원문 미기재' ? <span className="text-amber-500 font-bold">미기재</span>
                        : isNum && toNum(val) ? toNum(val).toLocaleString()
                        : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 5 && <p className="mt-2 text-center text-xs text-slate-400">+ {rows.length - 5}행 더 있음 · 엑셀 미리보기에서 전체 확인</p>}
    </div>
  );
}

// ─── AnalysisView ─────────────────────────────────────────────────────────────

export function AnalysisView({ analysis, issues, table, onMoveTable, onMoveExcel }) {
  const tableType = table?.tableType || table?.table_type || '';
  const docTypeCode = getDocTypeCode(analysis, tableType);
  const docMeta = DOC_TYPE_META[docTypeCode] || DOC_TYPE_META.GENERAL_BUSINESS;
  const typeCards = buildTypeCards(docTypeCode, analysis, table, issues);
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const fileProfiles = Array.isArray(analysis?.fileProfiles) ? analysis.fileProfiles : [];
  const keyValues = Array.isArray(analysis?.keyValues) ? analysis.keyValues : [];
  const confidence = analysis?.confidence || 0;
  const confPct = confidence > 1 ? confidence : Math.round(confidence * 100);

  return (
    <div className="w-full max-w-none space-y-4">

      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-200 bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-6">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl">{docMeta.icon}</span>
                <Badge tone="blue">AI 문서 분석</Badge>
                <Badge tone={issues.length ? 'amber' : 'green'}>확인 필요 {issues.length}건</Badge>
              </div>
              <h4 className="mt-3 text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">
                {analysis?.documentType || docMeta.label}
              </h4>
              {analysis?.purpose && <p className="mt-1 text-sm text-slate-500">{analysis.purpose}</p>}
              {analysis?.summary && <p className="mt-2 max-w-4xl text-sm leading-7 text-slate-600">{analysis.summary}</p>}
            </div>
            <div className="grid w-full grid-cols-3 gap-2 2xl:w-[400px]">
              <Metric label="분석 신뢰도" value={`${confPct}%`} tone="blue" />
              <Metric label="추출 항목" value={`${rows.length}건`} />
              <Metric label="확인 필요" value={`${issues.length}건`} tone={issues.length ? 'amber' : 'green'} />
            </div>
          </div>
        </div>

        {/* ── 유형별 핵심 데이터 카드 ── */}
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 xl:grid-cols-6">
          {typeCards.map((card, i) => (
            <div key={i} className={`rounded-2xl p-3 ${card.tone === 'green' ? 'bg-emerald-50' : card.tone === 'amber' ? 'bg-amber-50' : card.tone === 'red' ? 'bg-red-50' : card.tone === 'brand' ? 'bg-brand-50' : card.tone === 'blue' ? 'bg-blue-50' : 'bg-slate-50'}`}>
              <p className="text-[10px] font-black text-slate-400">{card.label}</p>
              <p className={`mt-1 text-sm font-black leading-snug break-words ${card.tone === 'green' ? 'text-emerald-800' : card.tone === 'amber' ? 'text-amber-800' : card.tone === 'red' ? 'text-red-800' : card.tone === 'brand' ? 'text-brand-800' : card.tone === 'blue' ? 'text-blue-800' : 'text-slate-900'}`}>{String(card.value || '-')}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

        {/* ── 첨부 파일 분석 결과 ── */}
        {fileProfiles.length > 0 && (
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card xl:col-span-2">
            <h4 className="text-base font-black text-slate-950">첨부 파일별 분석 결과</h4>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {fileProfiles.map((f, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-black text-slate-950">{f.fileName}</p>
                    <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-black text-brand-700">분석 대상</span>
                  </div>
                  <p className="mt-1 text-xs font-black text-brand-600">{f.documentType || f.detectedType || ''}</p>
                  {f.summary && <p className="mt-1.5 text-xs leading-5 text-slate-600">{f.summary}</p>}
                  {Array.isArray(f.keyFindings) && f.keyFindings.length > 0 && (
                    <ul className="mt-2 space-y-0.5">{f.keyFindings.slice(0, 3).map((finding, fi) => <li key={fi} className="text-[11px] text-slate-500">• {finding}</li>)}</ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {f.pageCount && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{f.pageCount}페이지</span>}
                    {f.extractedRowCount != null && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">표 후보 {f.extractedRowCount}행</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── AI 인사이트 ── */}
        <AiInsights analysis={analysis} docTypeCode={docTypeCode} table={table} issues={issues} />

        {/* ── 문서 유형별 상세 ── */}
        <TypeSpecificDetail docTypeCode={docTypeCode} analysis={analysis} table={table} />

        {/* ── keyValues 상세 표시 ── */}
        {keyValues.length > 0 && (
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
            <h4 className="text-base font-black text-slate-950">원문 주요 정보</h4>
            <div className="mt-3 space-y-2">
              {keyValues.slice(0, 8).map((kv, i) => (
                <div key={i} className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                  <span className="shrink-0 text-xs font-black text-slate-400">{kv.label}</span>
                  <span className="text-right text-xs font-bold text-slate-800 break-words max-w-[60%]">{kv.value || '-'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 추출 데이터 미리보기 ── */}
        <ExtractedDataPreview table={table} docTypeCode={docTypeCode} />

        {/* ── 엑셀화 방향 + 추천 액션 ── */}
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
          <h4 className="text-base font-black text-slate-950">엑셀화 방향</h4>
          <div className="mt-3 space-y-2">
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
              <p className="text-xs font-black text-brand-700">만들 결과</p>
              <p className="mt-1 text-sm font-black text-slate-950">{docMeta.label} 형식 엑셀</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">엑셀 미리보기에서 수정 후 다운로드하세요.</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={onMoveExcel} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500">엑셀 미리보기</button>
              <button onClick={onMoveTable} className="rounded-2xl bg-brand-50 px-4 py-2 text-xs font-black text-brand-700 hover:bg-brand-100">데이터 편집</button>
            </div>
          </div>
        </div>

      </div>

      {/* ── 확인 필요 항목 ── */}
      {issues.length > 0 && (
        <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 shadow-card">
          <h4 className="mb-3 text-base font-black text-amber-900">확인 필요 항목 ({issues.length}건)</h4>
          <div className="space-y-2">
            {issues.slice(0, 10).map((issue, i) => (
              <div key={i} className={`flex items-start gap-2 rounded-2xl border px-4 py-2.5 ${SEVERITY_STYLE[issue.severity] || SEVERITY_STYLE.WARNING}`}>
                <span className="shrink-0 text-sm">{SEVERITY_ICON[issue.severity] || '🟡'}</span>
                <p className="text-xs font-bold leading-5">{issue.message}</p>
              </div>
            ))}
            {issues.length > 10 && <p className="text-center text-xs text-amber-600">+ {issues.length - 10}건 더 있음</p>}
          </div>
        </div>
      )}
    </div>
  );
}
