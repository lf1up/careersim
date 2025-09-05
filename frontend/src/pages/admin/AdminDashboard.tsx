import React, { useState, useEffect } from 'react';
import {
  UsersIcon,
  BeakerIcon,
  PlayIcon,
  CheckCircleIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { AdminDashboardStats } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import toast from 'react-hot-toast';
import { ValueText } from '../../components/ui/ValueText.tsx';
import { RetroPanel } from '../../components/ui/RetroPanel.tsx';
import { RetroCard } from '../../components/ui/RetroCard.tsx';
import { RetroBadge, RetroAlert } from '../../components/ui/RetroBadge.tsx';
import { RetroTable } from '../../components/ui/RetroTable.tsx';
import { Button } from '../../components/ui/Button.tsx';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: { value: number; isPositive: boolean };
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, trend }) => (
  <RetroCard className="h-full !rounded-none">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="text-sm text-neutral-600">{title}</div>
        <div className="mt-1 text-3xl font-semibold">
          <ValueText value={typeof value === 'number' ? value.toLocaleString() : value} />
        </div>
        {trend && (
          <div className={`mt-2 text-xs font-monoRetro ${trend.isPositive ? 'text-green-700' : 'text-red-700'}`}>
            {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}% vs last period
          </div>
        )}
      </div>
      <div className="ml-4">
        <div className="h-10 w-10 border-2 border-black rounded-full flex items-center justify-center bg-amber-200 shadow-retro-3">
          <Icon className="h-6 w-6 text-neutral-800" />
        </div>
      </div>
    </div>
  </RetroCard>
);

export const AdminDashboard: React.FC = () => {
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
      <div className="p-6 max-w-3xl mx-auto">
        <RetroAlert title="Failed to load dashboard statistics" tone="error" className="mb-4">
          Please try refreshing the page. If the issue continues, verify the server status.
        </RetroAlert>
        <Button onClick={() => window.location.reload()} variant="outline" size="md">Retry</Button>
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
        <h1 className="text-2xl font-retro tracking-wider2">ADMIN DASHBOARD</h1>
        <p className="mt-1 text-sm font-monoRetro">Overview of your CAREERSIM platform performance</p>
      </div>

      <RetroPanel title="Overview">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Users" value={overview.totalUsers} icon={UsersIcon} />
          <StatCard title="Active Users" value={overview.activeUsers} icon={UsersIcon} />
          <StatCard title="Published Simulations" value={overview.publishedSimulations} icon={BeakerIcon} />
          <StatCard title="Total Sessions" value={overview.totalSessions} icon={PlayIcon} />
        </div>
      </RetroPanel>

      <RetroPanel title="Key Metrics">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Completed Sessions" value={overview.completedSessions} icon={CheckCircleIcon} />
          <StatCard title="Completion Rate" value={`${completionRate}%`} icon={CheckCircleIcon} />
          <StatCard title="Active Subscriptions" value={overview.activeSubscriptions} icon={CreditCardIcon} />
          <StatCard title="Total Subscriptions" value={overview.totalSubscriptions} icon={CreditCardIcon} />
        </div>
      </RetroPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RetroPanel title="User Growth (Last 30 Days)">
          {userGrowth.length > 0 ? (
            <div className="space-y-3">
              {(() => {
                const recent = userGrowth.slice(-14);
                const max = Math.max(1, ...recent.map(d => d.count));
                return recent.map((day, idx) => (
                  <div key={`${day.date}-${idx}`} className="flex items-center gap-3">
                    <span className="w-24 text-xs font-monoRetro">{new Date(day.date).toLocaleDateString()}</span>
                    <div className="flex-1 border border-black h-4 bg-neutral-100 shadow-retro-2">
                      <div className="h-4 bg-green-500" style={{ width: `${(day.count / max) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right text-xs font-monoRetro"><ValueText value={`+${day.count}`} /></span>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <RetroAlert tone="info">No recent user growth data</RetroAlert>
          )}
        </RetroPanel>

        <RetroPanel title="Top Simulations">
          {topSimulations.length > 0 ? (
            <RetroTable
              columns={[
                { key: 'rank', header: 'Rank', render: (row: any) => <RetroBadge color="yellow">#{row.rank}</RetroBadge>, className: 'w-20' },
                { key: 'title', header: 'Title', render: (row: any) => <span className="font-medium">{row.title}</span> },
                { key: 'sessions', header: 'Sessions', render: (row: any) => <ValueText value={row.sessions} /> },
                { key: 'completed', header: 'Completed', render: (row: any) => <ValueText value={row.completed} /> },
                { key: 'completion', header: 'Completion', render: (row: any) => <ValueText value={`${row.completion}%`} /> },
              ]}
              data={topSimulations.slice(0, 8).map((s, idx) => ({
                id: s.id,
                rank: idx + 1,
                title: s.title,
                sessions: s.total_sessions,
                completed: s.completed_sessions,
                completion: s.total_sessions > 0 ? Math.round((s.completed_sessions / s.total_sessions) * 100) : 0,
              }))}
              keyExtractor={(row: any) => row.id}
            />
          ) : (
            <RetroAlert tone="info">No simulation data available</RetroAlert>
          )}
        </RetroPanel>
      </div>
    </div>
  );
}; 