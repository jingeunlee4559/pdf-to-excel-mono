
import { useEffect, useState } from 'react';
import { excelDownloadUrl, listDocumentJobsApi, listDownloadsApi } from '../../api/documentApi.js';

export default function HistoryPage() {
  const [jobs, setJobs] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [message, setMessage] = useState('');

  const load = () => {
    Promise.all([listDocumentJobsApi(), listDownloadsApi()])
      .then(([jobData, downloadData]) => {
        setJobs(jobData.jobs || []);
        setDownloads(downloadData.downloads || []);
      })
      .catch(() => setMessage('작업/다운로드 이력을 불러오지 못했습니다.'));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="text-2xl font-black text-slate-950">작업 이력</h2>
        <p className="mt-1 text-sm text-slate-500">문서 분석, 채팅 기반 엑셀 생성, 다운로드 이력을 확인합니다.</p>
      </section>
      {message && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{message}</p>}

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-black text-slate-950">다운로드 목록</h3>
          <p className="mt-1 text-sm text-slate-500">채팅에서 생성한 엑셀도 이 목록에 함께 표시됩니다.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[880px] w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-black">파일명</th>
                <th className="px-4 py-3 text-left font-black">작업</th>
                <th className="px-4 py-3 text-left font-black">채팅</th>
                <th className="px-4 py-3 text-left font-black">상태</th>
                <th className="px-4 py-3 text-left font-black">생성일</th>
                <th className="px-4 py-3 text-left font-black">다운로드</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-black text-slate-950">{item.fileName}</td>
                  <td className="px-4 py-3 font-bold text-slate-600">{item.jobTitle || `#${item.jobId}`}</td>
                  <td className="px-4 py-3 font-bold text-slate-500">{item.sessionTitle || '-'}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-black text-brand-700">{item.downloadedYn === 'Y' ? '다운로드 완료' : '생성됨'}</span></td>
                  <td className="px-4 py-3 font-bold text-slate-500">{item.createdAt}</td>
                  <td className="px-4 py-3"><a className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-3 py-2 text-xs font-black text-white" href={excelDownloadUrl(item.jobId, item.id)} target="_blank" rel="noreferrer">받기</a></td>
                </tr>
              ))}
              {downloads.length === 0 && <tr><td colSpan="6" className="px-4 py-12 text-center font-bold text-slate-400">다운로드 이력이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-black text-slate-950">문서 작업 목록</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-black">번호</th>
                <th className="px-4 py-3 text-left font-black">제목</th>
                <th className="px-4 py-3 text-left font-black">산출 방식</th>
                <th className="px-4 py-3 text-left font-black">상태</th>
                <th className="px-4 py-3 text-left font-black">등록일</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-bold text-slate-600">#{job.id}</td>
                  <td className="px-4 py-3 font-black text-slate-950">{job.title}</td>
                  <td className="px-4 py-3 font-bold text-slate-600">{job.outputMode}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-black text-brand-700">{job.status}</span></td>
                  <td className="px-4 py-3 font-bold text-slate-500">{job.createdAt}</td>
                </tr>
              ))}
              {jobs.length === 0 && <tr><td colSpan="5" className="px-4 py-12 text-center font-bold text-slate-400">작업 이력이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
