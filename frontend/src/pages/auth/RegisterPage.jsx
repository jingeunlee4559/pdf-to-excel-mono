import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerApi } from '../../api/authApi.js';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ loginId: '', password: '', userName: '', email: '', departmentName: '공사팀', positionName: '사용자' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      setLoading(true);
      await registerApi(form);
      setMessage('회원가입이 완료되었습니다. 로그인 화면으로 이동하세요.');
      setTimeout(() => navigate('/login'), 700);
    } catch (err) {
      setMessage(err.response?.data?.message || '회원가입 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-white px-5 py-10">
      <div className="w-full max-w-[560px] rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500 to-brand-300 text-xl font-black text-white shadow-glow">AI</div>
          <h1 className="mt-5 text-3xl font-black tracking-[-0.03em] text-slate-950">회원가입</h1>
          <p className="mt-2 text-sm text-slate-500">일반 사용자 권한으로 생성됩니다.</p>
        </div>

        <form onSubmit={submit} className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="아이디" value={form.loginId} onChange={(v) => update('loginId', v)} />
          <Input label="비밀번호" type="password" value={form.password} onChange={(v) => update('password', v)} />
          <Input label="이름" value={form.userName} onChange={(v) => update('userName', v)} />
          <Input label="이메일" value={form.email} onChange={(v) => update('email', v)} />
          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-700">부서</span>
            <select value={form.departmentName} onChange={(e) => update('departmentName', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-brand-500">
              <option>공사팀</option>
              <option>감리팀</option>
              <option>관리팀</option>
            </select>
          </label>
          <Input label="직책" value={form.positionName} onChange={(v) => update('positionName', v)} />
          {message && <p className="sm:col-span-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm font-bold text-brand-700">{message}</p>}
          <button disabled={loading} className="sm:col-span-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-3 text-sm font-black text-white shadow-glow hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300">{loading ? '처리 중...' : '회원가입'}</button>
        </form>

        <div className="mt-5 text-center text-sm text-slate-500">
          이미 계정이 있나요? <Link className="font-black text-brand-700" to="/login">로그인</Link>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-slate-700">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-brand-500" />
    </label>
  );
}
