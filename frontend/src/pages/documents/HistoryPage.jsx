import { useEffect, useState } from 'react';
import { excelDownloadUrl, listDocumentJobsApi, listDownloadsApi } from '../../api/documentApi.js';

const STATUS_STYLE = {
  QUEUED: 'bg-amber-50 text-amber-700',
  PROCESSING: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-red-50 text-red-700',
};
const STATUS_LABEL = { QUEUED: '대기', PROCESSING: '분석중', COMPLETED: '완료', FAILED: '실패' };
const MODE_LABEL = { FREE_FORM: '자유형식', COMPANY_TEMPLATE: '자사양식' };

function fmtDate(v) {
  if (!v) return '-';
  try { return new Date(v).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return String(v); }
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('downloads');
  const [searchJobs, setSearchJobs] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  const load = async () => {
    setLoading(true);
    try {
      const [jobData, downloadData] = await Promise.all([listDocumentJobsApi(), listDownloadsApi()]);
      setJobs(jobData.jobs || []);
      setDownloads(downloadData.downloads || []);
    } catch {
      setMessage('이력을 불러오지 못했습니다. 새로고침을 시도하세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredJobs = jobs.filter((j) => {
    const matchSearch = !searchJobs || (j.title || '').toLowerCase().includes(searchJobs.toLowerCase());
    const matchStatus = filterStatus === 'ALL' || j.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-slate-950">작업 이력</h2>
            <p className="mt-1 text-sm text-slate-500">문서 분석 및 엑셀 생성 이력을 확인합니다.</p>
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {loading ? '불러오는 중...' : '새로고침'}
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setActiveTab('downloads')} className={`rounded-2xl px-4 py-2 text-xs font-black ${activeTab === 'downloads' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>다운로드 목록 ({downloads.length})</button>
          <button onClick={() => setActiveTab('jobs')} className={`rounded-2xl px-4 py-2 text-xs font-black ${activeTab === 'jobs' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>분석 작업 ({jobs.length})</button>
        </div>
      </section>

      {message && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{message}</p>}

      {/* 다운로드 목록 */}
      {activeTab === 'downloads' && (
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-black text-slate-950">엑셀 다운로드 목록</h3>
            <p className="mt-1 text-xs text-slate-400">자동 생성 및 채팅에서 생성한 엑셀이 모두 표시됩니다.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">파일명</th>
                  <th className="px-4 py-3 text-left">작업명</th>
                  <th className="px-4 py-3 text-left">상태</th>
                  <th className="px-4 py-3 text-left">생성일</th>
                  <th className="px-4 py-3 text-right">다운로드</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {downloads.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-900 truncate max-w-[240px]">{item.fileName || `excel_${item.id}.xlsx`}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{item.jobTitle || item.sessionTitle || `작업 #${item.jobId}`}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${item.downloadedYn === 'Y' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                        {item.downloadedYn === 'Y' ? '다운로드됨' : '새 파일'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(item.createdAt || item.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <a href={excelDownloadUrl(item.jobId, item.id)} target="_blank" rel="noreferrer"
                        className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-3 py-1.5 text-xs font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500">
                        받기
                      </a>
                    </td>
                  </tr>
                ))}
                {!loading && downloads.length === 0 && (
                  <tr><td colSpan="5" className="px-4 py-14 text-center font-bold text-slate-400">다운로드 이력이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 분석 작업 목록 */}
      {activeTab === 'jobs' && (
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-black text-slate-950">문서 분석 작업</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <input type="text" placeholder="작업명 검색..." value={searchJobs} onChange={(e) => setSearchJobs(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-brand-400 focus:outline-none" />
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700">
                <option value="ALL">전체 상태</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">작업명</th>
                  <th className="px-4 py-3 text-left">산출 방식</th>
                  <th className="px-4 py-3 text-left">상태</th>
                  <th className="px-4 py-3 text-left">생성일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs font-bold text-slate-400">#{job.id}</td>
                    <td className="px-4 py-3 font-black text-slate-900 max-w-[280px] truncate">{job.title || `작업 #${job.id}`}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{MODE_LABEL[job.outputMode] || job.outputMode || 'FREE_FORM'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${STATUS_STYLE[job.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABEL[job.status] || job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(job.createdAt || job.created_at)}</td>
                  </tr>
                ))}
                {!loading && filteredJobs.length === 0 && (
                  <tr><td colSpan="5" className="px-4 py-14 text-center font-bold text-slate-400">
                    {searchJobs || filterStatus !== 'ALL' ? '검색 결과가 없습니다.' : '작업 이력이 없습니다.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
