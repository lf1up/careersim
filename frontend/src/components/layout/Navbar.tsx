import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { RetroDialog } from '../ui/RetroDialog.tsx';
import { Button } from '../ui/Button.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';

export const Navbar: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const { user, logout, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!isAuthenticated) {
    return null;
  }

  const desktopNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 text-sm font-semibold border-2 border-black dark:border-retro-ink-dark transition-transform ${
      isActive
        ? 'bg-primary-300 dark:bg-primary-600 text-black dark:text-white translate-x-[1px] translate-y-[1px] shadow-retro-1 dark:shadow-retro-dark-1'
        : 'bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1'
    }`;

  const adminDesktopNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 text-sm font-semibold border-2 border-black dark:border-retro-ink-dark transition-transform ${
      isActive
        ? 'bg-yellow-400 dark:bg-yellow-500 translate-x-[1px] translate-y-[1px] shadow-retro-1 dark:shadow-retro-dark-1'
        : 'bg-yellow-300 dark:bg-yellow-600 shadow-retro-2 dark:shadow-retro-dark-2 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1'
    }`;

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark mx-2 ${
      isActive ? 'bg-primary-300 dark:bg-primary-600 text-black dark:text-white shadow-retro-1 dark:shadow-retro-dark-1' : 'bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2'
    }`;

  const adminMobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark mx-2 ${
      isActive ? 'bg-yellow-400 dark:bg-yellow-500 shadow-retro-1 dark:shadow-retro-dark-1' : 'bg-yellow-300 dark:bg-yellow-600 shadow-retro-2 dark:shadow-retro-dark-2'
    }`;

  return (
    <nav className="bg-retro-paper dark:bg-retro-paper-dark border-b-2 border-black dark:border-retro-ink-dark shadow-retro-y-4 dark:shadow-retro-dark-y-4 relative z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Link to="/dashboard" className="text-xl font-bold tracking-wider2 font-retro text-retro-ink dark:text-retro-ink-dark">
                CAREERSIM.ai
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8 sm:items-center">
              <NavLink to="/dashboard" className={desktopNavLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/simulations" className={desktopNavLinkClass}>
                Simulations
              </NavLink>
              <NavLink to="/sessions" className={desktopNavLinkClass}>
                Sessions
              </NavLink>
              <NavLink to="/analytics" className={desktopNavLinkClass}>
                Analytics
              </NavLink>
              {isAdmin() && (
                <NavLink to="/admin" className={adminDesktopNavLinkClass}>
                  Admin Panel
                </NavLink>
              )}
            </div>
          </div>
          
          <div className="hidden sm:flex sm:items-center">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-monoRetro text-retro-ink dark:text-retro-ink-dark">
                Welcome, {user?.firstName}
              </span>
              <ThemeToggle />
              <div className="relative">
                <button
                  onClick={() => setIsAccountOpen(true)}
                  aria-expanded={isAccountOpen}
                  aria-haspopup="menu"
                  className="bg-white dark:bg-retro-surface-dark rounded-none border-2 border-black dark:border-retro-ink-dark p-1 flex text-sm shadow-retro-2 dark:shadow-retro-dark-2 transition-transform active:translate-x-[1px] active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
                >
                  <img
                    className="h-8 w-8 rounded-full object-cover"
                    src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName}+${user?.lastName}&background=3b82f6&color=fff`}
                    alt={`${user?.firstName} ${user?.lastName}`}
                  />
                </button>
                <RetroDialog
                  open={isAccountOpen}
                  onClose={() => setIsAccountOpen(false)}
                  title="Account"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <img
                      className="h-12 w-12 rounded-full object-cover border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2"
                      src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName}+${user?.lastName}&background=3b82f6&color=fff`}
                      alt={`${user?.firstName} ${user?.lastName}`}
                    />
                    <div>
                      <p className="font-semibold text-retro-ink dark:text-retro-ink-dark">{user?.firstName} {user?.lastName}</p>
                      {user?.email && (
                        <p className="text-sm font-monoRetro text-secondary-700 dark:text-secondary-400">{user.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Link to="/profile" onClick={() => setIsAccountOpen(false)}>
                      <Button variant="outline" size="md" className="w-full justify-center">
                        Your Profile
                      </Button>
                    </Link>
                    <Link to="/subscription" onClick={() => setIsAccountOpen(false)}>
                      <Button variant="outline" size="md" className="w-full justify-center">
                        Subscription
                      </Button>
                    </Link>
                    <Button
                      variant="primary"
                      size="md"
                      className="w-full justify-center"
                      onClick={() => {
                        setIsAccountOpen(false);
                        handleLogout();
                      }}
                    >
                      Sign out
                    </Button>
                  </div>
                </RetroDialog>
              </div>
            </div>
          </div>
          
          {/* Mobile menu button */}
          <div className="sm:hidden flex items-center space-x-2">
            <ThemeToggle />
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-menu"
              className="inline-flex items-center justify-center p-2 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 active:translate-x-[1px] active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
            >
              <svg
                className="h-6 w-6 text-retro-ink dark:text-retro-ink-dark"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div id="mobile-menu" className="sm:hidden relative z-50">
          <div className="pt-2 pb-3 space-y-1 bg-retro-paper dark:bg-retro-paper-dark border-t-2 border-black dark:border-retro-ink-dark">
            <NavLink to="/dashboard" className={mobileNavLinkClass} onClick={() => setIsMobileMenuOpen(false)}>
              Dashboard
            </NavLink>
            <NavLink to="/simulations" className={mobileNavLinkClass} onClick={() => setIsMobileMenuOpen(false)}>
              Simulations
            </NavLink>
            <NavLink to="/sessions" className={mobileNavLinkClass} onClick={() => setIsMobileMenuOpen(false)}>
              Sessions
            </NavLink>
            <NavLink to="/analytics" className={mobileNavLinkClass} onClick={() => setIsMobileMenuOpen(false)}>
              Analytics
            </NavLink>
            {isAdmin() && (
              <NavLink to="/admin" className={adminMobileNavLinkClass} onClick={() => setIsMobileMenuOpen(false)}>
                Admin Panel
              </NavLink>
            )}
            <div className="border-t-2 border-black dark:border-retro-ink-dark mt-2 pt-2">
              <Link
                to="/profile"
                className="block px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 mx-2 text-retro-ink dark:text-retro-ink-dark"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Profile
              </Link>
              <button
                onClick={handleLogout}
                className="block w-full text-left px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 mx-2 text-retro-ink dark:text-retro-ink-dark"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}; 