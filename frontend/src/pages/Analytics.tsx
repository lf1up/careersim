import React, { useState, useEffect } from 'react';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { PerformanceAnalytics } from '../types/index.ts';
import { 
  ChartBarIcon,
  TrophyIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  PlayIcon
} from '@heroicons/react/24/outline';
import { ValueText } from '../components/ui/ValueText.tsx';


interface AnalyticsCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({
  title,
  value,
  icon: Icon,
  subtitle,
  trend,
}) => {
  return (
    <div className="retro-card p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className="h-6 w-6" />
          </div>
          <div className="ml-3">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-2xl font-semibold"><ValueText value={value} /></p>
            {subtitle && <p className="text-sm font-monoRetro">{subtitle}</p>}
          </div>
        </div>
        {trend && (
          <div className={`flex items-center text-sm ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            <ArrowTrendingUpIcon className={`h-4 w-4 mr-1 ${trend.isPositive ? '' : 'transform rotate-180'}`} />
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
    </div>
  );
};

export const Analytics: React.FC = () => {
  const [analytics, setAnalytics] = useState<PerformanceAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const data = await apiClient.getPerformanceAnalytics();
        setAnalytics(data);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
        setError('Failed to load analytics. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-8">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <ChartBarIcon className="mx-auto h-12 w-12 text-secondary-400" />
          <h3 className="mt-2 text-sm font-medium text-secondary-900">No analytics data</h3>
          <p className="mt-1 text-sm text-secondary-500">
            Complete some simulations to see your performance analytics.
          </p>
        </div>
      </div>
    );
  }

  const { stats, averageScores, derived } = analytics as any;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-retro tracking-wider2">PERSONAL ANALYTICS</h1>
        <p className="mt-2 font-monoRetro">
          Track your performance and progress across simulations
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <AnalyticsCard
          title="Total Sessions"
          value={stats?.totalSessions || 0}
          icon={PlayIcon}
        />
        <AnalyticsCard
          title="Completion Rate"
          value={`${Math.round(stats?.completionRate || 0)}%`}
          icon={CheckCircleIcon}
          subtitle="Of started sessions"
        />
                 <AnalyticsCard
           title="Completed Sessions"
           value={stats?.completedSessions || 0}
           icon={CheckCircleIcon}
           subtitle="Successfully finished"
         />
        <AnalyticsCard
          title="Overall Score"
          value={`${Math.round((averageScores?.avgOverall || 0) * 1000) / 10}%`}
          icon={TrophyIcon}
          subtitle="Average across all"
        />
        {derived && (
          <>
            <AnalyticsCard
              title="Best Overall"
              value={`${Math.round((derived.bestOverallScore || 0) * 10) / 10}`}
              icon={TrophyIcon}
              subtitle="Personal best"
            />
            <AnalyticsCard
              title="Avg Duration"
              value={`${derived.averageDurationSeconds || 0}s`}
              icon={PlayIcon}
              subtitle="Per session"
            />
            <AnalyticsCard
              title="30d Completion"
              value={`${Math.round((derived.recentCompletionRate30d || 0))}%`}
              icon={CheckCircleIcon}
              subtitle="Last 30 days"
            />
          </>
        )}
      </div>

      {/* Performance Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Average Scores by Category */}
        <div className="retro-card">
          <div className="px-6 py-4 border-b-2 border-black">
            <h2 className="text-xl font-semibold">
              Performance by Skill
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">Communication</span>
                <div className="flex items-center">
                  <div className="w-32 border-2 border-black h-3 mr-3 shadow-[2px_2px_0_#111827]">
                    <div 
                      className="bg-blue-600 h-[10px]" 
                      style={{ width: `${(averageScores?.avgCommunication || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold">
                    <ValueText value={`${Math.round((averageScores?.avgCommunication || 0) * 100)}%`} />
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">Problem Solving</span>
                <div className="flex items-center">
                  <div className="w-32 border-2 border-black h-3 mr-3 shadow-[2px_2px_0_#111827]">
                    <div 
                      className="bg-green-600 h-[10px]" 
                      style={{ width: `${(averageScores?.avgProblemSolving || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold">
                    <ValueText value={`${Math.round((averageScores?.avgProblemSolving || 0) * 100)}%`} />
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">Emotional Intelligence</span>
                <div className="flex items-center">
                  <div className="w-32 border-2 border-black h-3 mr-3 shadow-[2px_2px_0_#111827]">
                    <div 
                      className="bg-purple-600 h-[10px]" 
                      style={{ width: `${(averageScores?.avgEmotional || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold">
                    <ValueText value={`${Math.round((averageScores?.avgEmotional || 0) * 100)}%`} />
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">Outcome</span>
                <div className="flex items-center">
                  <div className="w-32 border-2 border-black h-3 mr-3 shadow-[2px_2px_0_#111827]">
                    <div 
                      className="bg-orange-600 h-[10px]" 
                      style={{ width: `${(averageScores?.avgOutcome || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold">
                    <ValueText value={`${Math.round((averageScores?.avgOutcome || 0) * 100)}%`} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

                 {/* Performance Summary */}
         <div className="retro-card">
           <div className="px-6 py-4 border-b-2 border-black">
             <h2 className="text-xl font-semibold">
               Performance Summary
             </h2>
           </div>
           <div className="p-6">
             <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <span className="text-sm font-semibold">Sessions Started</span>
                 <span className="text-sm font-semibold">
                   <ValueText value={stats?.totalSessions || 0} />
                 </span>
               </div>
               
               <div className="flex justify-between items-center">
                 <span className="text-sm font-semibold">Sessions Completed</span>
                 <span className="text-sm font-semibold">
                   <ValueText value={stats?.completedSessions || 0} />
                 </span>
               </div>
               
               <div className="flex justify-between items-center">
                 <span className="text-sm font-semibold">Success Rate</span>
                 <span className="text-sm font-semibold">
                   <ValueText value={`${Math.round(stats?.completionRate || 0)}%`} />
                 </span>
               </div>
               
               <div className="flex justify-between items-center">
                 <span className="text-sm font-semibold">Overall Average</span>
                 <span className="text-sm font-semibold">
                   <ValueText value={`${Math.round((averageScores?.avgOverall || 0) * 1000) / 10}%`} />
                 </span>
               </div>
             </div>
           </div>
         </div>
      </div>
    </div>
  );
}; 