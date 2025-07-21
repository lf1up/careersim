import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UsersIcon,
  BeakerIcon,
  PlayIcon,
  CheckCircleIcon,
  CreditCardIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { AdminDashboardStats } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import toast from 'react-hot-toast';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, trend }) => (
  <div className="bg-white overflow-hidden shadow rounded-lg">
    <div className="p-5">
      <div className="flex items-center">
        <div className="flex-shrink-0">
          <Icon className="h-6 w-6 text-gray-400" />
        </div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 truncate">
              {title}
            </dt>
            <dd className="flex items-baseline">
              <div className="text-2xl font-semibold text-gray-900">
                {typeof value === 'number' ? value.toLocaleString() : value}
              </div>
              {trend && (
                <div className={`ml-2 flex items-baseline text-sm ${
                  trend.isPositive ? 'text-green-600' : 'text-red-600'
                }`}>
                  <span>
                    {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
                  </span>
                </div>
              )}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  </div>
);

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setLoading(true);
        const data = await apiClient.getAdminDashboard();
        setStats(data);
      } catch (error) {
        toast.error('Failed to load dashboard statistics');
        console.error('Dashboard stats error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardStats();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="text-gray-500">Failed to load dashboard statistics</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { overview, userGrowth, topSimulations } = stats;
  const completionRate = overview.totalSessions > 0 
    ? Math.round((overview.completedSessions / overview.totalSessions) * 100) 
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your CareerSim platform performance
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={overview.totalUsers}
          icon={UsersIcon}
        />
        <StatCard
          title="Active Users"
          value={overview.activeUsers}
          icon={UsersIcon}
        />
        <StatCard
          title="Published Simulations"
          value={overview.publishedSimulations}
          icon={BeakerIcon}
        />
        <StatCard
          title="Total Sessions"
          value={overview.totalSessions}
          icon={PlayIcon}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Completed Sessions"
          value={overview.completedSessions}
          icon={CheckCircleIcon}
        />
        <StatCard
          title="Completion Rate"
          value={`${completionRate}%`}
          icon={CheckCircleIcon}
        />
        <StatCard
          title="Active Subscriptions"
          value={overview.activeSubscriptions}
          icon={CreditCardIcon}
        />
        <StatCard
          title="Total Subscriptions"
          value={overview.totalSubscriptions}
          icon={CreditCardIcon}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Growth Chart */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">User Growth (Last 30 Days)</h3>
          {userGrowth.length > 0 ? (
            <div className="space-y-2">
              {userGrowth.slice(0, 10).map((day, index) => (
                <div key={index} className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    {new Date(day.date).toLocaleDateString()}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    +{day.count} users
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No recent user growth data</p>
          )}
        </div>

        {/* Top Simulations */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Top Simulations</h3>
          {topSimulations.length > 0 ? (
            <div className="space-y-4">
              {topSimulations.slice(0, 5).map((simulation, index) => (
                <div key={simulation.id} className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {simulation.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {simulation.total_sessions} sessions •{' '}
                      {simulation.completed_sessions} completed
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-gray-900">
                      #{index + 1}
                    </div>
                    <div className="text-xs text-gray-500">
                      {simulation.total_sessions > 0 
                        ? Math.round((simulation.completed_sessions / simulation.total_sessions) * 100)
                        : 0}% completion
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No simulation data available</p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <button 
            onClick={() => navigate('/admin/users')}
            className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <UsersIcon className="h-4 w-4 mr-2" />
            Manage Users
          </button>
          <button 
            onClick={() => navigate('/admin/simulations')}
            className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <BeakerIcon className="h-4 w-4 mr-2" />
            View Simulations
          </button>
          <button 
            onClick={() => navigate('/admin/analytics')}
            className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <CheckCircleIcon className="h-4 w-4 mr-2" />
            Analytics
          </button>
          <button 
            onClick={() => navigate('/admin/export')}
            className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <CreditCardIcon className="h-4 w-4 mr-2" />
            Export Data
          </button>
          <button 
            onClick={() => navigate('/admin/system')}
            className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <CpuChipIcon className="h-4 w-4 mr-2" />
            System
          </button>
        </div>
      </div>
    </div>
  );
}; 