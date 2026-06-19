import { LogOut, Menu, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Header({ onMenuClick }) {
  const { user, logoutUser } = useAuth();

  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-slate-200/70 bg-white/80 backdrop-blur-2xl">
      <div className="flex h-full items-center justify-between px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="hidden text-brand-600 sm:block" size={17} />
              <h1 className="truncate text-base font-black tracking-tight text-slate-950 lg:text-xl">AI 업무문서 자동화 시스템</h1>
            </div>
            <p className="hidden text-xs font-semibold text-slate-500 sm:block">문서 분석 · 표 수정 · 자사 양식 매핑 · 엑셀 다운로드</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 md:flex">
            ai-server 저장 방식
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-white px-2.5 py-2 shadow-card ring-1 ring-slate-200">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">{user?.userName?.[0] || 'U'}</div>
            <div className="hidden sm:block">
              <p className="text-xs font-black text-slate-900">{user?.userName || '사용자'}</p>
              <p className="text-[11px] font-bold text-slate-400">{user?.roleName || user?.roleCode}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logoutUser}
            className="flex h-10 items-center gap-2 rounded-2xl bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-brand-700 sm:px-4"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">로그아웃</span>
          </button>
        </div>
      </div>
    </header>
  );
}
