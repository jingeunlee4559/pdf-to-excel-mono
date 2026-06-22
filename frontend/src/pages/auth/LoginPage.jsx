import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loginApi } from '../../api/authApi.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginUser } = useAuth();
  const [form, setForm] = useState({ loginId: 'admin', password: '1234' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.loginId || !form.password) {
      setError('아이디와 비밀번호를 입력하세요.');
      return;
    }
    try {
      setLoading(true);
      const result = await loginApi(form);
      loginUser(result.user, result.accessToken);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 lg:grid lg:grid-cols-2">
      <section className="hidden min-h-screen overflow-hidden bg-brand-50 lg:block">
        <div className="flex h-full flex-col justify-between bg-gradient-to-br from-brand-500 via-brand-400 to-emerald-400 p-12 text-white">
          <div>
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/15 text-xl font-black shadow-glow">AI</div>
            <h1 className="mt-10 max-w-xl text-5xl font-black leading-tight tracking-[-0.04em]">문서 분석부터 엑셀 산출까지 한 화면에서 처리합니다.</h1>
            <p className="mt-5 max-w-lg text-base leading-8 text-white/75">텍스트 PDF는 PyMuPDF/pdfplumber로 빠르게 파싱하고, 스캔 문서는 PP-Structure/OCR로 보조 추출하는 버전입니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm font-bold text-white/85">
            <div className="rounded-3xl bg-white/10 p-4">로그인</div>
            <div className="rounded-3xl bg-white/10 p-4">문서작업</div>
            <div className="rounded-3xl bg-white/10 p-4">엑셀생성</div>
          </div>
        </div>
      </section>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[430px]">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500 to-brand-300 text-xl font-black text-white shadow-glow lg:hidden">AI</div>
            <h2 className="mt-6 text-4xl font-black tracking-[-0.04em] text-slate-950">로그인</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">테스트 계정: admin / 1234, user / 1234</p>
          </div>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">아이디</span>
              <input value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50" placeholder="admin" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-700">비밀번호</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-[52px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50" placeholder="1234" />
            </label>
            {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}
            <button disabled={loading} className="h-[52px] w-full rounded-2xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-3 text-sm font-black text-white shadow-glow transition hover:from-brand-600 hover:to-brand-500 disabled:from-slate-300 disabled:to-slate-300">{loading ? '로그인 중...' : '로그인'}</button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-500">
            계정이 없나요? <Link className="font-black text-brand-700" to="/register">회원가입</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
