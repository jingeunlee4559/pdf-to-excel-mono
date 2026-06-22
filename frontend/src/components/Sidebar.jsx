import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, History, Table2, Users, X, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const baseItems = [
  { to: '/dashboard', label: '대시보드', desc: '전체 현황', Icon: LayoutDashboard },
  { to: '/documents/workspace', label: '문서 분석', desc: '분석·표 수정·엑셀', Icon: FileText },
  { to: '/documents/history', label: '작업 이력', desc: '작업 목록', Icon: History }
];

const adminItems = [
  { to: '/templates', label: '템플릿 관리', desc: '엑셀 양식 등록', Icon: Table2 },
  { to: '/mappings', label: '매핑 설정', desc: '셀·필드 연결', Icon: Sparkles },
  { to: '/users', label: '사용자 관리', desc: '계정 권한', Icon: Users }
];

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const items = user?.roleCode === 'SYSTEM_ADMIN' ? [...baseItems, ...adminItems] : baseItems;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-700/30 backdrop-blur-sm transition lg:hidden ${open ? 'block' : 'hidden'}`}
        onClick={onClose}
      />

      <aside
        className={`group/sidebar fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-slate-200/80 bg-white/95 shadow-soft backdrop-blur-xl transition-all duration-300 ease-out
        ${open ? 'translate-x-0' : '-translate-x-full'} w-[286px]
        lg:translate-x-0 lg:w-[86px] lg:hover:w-[286px] lg:shadow-none`}
      >
        <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-slate-100 px-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand-500 via-brand-400 to-emerald-400 text-sm font-black text-white shadow-glow">
            AI
          </div>
          <div className="min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 lg:w-0 lg:opacity-0 lg:group-hover/sidebar:w-[190px] lg:group-hover/sidebar:opacity-100">
            <p className="truncate text-sm font-black tracking-tight text-slate-950">업무문서 자동화</p>
            <p className="truncate text-xs font-bold text-slate-400">Document Excel AI</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-2xl bg-slate-100 p-2 text-slate-500 lg:hidden"
            aria-label="사이드바 닫기"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 scroll-thin">
          <p className="mb-3 px-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 transition-all duration-300 lg:opacity-0 lg:group-hover/sidebar:opacity-100">
            Menu
          </p>
          <div className="space-y-2">
            {items.map(({ to, label, desc, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                title={label}
                className={({ isActive }) =>
                  `flex h-[56px] items-center rounded-[20px] px-3 transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-glow'
                      : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition ${
                        isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon size={19} />
                    </span>
                    <span className="ml-3 min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 lg:w-0 lg:opacity-0 lg:group-hover/sidebar:w-[180px] lg:group-hover/sidebar:opacity-100">
                      <span className="block truncate text-sm font-black">{label}</span>
                      <span className={`mt-0.5 block truncate text-xs font-bold ${isActive ? 'text-white/80' : 'text-slate-400'}`}>{desc}</span>
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="shrink-0 border-t border-slate-100 p-3">
          <div className="flex h-[62px] items-center rounded-[22px] bg-slate-50 px-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-300 text-sm font-black text-white shadow-glow">
              {user?.userName?.[0] || user?.loginId?.[0] || 'U'}
            </div>
            <div className="ml-3 min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 lg:w-0 lg:opacity-0 lg:group-hover/sidebar:w-[180px] lg:group-hover/sidebar:opacity-100">
              <p className="truncate text-sm font-black text-slate-950">{user?.userName || '사용자'}</p>
              <p className="truncate text-xs font-bold text-slate-400">{user?.roleName || user?.roleCode}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
