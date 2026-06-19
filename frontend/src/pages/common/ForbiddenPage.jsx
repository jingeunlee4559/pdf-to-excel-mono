import { Link } from 'react-router-dom';

export default function ForbiddenPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-soft">
        <p className="text-5xl">🔒</p>
        <h1 className="mt-4 text-2xl font-black text-slate-950">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-slate-500">관리자 기능은 시스템 관리자만 사용할 수 있습니다.</p>
        <Link to="/dashboard" className="mt-6 inline-flex rounded-2xl bg-brand-600 px-5 py-3 text-sm font-black text-white">대시보드로 이동</Link>
      </div>
    </div>
  );
}
