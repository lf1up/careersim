import React, { useState, useEffect } from 'react';
import {
  UsersIcon,
  ClockIcon,
  TrophyIcon,
  ChartBarIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { AdminAnalytics as AdminAnalyticsType } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import toast from 'react-hot-toast';

interface AnalyticsCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({ title, value, icon: Icon, subtitle }) => (
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
            </dd>
            {subtitle && (
              <div className="text-sm text-gray-500 mt-1">
                {subtitle}
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  </div>
);

export const AdminAnalytics: React.FC = () => {
  const [analytics, setAnalytics] = useState<AdminAnalyticsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'users' | 'sessions' | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const data = await apiClient.getAdminAnalytics();
        setAnalytics(data);
      } catch (error) {
        toast.error('Failed to load analytics');
        console.error('Analytics error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  const handleExport = async (type: 'users' | 'sessions') => {
    try {
      setExporting(type);
      
      let data;
      let filename;
      
      if (type === 'users') {
        data = await apiClient.exportAdminUsers();
        filename = `users-export-${new Date().toISOString().split('T')[0]}.json`;
      } else {
        data = await apiClient.exportAdminSessions();
        filename = `sessions-export-${new Date().toISOString().split('T')[0]}.json`;
      }

      // Create and download file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`${type} data exported successfully`);
    } catch (error) {
      toast.error(`Failed to export ${type} data`);
      console.error('Export error:', error);
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="text-gray-500">Failed to load analytics</p>
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

  const { userStats, sessionStats, popularSimulations } = analytics;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Insights</h1>
          <p className="mt-1 text-sm text-gray-500">
            Comprehensive analytics about platform usage and performance
          </p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => handleExport('users')}
            disabled={exporting === 'users'}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'users' ? (
              <LoadingSpinner size="sm" />
            ) : (
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
            )}
            Export Users
          </button>
          <button
            onClick={() => handleExport('sessions')}
            disabled={exporting === 'sessions'}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'sessions' ? (
              <LoadingSpinner size="sm" />
            ) : (
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
            )}
            Export Sessions
          </button>
        </div>
      </div>

      {/* User Statistics */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">User Statistics</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <AnalyticsCard
            title="Total Users"
            value={userStats.totalUsers}
            icon={UsersIcon}
          />
          <AnalyticsCard
            title="Active Users"
            value={userStats.activeUsers}
            icon={UsersIcon}
            subtitle={`${userStats.totalUsers > 0 ? Math.round((userStats.activeUsers / userStats.totalUsers) * 100) : 0}% of total`}
          />
          <AnalyticsCard
            title="Avg Simulations per User"
            value={userStats.avgSimulationsPerUser.toFixed(1)}
            icon={ChartBarIcon}
          />
        </div>
      </div>

      {/* Session Statistics */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Session Performance</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <AnalyticsCard
            title="Total Sessions"
            value={sessionStats.totalSessions}
            icon={ChartBarIcon}
          />
          <AnalyticsCard
            title="Completed Sessions"
            value={sessionStats.completedSessions}
            icon={ChartBarIcon}
            subtitle={`${sessionStats.totalSessions > 0 ? Math.round((sessionStats.completedSessions / sessionStats.totalSessions) * 100) : 0}% completion rate`}
          />
          <AnalyticsCard
            title="Average Duration"
            value={`${Math.round(sessionStats.avgDuration / 60)}m`}
            icon={ClockIcon}
            subtitle="Minutes per session"
          />
          <AnalyticsCard
            title="Average Score"
            value={`${sessionStats.avgScore.toFixed(1)}%`}
            icon={TrophyIcon}
          />
        </div>
      </div>

      {/* Popular Simulations */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Most Popular Simulations</h2>
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {popularSimulations.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {popularSimulations.map((simulation, index) => (
                <div key={simulation.id} className="p-6 flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <span className="text-primary-600 font-bold">#{index + 1}</span>
                    </div>
                    <div className="ml-4">
                      <h3 className="text-sm font-medium text-gray-900">{simulation.title}</h3>
                      <p className="text-sm text-gray-500">
                        {simulation.sessionCount} total sessions
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-gray-900">
                      {simulation.avgScore.toFixed(1)}% avg score
                    </div>
                    <div className="text-sm text-gray-500">
                      {simulation.sessionCount} sessions
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <ChartBarIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No simulation data</h3>
              <p className="mt-1 text-sm text-gray-500">
                Session data will appear here once users start engaging with simulations.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Performance Insights */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Performance Insights</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* User Engagement */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">User Engagement</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Active Users</span>
                <span className="text-sm font-medium text-gray-900">
                  {userStats.totalUsers > 0 
                    ? `${Math.round((userStats.activeUsers / userStats.totalUsers) * 100)}%`
                    : '0%'
                  }
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full" 
                  style={{ 
                    width: `${userStats.totalUsers > 0 
                      ? (userStats.activeUsers / userStats.totalUsers) * 100 
                      : 0}%` 
                  }}
                />
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Session Completion</span>
                <span className="text-sm font-medium text-gray-900">
                  {sessionStats.totalSessions > 0 
                    ? `${Math.round((sessionStats.completedSessions / sessionStats.totalSessions) * 100)}%`
                    : '0%'
                  }
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full" 
                  style={{ 
                    width: `${sessionStats.totalSessions > 0 
                      ? (sessionStats.completedSessions / sessionStats.totalSessions) * 100 
                      : 0}%` 
                  }}
                />
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-base font-medium text-gray-900 mb-4">Performance Metrics</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Average Session Duration</span>
                <span className="text-sm font-medium text-gray-900">
                  {Math.round(sessionStats.avgDuration / 60)} minutes
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Average Score</span>
                <span className="text-sm font-medium text-gray-900">
                  {sessionStats.avgScore.toFixed(1)}%
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Simulations per User</span>
                <span className="text-sm font-medium text-gray-900">
                  {userStats.avgSimulationsPerUser.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 