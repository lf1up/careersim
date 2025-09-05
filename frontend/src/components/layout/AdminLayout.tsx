import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChartBarIcon,
  UsersIcon,
  BeakerIcon,
  UserGroupIcon,
  ChartPieIcon,
  ArrowDownTrayIcon,
  Bars3Icon,
  XMarkIcon,
  HomeIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../contexts/AuthContext.tsx';

interface AdminLayoutProps {
  children: React.ReactNode;
}

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: ChartBarIcon },
  { name: 'Users', href: '/admin/users', icon: UsersIcon },
  { name: 'Simulations', href: '/admin/simulations', icon: BeakerIcon },
  { name: 'Personas', href: '/admin/personas', icon: UserGroupIcon },
  { name: 'Analytics', href: '/admin/analytics', icon: ChartPieIcon },
  { name: 'Export Data', href: '/admin/export', icon: ArrowDownTrayIcon },
  { name: 'System', href: '/admin/system', icon: CpuChipIcon },
];

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();

  const isActive = (href: string) => {
    if (href === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-retro-paper flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="fixed inset-0 bg-gray-600 bg-opacity-75"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 bg-retro-paper border-r-2 border-black shadow-[4px_0_0_#111827] transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b-2 border-black">
          <div className="flex items-center">
            <BeakerIcon className="h-8 w-8 text-black" />
            <span className="ml-2 text-xl font-bold font-retro tracking-wider2">ADMIN PANEL</span>
          </div>
          <button
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <XMarkIcon className="h-6 w-6 text-gray-500" />
          </button>
        </div>

        <nav className="mt-5 px-2">
          <div className="space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`${isActive(item.href) ? 'bg-yellow-300 text-black border-2 border-black shadow-[2px_2px_0_#111827]' : 'text-black border-2 border-black shadow-[2px_2px_0_#111827] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_#111827]'} group flex items-center px-3 py-2 text-sm font-semibold transition-transform`}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon className={`flex-shrink-0 -ml-1 mr-3 h-5 w-5`} />
                {item.name}
              </Link>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t-2 border-black">
            <Link
              to="/dashboard"
              className="group flex items-center px-3 py-2 text-sm font-semibold border-2 border-black shadow-[2px_2px_0_#111827] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_#111827] transition-transform"
            >
              <HomeIcon className="flex-shrink-0 -ml-1 mr-3 h-5 w-5" />
              Back to App
            </Link>
          </div>
        </nav>

        {/* User info at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t-2 border-black">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 bg-yellow-300 border-2 border-black flex items-center justify-center">
                  <span className="text-black text-sm font-bold">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </span>
                </div>
              </div>
              <div className="ml-3">
                <p className="text-sm font-semibold">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs">Admin</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="text-sm border-2 border-black px-2 py-1 shadow-[2px_2px_0_#111827] active:translate-x-[1px] active:translate-y-[1px]"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 lg:pl-0 min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden bg-retro-paper border-b-2 border-black shadow-[0_4px_0_#111827]">
          <div className="flex items-center justify-between h-16 px-4">
            <button
              className="border-2 border-black px-2 py-1 shadow-[2px_2px_0_#111827] active:translate-x-[1px] active:translate-y-[1px]"
              onClick={() => setSidebarOpen(true)}
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
            <div className="flex items-center">
              <BeakerIcon className="h-8 w-8 text-black" />
              <span className="ml-2 text-xl font-bold font-retro tracking-wider2">ADMIN</span>
            </div>
            <div className="w-6" /> {/* Spacer */}
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 min-w-0 p-4">
          {children}
        </main>
      </div>
    </div>
  );
}; 