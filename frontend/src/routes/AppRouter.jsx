import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute.jsx';
import RoleRoute from './RoleRoute.jsx';
import AuthLayout from '../layouts/AuthLayout.jsx';
import DashboardLayout from '../layouts/DashboardLayout.jsx';
import LoginPage from '../pages/auth/LoginPage.jsx';
import RegisterPage from '../pages/auth/RegisterPage.jsx';
import DashboardPage from '../pages/common/DashboardPage.jsx';
import ForbiddenPage from '../pages/common/ForbiddenPage.jsx';
import DocumentWorkspacePage from '../pages/documents/DocumentWorkspacePage.jsx';
import HistoryPage from '../pages/documents/HistoryPage.jsx';
import TemplatePage from '../pages/admin/TemplatePage.jsx';
import MappingPage from '../pages/admin/MappingPage.jsx';
import UsersPage from '../pages/admin/UsersPage.jsx';

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/documents/workspace" element={<DocumentWorkspacePage />} />
          <Route path="/documents/history" element={<HistoryPage />} />
          <Route element={<RoleRoute allowedRoles={['SYSTEM_ADMIN']} />}>
            <Route path="/templates" element={<TemplatePage />} />
            <Route path="/mappings" element={<MappingPage />} />
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route path="/forbidden" element={<ForbiddenPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
