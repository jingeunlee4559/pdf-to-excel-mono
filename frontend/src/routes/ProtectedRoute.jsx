import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute() {
  const { isAuthReady, isLoggedIn } = useAuth();
  if (!isAuthReady) return <div className="min-h-screen grid place-items-center text-slate-500">인증 확인 중...</div>;
  return isLoggedIn ? <Outlet /> : <Navigate to="/login" replace />;
}
