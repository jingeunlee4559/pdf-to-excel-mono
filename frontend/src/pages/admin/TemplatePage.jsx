import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CheckCircle2, FileSpreadsheet, RefreshCw, Search, UploadCloud, X } from 'lucide-react';
import { createTemplateApi, listTemplatesApi } from '../../api/templateApi.js';

const statusLabel = {
  DRAFT: '초안',
  ACTIVE: '활성',
  INACTIVE: '비활성',
  ARCHIVED: '보관'
};

function getTemplateId(item) {
  return item.id || item.templateId || item.template_id;
}

export default function TemplatePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ templateName: '', description: '', file: null });

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await listTemplatesApi();
      setTemplates(data.templates || []);
    } catch (error) {
      setMessage(error.response?.data?.message || '템플릿 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return (templates || [])
      .filter((item) => !statusFilter || (item.status || 'DRAFT') === statusFilter)
      .filter((item) => {
        if (!q) return true;
        const text = [item.templateName, item.originalFileName, item.description, item.templateCode].filter(Boolean).join(' ').toLowerCase();
        return text.includes(q);
      });
  }, [templates, keyword, statusFilter]);

  const counts = useMemo(() => {
    const result = { DRAFT: 0, ACTIVE: 0, INACTIVE: 0, ARCHIVED: 0 };
    for (const item of templates) result[item.status || 'DRAFT'] = (result[item.status || 'DRAFT'] || 0) + 1;
    return result;
  }, [templates]);

  const onFileChange = (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const isExcel = /\.(xlsx|xlsm)$/i.test(selected.name);
    if (!isExcel) {
      setMessage('엑셀 미리보기를 위해 xlsx 또는 xlsm 파일을 선택하세요.');
      event.target.value = '';
      return;
    }
    setForm((prev) => ({
      ...prev,
      file: selected,
      templateName: prev.templateName || selected.name.replace(/\.[^/.]+$/, '')
    }));
  };

  const resetForm = () => {
    setForm({ templateName: '', description: '', file: null });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!form.templateName.trim()) return setMessage('템플릿명을 입력하세요.');
    if (!form.file) return setMessage('엑셀 템플릿 파일을 선택하세요.');

    try {
      setSaving(true);
      const data = await createTemplateApi({
        templateName: form.templateName.trim(),
        templateType: 'NORMAL_TABLE',
        description: form.description.trim(),
        file: form.file,
        mappingJson: '{}'
      });
      resetForm();
      await loadTemplates();
      const templateId = data.templateId || data.id;
      if (templateId) navigate(`/mappings?templateId=${templateId}`);
    } catch (error) {
      setMessage(error.response?.data?.message || '템플릿 등록 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[30px] bg-slate-950 p-6 text-white shadow-soft md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-black text-slate-200 ring-1 ring-white/10">시스템 관리자</span>
            <h2 className="mt-4 text-2xl font-black tracking-tight md:text-3xl">템플릿 관리</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
              자사 엑셀 양식을 등록하면 파일은 backend가 아닌 ai-server 저장소에 저장됩니다. 등록 후 매핑 페이지에서 실제 엑셀 화면을 보면서 셀 위치를 연결하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-slate-950 shadow-card transition hover:bg-brand-50"
          >
            <UploadCloud size={17} />
            엑셀 파일 선택
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="초안 템플릿" value={counts.DRAFT || 0} Icon={FileSpreadsheet} tone="blue" />
        <SummaryCard label="활성 템플릿" value={counts.ACTIVE || 0} Icon={CheckCircle2} tone="green" />
        <SummaryCard label="비활성 템플릿" value={counts.INACTIVE || 0} Icon={RefreshCw} tone="slate" />
        <SummaryCard label="보관 템플릿" value={counts.ARCHIVED || 0} Icon={Archive} tone="orange" />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-card md:p-6">
          <h3 className="text-lg font-black text-slate-950">새 템플릿 등록</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">엑셀 양식을 등록하면 바로 매핑 설정 페이지로 이동합니다.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">템플릿명</span>
              <input
                value={form.templateName}
                onChange={(e) => setForm((prev) => ({ ...prev, templateName: e.target.value }))}
                placeholder="예: 단가비교표 v1"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">설명</span>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="예: 업체별 단가 비교 자동 생성용 템플릿"
                className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold leading-6 text-slate-800 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </label>

            <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm" onChange={onFileChange} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[108px] w-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50"
            >
              <UploadCloud className="text-slate-400" size={25} />
              {form.file ? (
                <>
                  <span className="mt-2 max-w-full truncate text-sm font-black text-brand-700">{form.file.name}</span>
                  <span className="mt-1 text-xs font-bold text-slate-400">{(form.file.size / 1024).toFixed(1)} KB</span>
                </>
              ) : (
                <>
                  <span className="mt-2 text-sm font-black text-slate-700">엑셀 파일 선택</span>
                  <span className="mt-1 text-xs font-bold text-slate-400">xlsx, xlsm 파일만 등록 가능</span>
                </>
              )}
            </button>

            {form.file && (
              <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
                <X size={14} /> 선택 취소
              </button>
            )}

            {message && <p className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">{message}</p>}

            <button
              type="submit"
              disabled={saving}
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-black text-white shadow-card transition hover:bg-brand-700 disabled:bg-slate-300"
            >
              {saving ? '등록 중...' : '+ 템플릿 등록 후 매핑하기'}
            </button>
          </form>
        </div>

        <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-card md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-950">템플릿 목록</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">등록된 엑셀 양식을 확인하고 매핑을 설정하세요.</p>
            </div>
            <button onClick={loadTemplates} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 hover:bg-slate-50">
              <RefreshCw size={15} /> 새로고침
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_150px]">
            <label className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
              <Search size={17} className="text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="템플릿명, 파일명 검색" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-slate-400" />
            </label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-brand-500">
              <option value="">전체 상태</option>
              <option value="DRAFT">초안</option>
              <option value="ACTIVE">활성</option>
              <option value="INACTIVE">비활성</option>
              <option value="ARCHIVED">보관</option>
            </select>
          </div>

          <div className="mt-5 space-y-3">
            {loading && <EmptyState text="템플릿 목록을 불러오는 중입니다." />}
            {!loading && filteredTemplates.length === 0 && <EmptyState text="등록된 템플릿이 없습니다." />}
            {filteredTemplates.map((item) => {
              const id = getTemplateId(item);
              return (
                <div key={id} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.03)] transition hover:border-brand-100 hover:bg-brand-50/30">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-black text-slate-950">{item.templateName}</p>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">v1</span>
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-black text-brand-700 ring-1 ring-brand-100">{statusLabel[item.status] || item.status || '초안'}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{item.description || '설명 없음'}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black text-slate-500">
                        <span className="rounded-full bg-slate-100 px-3 py-1">파일: {item.originalFileName || '-'}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1">저장: ai-server</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button onClick={() => navigate(`/mappings?templateId=${id}`)} className="rounded-2xl bg-brand-50 px-4 py-2.5 text-xs font-black text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100">매핑 설정</button>
                      <button className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">활성화</button>
                      <button className="rounded-2xl bg-orange-50 px-4 py-2.5 text-xs font-black text-orange-700 ring-1 ring-orange-100">보관</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, Icon, tone }) {
  const tones = {
    blue: 'text-brand-600 bg-brand-50',
    green: 'text-emerald-600 bg-emerald-50',
    slate: 'text-slate-600 bg-slate-100',
    orange: 'text-orange-600 bg-orange-50'
  };
  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black text-slate-400">{label}</p>
          <p className={`mt-6 text-3xl font-black ${tone === 'green' ? 'text-emerald-600' : tone === 'orange' ? 'text-orange-600' : tone === 'slate' ? 'text-slate-600' : 'text-brand-600'}`}>{value}</p>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tones[tone] || tones.blue}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">{text}</div>;
}
