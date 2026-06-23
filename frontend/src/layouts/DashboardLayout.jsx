import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import Header from '../components/Header.jsx';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="min-w-0 transition-all duration-300 lg:pl-[86px]">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="w-full max-w-none min-w-0 p-3 md:p-4 xl:p-5 2xl:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
