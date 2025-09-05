import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { SocketProvider } from './contexts/SocketContext.tsx';
import { Navbar } from './components/layout/Navbar.tsx';
import { AdminRoute } from './components/auth/AdminRoute.tsx';
import { AdminLayout } from './components/layout/AdminLayout.tsx';
import { LoginForm } from './components/auth/LoginForm.tsx';
import { RegisterForm } from './components/auth/RegisterForm.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Simulations } from './pages/Simulations.tsx';
import { SimulationDetail } from './pages/SimulationDetail.tsx';
import { Sessions } from './pages/Sessions.tsx';
import { SessionDetail } from './pages/SessionDetail.tsx';
import { Analytics } from './pages/Analytics.tsx';
import { Profile } from './pages/Profile.tsx';
import { AdminDashboard } from './pages/admin/AdminDashboard.tsx';
import { AdminUsers } from './pages/admin/AdminUsers.tsx';
import { AdminSimulations } from './pages/admin/AdminSimulations.tsx';
import { AdminPersonas } from './pages/admin/AdminPersonas.tsx';
import { AdminAnalytics } from './pages/admin/AdminAnalytics.tsx';
import { AdminExport } from './pages/admin/AdminExport.tsx';
import { AdminSystem } from './pages/admin/AdminSystem.tsx';
import { LoadingSpinner } from './components/ui/LoadingSpinner.tsx';
import './index.css';

// Protected Route component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Public Route component (redirects if authenticated)
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// App Layout component
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-retro-paper">
      <Navbar />
      <main className="p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
};

// Main App component
const AppContent: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginForm />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <RegisterForm />
            </PublicRoute>
          }
        />

        {/* Protected routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/simulations"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Simulations />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/simulations/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <SimulationDetail />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/simulations/:id/session/:sessionId"
          element={
            <ProtectedRoute>
              <AppLayout>
                <SimulationDetail />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/sessions"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Sessions />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/sessions/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <SessionDetail />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Analytics />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Profile />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminDashboard />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminUsers />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/simulations"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminSimulations />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/personas"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminPersonas />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminAnalytics />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/export"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminExport />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/system"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminSystem />
              </AdminLayout>
            </AdminRoute>
          }
        />

        {/* Redirect root to dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        
        {/* 404 route */}
        <Route 
          path="*" 
          element={
            <div className="min-h-screen flex items-center justify-center">
              <div className="text-center">
                <h1 className="text-4xl font-bold text-secondary-900 mb-4">404</h1>
                <p className="text-secondary-600 mb-8">Page not found</p>
                <a href="/dashboard" className="text-primary-600 hover:text-primary-500">
                  Go back to dashboard
                </a>
              </div>
            </div>
          } 
        />
      </Routes>
    </Router>
  );
};

// Root App component with providers
const App: React.FC = () => {
  return (
    <AuthProvider>
      <SocketProvider>
        <AppContent />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              duration: 3000,
              style: {
                background: '#059669',
              },
            },
            error: {
              duration: 5000,
              style: {
                background: '#dc2626',
              },
            },
          }}
        />
      </SocketProvider>
    </AuthProvider>
  );
};

export default App; 