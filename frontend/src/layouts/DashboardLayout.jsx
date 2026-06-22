import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import Header from '../components/Header.jsx';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="min-w-0 transition-all duration-300 lg:pl-[86px]">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="mx-auto max-w-[1760px] p-4 md:p-5 xl:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
