import { useState } from 'react';
import { Badge } from './ui.jsx';
import { classifyDesign } from './utils.js';

export function AiTemplateRecommendationBox({ job, recommendations = [], designCandidates = [], candidateFields = [], outputMode = 'FREE_FORM', selectedTemplate, selectedTemplateId, selectedDesignId, registeredTemplates = [], onSelectDesign, onApply, onChangeOutputMode, onCreateAiTemplate, creating, loading }) {
  const isCompanyMode = outputMode === 'COMPANY_TEMPLATE';
  const [showAllAiCandidates, setShowAllAiCandidates] = useState(false);
  const designs = Array.isArray(designCandidates) ? designCandidates : [];
  const registeredTemplateIds = new Set((registeredTemplates || []).map((tpl) => String(tpl.id || tpl.templateId || '')).filter(Boolean));
  const list = (Array.isArray(recommendations) ? recommendations : [])
    .filter((item) => registeredTemplateIds.has(String(item.templateId || item.id || '')))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const activeDesign = !isCompanyMode ? (designs.find((item) => String(item.designId || '') === String(selectedDesignId || '')) || null) : null;
  const activeRecommendation = isCompanyMode ? (list.find((item) => String(item.templateId || item.id || '') === String(selectedTemplateId || '')) || null) : null;
  const recommendedIds = new Set(list.map((item) => String(item.templateId || item.id || '')).filter(Boolean));
  const directTemplates = (registeredTemplates || [])
    .filter((tpl) => !recommendedIds.has(String(tpl.id || tpl.templateId || '')))
    .map((tpl, index) => ({
      templateId: tpl.id || tpl.templateId,
      templateName: tpl.templateName || tpl.template_name,
      templateType: tpl.templateType || tpl.template_type,
      score: 0,
      rank: list.length + index + 1,
      reasons: ['등록된 회사 양식입니다. 적용 전 미리보기에서 입력 위치를 확인하세요.'],
      template: tpl,
      recommendationType: 'REGISTERED_TEMPLATE',
    }));
  const companyChoices = [...list, ...directTemplates]
    .filter((item, index, arr) => arr.findIndex((other) => String(other.templateId || other.id || '') === String(item.templateId || item.id || '')) === index);
  const visibleAiDesigns = showAllAiCandidates ? designs : designs.slice(0, 3);
  const currentTitle = isCompanyMode
    ? (selectedTemplate?.templateName || activeRecommendation?.templateName || '등록한 회사 양식을 선택하세요')
    : (activeDesign?.name || 'Gemini로 새 양식을 생성하세요');
  const currentDescription = isCompanyMode
    ? ((activeRecommendation?.reasons || [])[0] || selectedTemplate?.description || '등록한 엑셀 양식에 분석 데이터를 매핑합니다.')
    : (activeDesign?.reason || 'Gemini가 사용자 요청과 문서 분석 결과를 기준으로 새 회사 문서 양식을 생성합니다.');
  const visibleCandidateFields = (candidateFields || []).slice(0, 6);
  const needNewTemplate = job?.id && !companyChoices.length && designs.length > 0;

  const tabButtonClass = (active) => `rounded-2xl px-4 py-2 text-sm font-black transition ${active ? 'bg-slate-950 text-white shadow-glow' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`;

  return (
    <div className="mt-4 rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">출력 양식 선택</p>
            {job?.id ? <Badge tone="green">현재 문서 분석 기준</Badge> : <Badge tone="slate">파일 분석 후 자동 추천</Badge>}
            {needNewTemplate && <Badge tone="amber">회사 양식 없음</Badge>}
          </div>
          <h4 className="mt-2 text-lg font-black text-slate-950">Gemini가 사용자 요청에 맞는 회사 문서형 엑셀 양식을 새로 만듭니다.</h4>
        </div>
        {!isCompanyMode && (
          <button
            type="button"
            onClick={onCreateAiTemplate}
            disabled={!job?.id || loading || creating}
            className="shrink-0 rounded-2xl bg-gradient-to-r from-slate-900 to-brand-700 px-4 py-2.5 text-xs font-black text-white shadow-glow disabled:bg-slate-200 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400"
            title="Gemini 2.5 Flash가 사용자 요청과 문서 분석 결과를 기준으로 새 엑셀 양식을 설계합니다."
          >
            {creating ? 'Gemini 양식 생성 중' : 'Gemini로 회사 양식 생성'}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onChangeOutputMode?.('FREE_FORM')} className={tabButtonClass(!isCompanyMode)}>AI 생성양식</button>
        <button type="button" onClick={() => onChangeOutputMode?.('COMPANY_TEMPLATE')} className={tabButtonClass(isCompanyMode)}>등록한 회사 양식</button>
      </div>

      <div className="mt-4 rounded-3xl border border-white bg-white/90 p-4 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">현재 선택</p>
            <h5 className="mt-1 truncate text-base font-black text-slate-950">{currentTitle}</h5>
            <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-600">{currentDescription}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
            <Badge tone={isCompanyMode ? 'blue' : 'green'}>{isCompanyMode ? '등록한 회사 양식' : 'AI 생성양식'}</Badge>
            {!isCompanyMode && activeDesign?.layout && <Badge tone="slate">{classifyDesign(activeDesign.layout)}</Badge>}
            {!isCompanyMode && activeDesign?.score ? <Badge tone={Number(activeDesign.score) >= 85 ? 'green' : Number(activeDesign.score) >= 70 ? 'amber' : 'slate'}>{Math.round(Number(activeDesign.score))}점</Badge> : null}
            {isCompanyMode && activeRecommendation?.score ? <Badge tone={Number(activeRecommendation.score) >= 80 ? 'green' : Number(activeRecommendation.score) >= 60 ? 'amber' : 'slate'}>{Math.round(Number(activeRecommendation.score))}점</Badge> : null}
          </div>
        </div>
      </div>

      {!isCompanyMode ? (
        <div className="mt-3 rounded-3xl border border-emerald-100 bg-white/90 p-4 shadow-card">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black text-slate-800">Gemini AI 생성양식</p>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                기존 후보 점수표를 고르지 않고, 사용자 요청과 분석된 문서 내용을 기준으로 Gemini가 새 엑셀 양식 JSON을 설계합니다.
              </p>
            </div>
            <Badge tone={activeDesign ? 'green' : 'slate'}>{activeDesign ? '생성됨' : '생성 전'}</Badge>
          </div>
          {activeDesign ? (
            <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold leading-5 text-emerald-800">
              현재 생성 양식: {activeDesign.name || activeDesign.title || 'AI 생성 양식'} · {classifyDesign(activeDesign.layout || activeDesign.layoutType)}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-500">
              문서 분석이 완료되면 오른쪽 위의 <span className="font-black text-slate-700">Gemini로 회사 양식 생성</span> 버튼을 눌러 새 양식을 만드세요. 상단 후보 목록과 점수 추천은 사용하지 않습니다.
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-3xl border border-brand-100 bg-white/90 p-3 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black text-slate-800">등록한 회사 양식</p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">관리자/사용자가 업로드한 회사 양식만 표시합니다. 기본 후보와 AI 생성 후보는 제외됩니다.</p>
            </div>
            <Badge tone="blue">{companyChoices.length}개</Badge>
          </div>
          {companyChoices.length > 0 ? (
            <div className="space-y-2">
              {companyChoices.map((item) => {
                const active = String(selectedTemplateId || '') === String(item.templateId || item.id || '');
                return (
                  <div key={`${item.templateId || item.id}-${item.rank || item.templateName}`} className={`flex flex-col gap-3 rounded-2xl border p-3 md:flex-row md:items-center md:justify-between ${active ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-slate-900">{item.rank || 1}순위 · {item.templateName}</p>
                        {Number(item.score || 0) > 0 && <Badge tone={Number(item.score || 0) >= 80 ? 'green' : Number(item.score || 0) >= 60 ? 'amber' : 'slate'}>{Math.round(Number(item.score || 0))}점</Badge>}
                        {active && <Badge tone="blue">적용됨</Badge>}
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-500">{(item.reasons || []).slice(0, 2).join(' · ') || item.templateType || '등록한 회사 양식'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onApply(item)}
                      disabled={loading}
                      className={`shrink-0 rounded-2xl px-4 py-2 text-xs font-black ${active ? 'bg-brand-100 text-brand-700' : 'bg-slate-900 text-white hover:bg-brand-700'} disabled:opacity-50`}
                    >
                      {active ? '적용됨' : '이 양식 적용'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-500">
              등록된 회사 양식이 없습니다. Gemini로 새 회사 문서 양식을 생성하세요.
            </div>
          )}
        </div>
      )}

      {candidateFields.length > 0 && (
        <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          신규 컬럼 후보 {candidateFields.length}개{visibleCandidateFields.length ? `: ${visibleCandidateFields.map((item) => `${item.originalLabel}→${item.suggestedFieldKey}`).join(' / ')}` : ''}
          {candidateFields.length > visibleCandidateFields.length ? ` 외 ${candidateFields.length - visibleCandidateFields.length}개` : ''}
        </div>
      )}
    </div>
  );
}
