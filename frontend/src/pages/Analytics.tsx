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
  trend 
}) => {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className="h-6 w-6 text-secondary-400" />
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-secondary-500">{title}</p>
            <p className="text-2xl font-semibold text-secondary-900">{value}</p>
            {subtitle && (
              <p className="text-sm text-secondary-500">{subtitle}</p>
            )}
          </div>
        </div>
        {trend && (
          <div className={`flex items-center text-sm ${
            trend.isPositive ? 'text-green-600' : 'text-red-600'
          }`}>
                         <ArrowTrendingUpIcon className={`h-4 w-4 mr-1 ${
               trend.isPositive ? '' : 'transform rotate-180'
             }`} />
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

  const { stats, averageScores } = analytics;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-secondary-900">Personal Analytics</h1>
        <p className="mt-2 text-secondary-600">
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
          value={`${Math.round((averageScores?.avgOverall || 0) * 10) / 10}%`}
          icon={TrophyIcon}
          subtitle="Average across all"
        />
      </div>

      {/* Performance Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Average Scores by Category */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-secondary-200">
            <h2 className="text-xl font-semibold text-secondary-900">
              Performance by Skill
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-secondary-700">Communication</span>
                <div className="flex items-center">
                  <div className="w-32 bg-secondary-200 rounded-full h-2 mr-3">
                    <div 
                      className="bg-blue-600 h-2 rounded-full" 
                      style={{ width: `${(averageScores?.avgCommunication || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-secondary-900">
                    {Math.round((averageScores?.avgCommunication || 0) * 100)}%
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-secondary-700">Problem Solving</span>
                <div className="flex items-center">
                  <div className="w-32 bg-secondary-200 rounded-full h-2 mr-3">
                    <div 
                      className="bg-green-600 h-2 rounded-full" 
                      style={{ width: `${(averageScores?.avgProblemSolving || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-secondary-900">
                    {Math.round((averageScores?.avgProblemSolving || 0) * 100)}%
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-secondary-700">Leadership</span>
                <div className="flex items-center">
                  <div className="w-32 bg-secondary-200 rounded-full h-2 mr-3">
                    <div 
                      className="bg-purple-600 h-2 rounded-full" 
                      style={{ width: `${(averageScores?.avgLeadership || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-secondary-900">
                    {Math.round((averageScores?.avgLeadership || 0) * 100)}%
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-secondary-700">Technical Skills</span>
                <div className="flex items-center">
                  <div className="w-32 bg-secondary-200 rounded-full h-2 mr-3">
                    <div 
                      className="bg-orange-600 h-2 rounded-full" 
                      style={{ width: `${(averageScores?.avgTechnical || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-secondary-900">
                    {Math.round((averageScores?.avgTechnical || 0) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

                 {/* Performance Summary */}
         <div className="bg-white rounded-lg shadow">
           <div className="px-6 py-4 border-b border-secondary-200">
             <h2 className="text-xl font-semibold text-secondary-900">
               Performance Summary
             </h2>
           </div>
           <div className="p-6">
             <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <span className="text-sm font-medium text-secondary-700">Sessions Started</span>
                 <span className="text-sm font-medium text-secondary-900">
                   {stats?.totalSessions || 0}
                 </span>
               </div>
               
               <div className="flex justify-between items-center">
                 <span className="text-sm font-medium text-secondary-700">Sessions Completed</span>
                 <span className="text-sm font-medium text-secondary-900">
                   {stats?.completedSessions || 0}
                 </span>
               </div>
               
               <div className="flex justify-between items-center">
                 <span className="text-sm font-medium text-secondary-700">Success Rate</span>
                 <span className="text-sm font-medium text-secondary-900">
                   {Math.round(stats?.completionRate || 0)}%
                 </span>
               </div>
               
               <div className="flex justify-between items-center">
                 <span className="text-sm font-medium text-secondary-700">Overall Average</span>
                 <span className="text-sm font-medium text-secondary-900">
                   {Math.round((averageScores?.avgOverall || 0) * 10) / 10}%
                 </span>
               </div>
             </div>
           </div>
         </div>
      </div>
    </div>
  );
}; 