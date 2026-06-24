import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardStatsApi } from '../../api/documentApi.js';
import { useAuth } from '../../context/AuthContext.jsx';

const STATUS_LABEL = { QUEUED: '대기', PROCESSING: '분석중', COMPLETED: '완료', FAILED: '실패' };
const STATUS_STYLE = {
  QUEUED: 'bg-amber-50 text-amber-700',
  PROCESSING: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-red-50 text-red-700',
};

function StatCard({ label, value, desc, tone = 'slate' }) {
  const tones = {
    brand: 'from-brand-50 to-white border-brand-100',
    emerald: 'from-emerald-50 to-white border-emerald-100',
    amber: 'from-amber-50 to-white border-amber-100',
    slate: 'from-slate-50 to-white border-slate-200',
  };
  const valueTones = { brand: 'text-brand-700', emerald: 'text-emerald-700', amber: 'text-amber-700', slate: 'text-slate-950' };
  return (
    <div className={`rounded-[28px] border bg-gradient-to-br p-5 shadow-card ${tones[tone]}`}>
      <p className="text-sm font-black text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-black ${valueTones[tone]}`}>{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStatsApi()
      .then(setStats)
      .catch(() => setStats({ todayJobs: 0, totalExcels: 0, pendingIssues: 0, recentJobs: [] }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft">
        <div className="bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-6 lg:p-8">
          <span className="rounded-full border border-brand-100 bg-white px-3 py-1.5 text-xs font-black text-brand-700">문서 분석 · 표 수정 · 엑셀 다운로드</span>
          <h2 className="mt-5 max-w-3xl text-3xl font-black leading-tight tracking-[-0.04em] text-slate-950 lg:text-4xl">
            안녕하세요, <span className="text-brand-600">{user?.userName || user?.loginId || '사용자'}</span>님
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">업무 문서를 올리고, 필요한 표만 검토해서 엑셀로 만드세요.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link to="/documents/workspace" className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-5 py-3 text-center text-sm font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500">문서 작업 시작</Link>
            <Link to="/documents/history" className="rounded-2xl bg-slate-100 px-5 py-3 text-center text-sm font-black text-slate-700 hover:bg-slate-200">작업 이력 보기</Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="오늘 작업" value={loading ? '—' : `${stats?.todayJobs ?? 0}건`} desc="오늘 생성된 문서 분석 작업" tone="brand" />
        <StatCard label="확인 필요" value={loading ? '—' : `${stats?.pendingIssues ?? 0}건`} desc="미해결 검토 이슈" tone="amber" />
        <StatCard label="생성 엑셀" value={loading ? '—' : `${stats?.totalExcels ?? 0}건`} desc="다운로드 가능한 산출물" tone="emerald" />
      </section>

      {/* Recent jobs */}
      {!loading && (stats?.recentJobs?.length > 0) && (
        <section className="rounded-[28px] border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
            <h3 className="text-base font-black text-slate-950">최근 작업</h3>
            <Link to="/documents/history" className="text-xs font-black text-brand-600 hover:underline">전체 보기 →</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {stats.recentJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">{job.title || `작업 #${job.id}`}</p>
                  <p className="text-xs text-slate-400">{job.created_at ? new Date(job.created_at).toLocaleString('ko-KR') : ''}</p>
                </div>
                <span className={`ml-3 shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${STATUS_STYLE[job.status] || 'bg-slate-50 text-slate-600'}`}>
                  {STATUS_LABEL[job.status] || job.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Flow steps */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h3 className="text-base font-black text-slate-950">처리 흐름</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {['업로드', '문서 파싱', '분석·표 후보', '수정·재검증', '엑셀 다운로드'].map((step, idx) => (
            <div key={step} className="rounded-3xl bg-slate-50 p-4 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-sm font-black text-brand-700">{idx + 1}</div>
              <p className="mt-3 text-xs font-black text-slate-800">{step}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
