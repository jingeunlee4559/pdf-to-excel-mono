import { Link } from 'react-router-dom';

const cards = [
  { label: '오늘 작업', value: '0건', desc: '새 문서 작업을 시작하세요.' },
  { label: '확인 필요', value: '0건', desc: '수정 후 재검증 대상입니다.' },
  { label: '생성 엑셀', value: '0건', desc: '다운로드 가능한 산출물입니다.' }
];

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft">
        <div className="bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-6 lg:p-8">
          <span className="rounded-full border border-brand-100 bg-white px-3 py-1.5 text-xs font-black text-brand-700">문서 분석 · 표 수정 · 엑셀 다운로드</span>
          <h2 className="mt-5 max-w-3xl text-3xl font-black leading-tight tracking-[-0.04em] text-slate-950 lg:text-5xl">업무 문서를 올리고, 필요한 표만 검토해서 엑셀로 만드세요.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 lg:text-base">현재 버전은 OCR과 영수증 전용 로직을 제거하고, 사용자가 준 화면 흐름에 필요한 기능만 남겼습니다.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link to="/documents/workspace" className="rounded-2xl bg-brand-600 px-5 py-3 text-center text-sm font-black text-white shadow-card hover:bg-brand-700">문서 작업 시작</Link>
            <Link to="/documents/history" className="rounded-2xl bg-slate-100 px-5 py-3 text-center text-sm font-black text-slate-700 hover:bg-slate-200">작업 이력 보기</Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
            <p className="text-sm font-black text-slate-400">{card.label}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{card.value}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{card.desc}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h3 className="text-xl font-black text-slate-950">처리 흐름</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
          {['업로드', '문서 파싱', '분석/표 후보', '수정/재검증', '엑셀 다운로드'].map((step, idx) => (
            <div key={step} className="rounded-3xl bg-slate-50 p-4 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-sm font-black text-brand-700">{idx + 1}</div>
              <p className="mt-3 text-sm font-black text-slate-800">{step}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
