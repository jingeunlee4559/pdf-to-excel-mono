import { useEffect, useState } from 'react';
import { listUsersApi } from '../../api/userApi.js';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  useEffect(() => { listUsersApi().then((data) => setUsers(data.users || [])).catch(() => setUsers([])); }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="text-2xl font-black text-slate-950">사용자 관리</h2>
        <p className="mt-1 text-sm text-slate-500">계정 목록과 권한을 확인합니다.</p>
      </section>
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-100 text-slate-600"><tr><th className="px-4 py-3 text-left font-black">아이디</th><th className="px-4 py-3 text-left font-black">이름</th><th className="px-4 py-3 text-left font-black">권한</th><th className="px-4 py-3 text-left font-black">부서</th><th className="px-4 py-3 text-left font-black">상태</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id} className="border-t border-slate-100"><td className="px-4 py-3 font-black text-slate-950">{user.loginId}</td><td className="px-4 py-3 font-bold">{user.userName}</td><td className="px-4 py-3 font-bold">{user.roleName}</td><td className="px-4 py-3 font-bold">{user.departmentName}</td><td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{user.status}</span></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
