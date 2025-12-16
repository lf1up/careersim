import React, { useState, useEffect } from 'react';
import { UsersIcon, ClockIcon, TrophyIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { AdminAnalytics as AdminAnalyticsType } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import toast from 'react-hot-toast';
import { ValueText } from '../../components/ui/ValueText.tsx';
import { RetroPanel } from '../../components/ui/RetroPanel.tsx';
import { RetroCard } from '../../components/ui/RetroCard.tsx';
import { RetroBadge, RetroAlert } from '../../components/ui/RetroBadge.tsx';
import { RetroTable } from '../../components/ui/RetroTable.tsx';

interface AnalyticsCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({ title, value, icon: Icon, subtitle }) => (
  <RetroCard className="h-full !rounded-none">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="text-sm text-neutral-600 dark:text-neutral-400">{title}</div>
        <div className="mt-1 text-3xl font-semibold">
          <ValueText value={typeof value === 'number' ? value.toLocaleString() : value} />
        </div>
        {subtitle && (
          <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
            {(() => {
              const match = subtitle.match(/^([+-]?[\d.,]+%?)(.*)$/);
              if (match) {
                return (
                  <>
                    <ValueText value={match[1]} />{match[2]}
                  </>
                );
              }
              return subtitle;
            })()}
          </div>
        )}
      </div>
      <div className="ml-4">
        <div className="h-10 w-10 border-2 border-black dark:border-retro-ink-dark rounded-full flex items-center justify-center bg-yellow-200 dark:bg-yellow-500 shadow-retro-3 dark:shadow-retro-dark-3">
          <Icon className="h-6 w-6 text-neutral-800 dark:text-retro-ink-dark" />
        </div>
      </div>
    </div>
  </RetroCard>
);

export const AdminAnalytics: React.FC = () => {
  const [analytics, setAnalytics] = useState<AdminAnalyticsType | null>(null);
  const [loading, setLoading] = useState(true);

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



  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <RetroAlert title="Failed to load analytics" tone="error" className="mb-4">
          Please try refreshing the page. If the problem persists, check the server logs.
        </RetroAlert>
        <button onClick={() => window.location.reload()} className="retro-btn-base bg-white dark:bg-retro-surface-dark dark:text-retro-ink-dark px-4 py-2">
          Retry
        </button>
      </div>
    );
  }

  const { userStats, sessionStats, popularSimulations } = analytics;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-retro tracking-wider2 dark:text-retro-ink-dark">ANALYTICS & INSIGHTS</h1>
          <p className="mt-1 text-sm font-monoRetro dark:text-neutral-400">
          Comprehensive analytics about platform usage and performance
          </p>
        </div>
      </div>

      <RetroPanel title="User Statistics">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <AnalyticsCard title="Total Users" value={userStats.totalUsers} icon={UsersIcon} />
          <AnalyticsCard
            title="Active Users"
            value={userStats.activeUsers}
            icon={UsersIcon}
            subtitle={`${userStats.totalUsers > 0 ? Math.round((userStats.activeUsers / userStats.totalUsers) * 100) : 0}% of total`}
          />
          <AnalyticsCard
            title="Avg Simulations per User"
            value={(typeof userStats.avgSimulationsPerUser === 'number' && isFinite(userStats.avgSimulationsPerUser)
              ? userStats.avgSimulationsPerUser
              : 0).toFixed(1)}
            icon={ChartBarIcon}
          />
        </div>
      </RetroPanel>

      <RetroPanel title="Session Performance">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <AnalyticsCard title="Total Sessions" value={sessionStats.totalSessions} icon={ChartBarIcon} />
          <AnalyticsCard
            title="Completed Sessions"
            value={sessionStats.completedSessions}
            icon={ChartBarIcon}
            subtitle={`${sessionStats.totalSessions > 0 ? Math.round((sessionStats.completedSessions / sessionStats.totalSessions) * 100) : 0}% completion rate`}
          />
          <AnalyticsCard title="Average Duration" value={`${Math.round(sessionStats.avgDuration / 60)}m`} icon={ClockIcon} subtitle="Minutes per session" />
          <AnalyticsCard
            title="Average Score"
            value={`${(typeof sessionStats.avgScore === 'number' && isFinite(sessionStats.avgScore) ? sessionStats.avgScore : 0).toFixed(1)}%`}
            icon={TrophyIcon}
          />
        </div>
      </RetroPanel>

      <RetroPanel title="Most Popular Simulations">
        {popularSimulations.length > 0 ? (
          <RetroTable
            columns={[
              { key: 'rank', header: 'Rank', render: (row: any) => <RetroBadge color="yellow">#{row.rank}</RetroBadge>, className: 'w-20' },
              { key: 'title', header: 'Title', render: (row: any) => <span className="font-medium dark:text-retro-ink-dark">{row.title}</span> },
              { key: 'sessionCount', header: 'Sessions', render: (row: any) => <ValueText value={row.sessionCount} /> },
              { key: 'avgScore', header: 'Avg Score', render: (row: any) => <ValueText value={`${(typeof row.avgScore === 'number' && isFinite(row.avgScore) ? row.avgScore : 0).toFixed(1)}%`} /> },
            ]}
            data={popularSimulations.map((s, idx) => ({ ...s, rank: idx + 1 }))}
            keyExtractor={(row: any) => row.id}
          />
        ) : (
          <div className="py-6">
            <RetroAlert tone="info" title="No simulation data">
              Session data will appear here once users start engaging with simulations.
            </RetroAlert>
          </div>
        )}
      </RetroPanel>

      <RetroPanel title="Performance Insights">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RetroCard title={<span className="text-base dark:text-retro-ink-dark">User Engagement</span>} bodyClassName="space-y-4" className="!rounded-none">
            <div className="flex justify-between items-center">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Active Users</span>
              <span className="text-sm font-medium">
                <ValueText value={userStats.totalUsers > 0 ? `${Math.round((userStats.activeUsers / userStats.totalUsers) * 100)}%` : '0%'} />
              </span>
            </div>
            <div className="w-full bg-neutral-200 dark:bg-neutral-700 h-2 border border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2">
              <div
                className="bg-green-500 dark:bg-green-400 h-2"
                style={{ width: `${userStats.totalUsers > 0 ? (userStats.activeUsers / userStats.totalUsers) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Session Completion</span>
              <span className="text-sm font-medium">
                <ValueText value={sessionStats.totalSessions > 0 ? `${Math.round((sessionStats.completedSessions / sessionStats.totalSessions) * 100)}%` : '0%'} />
              </span>
            </div>
            <div className="w-full bg-neutral-200 dark:bg-neutral-700 h-2 border border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2">
              <div
                className="bg-blue-500 dark:bg-blue-400 h-2"
                style={{ width: `${sessionStats.totalSessions > 0 ? (sessionStats.completedSessions / sessionStats.totalSessions) * 100 : 0}%` }}
              />
            </div>
          </RetroCard>

          <RetroCard title={<span className="text-base dark:text-retro-ink-dark">Performance Metrics</span>} bodyClassName="space-y-4" className="!rounded-none">
            <div className="flex justify-between items-center">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Average Session Duration</span>
              <span className="text-sm font-medium dark:text-retro-ink-dark">
                <ValueText value={`${Math.round((typeof sessionStats.avgDuration === 'number' && isFinite(sessionStats.avgDuration) ? sessionStats.avgDuration : 0) / 60)}m`} /> minutes
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Average Score</span>
              <span className="text-sm font-medium">
                <ValueText value={`${(typeof sessionStats.avgScore === 'number' && isFinite(sessionStats.avgScore) ? sessionStats.avgScore : 0).toFixed(1)}%`} />
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Simulations per User</span>
              <span className="text-sm font-medium">
                <ValueText value={(typeof userStats.avgSimulationsPerUser === 'number' && isFinite(userStats.avgSimulationsPerUser) ? userStats.avgSimulationsPerUser : 0).toFixed(1)} />
              </span>
            </div>
          </RetroCard>
        </div>
      </RetroPanel>
    </div>
  );
}; 