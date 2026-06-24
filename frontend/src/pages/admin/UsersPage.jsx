import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { listUsersApi, listRolesApi, createUserApi, updateUserApi, deleteUserApi } from '../../api/userApi.js';

const STATUS_STYLE = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  INACTIVE: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
};
const STATUS_LABEL = { ACTIVE: '활성', INACTIVE: '비활성' };

function Avatar({ name }) {
  const initials = (name || '?').slice(0, 2);
  const colors = ['bg-brand-100 text-brand-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-indigo-100 text-indigo-700'];
  const color = colors[(name || '').charCodeAt(0) % colors.length];
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-xs font-black ${color}`}>{initials}</div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-black text-slate-600">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100';
const selectCls = `${inputCls} cursor-pointer`;

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'create' | {mode:'edit', user}
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [ud, rd] = await Promise.all([listUsersApi(), listRolesApi()]);
      setUsers(ud.users || []);
      setRoles(rd.roles || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const openCreate = () => {
    setForm({ status: 'ACTIVE', roleId: roles[0]?.id || '' });
    setModal('create');
  };

  const openEdit = (user) => {
    setForm({
      userName: user.userName, email: user.email || '', phone: user.phone || '',
      departmentName: user.departmentName || '', positionName: user.positionName || '',
      roleId: roles.find((r) => r.roleCode === user.roleCode)?.id || '',
      status: user.status,
    });
    setModal({ mode: 'edit', user });
  };

  const closeModal = () => { setModal(null); setForm({}); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal === 'create') {
        await createUserApi({ loginId: form.loginId, password: form.password, userName: form.userName, email: form.email, phone: form.phone, departmentName: form.departmentName, positionName: form.positionName, roleId: Number(form.roleId) });
        await Swal.fire({ icon: 'success', title: '사용자 생성 완료', timer: 1500, showConfirmButton: false });
      } else {
        const payload = { userName: form.userName, email: form.email, phone: form.phone, departmentName: form.departmentName, positionName: form.positionName, roleId: Number(form.roleId), status: form.status };
        if (form.password) payload.password = form.password;
        await updateUserApi(modal.user.id, payload);
        await Swal.fire({ icon: 'success', title: '수정 완료', timer: 1200, showConfirmButton: false });
      }
      closeModal();
      await refresh();
    } catch (err) {
      Swal.fire({ icon: 'error', title: '오류', text: err?.response?.data?.error || '처리 중 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    const { isConfirmed } = await Swal.fire({
      title: `${user.userName} 비활성화`,
      text: '해당 사용자를 비활성화합니다. 로그인이 불가능해집니다.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: '비활성화', cancelButtonText: '취소',
      confirmButtonColor: '#ef4444', reverseButtons: true,
    });
    if (!isConfirmed) return;
    try {
      await deleteUserApi(user.id);
      await Swal.fire({ icon: 'success', title: '비활성화 완료', timer: 1200, showConfirmButton: false });
      await refresh();
    } catch (err) {
      Swal.fire({ icon: 'error', title: '오류', text: err?.response?.data?.error || '처리 중 오류가 발생했습니다.' });
    }
  };

  const handleToggleStatus = async (user) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const label = nextStatus === 'ACTIVE' ? '활성화' : '비활성화';
    const { isConfirmed } = await Swal.fire({
      title: `${user.userName} ${label}`, text: `사용자를 ${label}하시겠습니까?`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: label, cancelButtonText: '취소', reverseButtons: true,
    });
    if (!isConfirmed) return;
    try {
      await updateUserApi(user.id, { status: nextStatus });
      await refresh();
    } catch (err) {
      Swal.fire({ icon: 'error', title: '오류', text: err?.response?.data?.error || '처리 중 오류가 발생했습니다.' });
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.loginId?.toLowerCase().includes(q) || u.userName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.departmentName?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-slate-950">사용자 관리</h2>
            <p className="mt-1 text-sm text-slate-500">계정 목록 확인 및 권한·상태를 관리합니다. 총 {users.length}명</p>
          </div>
          <button type="button" onClick={openCreate}
            className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-2.5 text-sm font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500">
            + 사용자 추가
          </button>
        </div>
        <div className="mt-3">
          <input
            type="text" placeholder="이름, 아이디, 이메일, 부서로 검색…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
      </section>

      {/* Table */}
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
        {loading ? (
          <div className="py-16 text-center text-sm font-black text-slate-400">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm font-black text-slate-400">사용자가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[800px] w-full text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th className="px-5 py-3.5 text-left">사용자</th>
                  <th className="px-4 py-3.5 text-left">권한</th>
                  <th className="px-4 py-3.5 text-left">부서 / 직위</th>
                  <th className="px-4 py-3.5 text-left">연락처</th>
                  <th className="px-4 py-3.5 text-left">상태</th>
                  <th className="px-4 py-3.5 text-left">최근 로그인</th>
                  <th className="px-4 py-3.5 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.userName} />
                        <div>
                          <p className="font-black text-slate-900">{user.userName}</p>
                          <p className="text-xs text-slate-400">{user.loginId}{user.email ? ` · ${user.email}` : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-black text-brand-700">{user.roleName || user.roleCode}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <p className="font-bold">{user.departmentName || '—'}</p>
                      <p className="text-xs text-slate-400">{user.positionName || ''}</p>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs">{user.phone || '—'}</td>
                    <td className="px-4 py-3.5">
                      <button type="button" onClick={() => handleToggleStatus(user)}
                        className={`rounded-full px-2.5 py-1 text-xs font-black transition-opacity hover:opacity-70 ${STATUS_STYLE[user.status] || STATUS_STYLE.INACTIVE}`}>
                        {STATUS_LABEL[user.status] || user.status}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-400">
                      {user.lastLoginAt ? new Date(user.lastLoginAt || user.last_login_at).toLocaleString('ko-KR') : '없음'}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => openEdit(user)}
                          className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-200">수정</button>
                        <button type="button" onClick={() => handleDelete(user)}
                          className="rounded-xl bg-red-50 px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-100">삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / Edit Modal */}
      {modal && (
        <Modal title={modal === 'create' ? '사용자 추가' : '사용자 수정'} onClose={closeModal}>
          <form onSubmit={handleSave} className="space-y-4">
            {modal === 'create' && (
              <>
                <Field label="아이디 *">
                  <input required className={inputCls} placeholder="login_id" value={form.loginId || ''} onChange={(e) => setForm((p) => ({ ...p, loginId: e.target.value }))} />
                </Field>
                <Field label="비밀번호 *">
                  <input required type="password" className={inputCls} placeholder="••••••••" value={form.password || ''} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
                </Field>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="이름 *">
                <input required className={inputCls} placeholder="홍길동" value={form.userName || ''} onChange={(e) => setForm((p) => ({ ...p, userName: e.target.value }))} />
              </Field>
              <Field label="권한 *">
                <select required className={selectCls} value={form.roleId || ''} onChange={(e) => setForm((p) => ({ ...p, roleId: e.target.value }))}>
                  <option value="">선택</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.roleName}</option>)}
                </select>
              </Field>
            </div>
            <Field label="이메일">
              <input type="email" className={inputCls} placeholder="user@example.com" value={form.email || ''} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="부서">
                <input className={inputCls} placeholder="공사팀" value={form.departmentName || ''} onChange={(e) => setForm((p) => ({ ...p, departmentName: e.target.value }))} />
              </Field>
              <Field label="직위">
                <input className={inputCls} placeholder="사원" value={form.positionName || ''} onChange={(e) => setForm((p) => ({ ...p, positionName: e.target.value }))} />
              </Field>
            </div>
            <Field label="전화번호">
              <input className={inputCls} placeholder="010-0000-0000" value={form.phone || ''} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            {modal !== 'create' && (
              <>
                <Field label="상태">
                  <select className={selectCls} value={form.status || 'ACTIVE'} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="ACTIVE">활성</option>
                    <option value="INACTIVE">비활성</option>
                  </select>
                </Field>
                <Field label="새 비밀번호 (변경 시만 입력)">
                  <input type="password" className={inputCls} placeholder="변경하지 않으면 비워두세요" value={form.password || ''} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
                </Field>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={closeModal} className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-200">취소</button>
              <button type="submit" disabled={saving} className="rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-5 py-2.5 text-sm font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:opacity-50">
                {saving ? '처리중…' : (modal === 'create' ? '추가' : '저장')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
