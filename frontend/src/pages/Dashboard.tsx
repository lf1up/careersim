import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { RetroBadge } from '../components/ui/RetroBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { 
  Simulation, 
  SimulationSession, 
  PerformanceAnalytics,
  SessionStatus
} from '../types/index.ts';
import { getSessionStatusIcon, getSessionStatusLabel, getSessionStatusBadgeColor } from '../utils/sessionStatus.tsx';
import { 
  ClockIcon,
  TagIcon,
  PlayIcon
} from '@heroicons/react/24/outline';
import { ValueText } from '../components/ui/ValueText.tsx';

// Difficulty utility label
import { categoryNameToBadgeColor, difficultyToBadgeColor, getDifficultyLabel } from '../utils/badges.ts';

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [recentSessions, setRecentSessions] = useState<SimulationSession[]>([]);
  const [analytics, setAnalytics] = useState<PerformanceAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch recent simulations
        try {
          const simulationsResponse = await apiClient.getSimulations({ 
            page: 1, 
            limit: 6 
          });
          setSimulations(simulationsResponse?.simulations || []);
        } catch (error) {
          console.error('Failed to fetch simulations:', error);
          setSimulations([]);
        }

        // Fetch recent sessions
        try {
          const sessionsResponse = await apiClient.getSessions({ 
            page: 1, 
            limit: 5 
          });
          setRecentSessions(sessionsResponse?.sessions || []);
        } catch (error) {
          console.error('Failed to fetch sessions:', error);
          setRecentSessions([]);
        }

        // Fetch analytics
        try {
          const analyticsData = await apiClient.getPerformanceAnalytics();
          setAnalytics(analyticsData);
        } catch (error) {
          console.error('Failed to fetch analytics:', error);
          setAnalytics(null);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
        setError('Failed to load dashboard data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-8">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
          WELCOME BACK, {user?.firstName?.toUpperCase()}!
        </h1>
        <p className="mt-2 font-monoRetro text-secondary-600 dark:text-secondary-400">
          Continue your career development journey
        </p>
      </div>

      {/* Analytics Overview */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="retro-card p-6">
            <h3 className="text-lg font-medium text-secondary-900 dark:text-retro-ink-dark mb-2">
              Total Sessions
            </h3>
            <p className="text-3xl font-bold text-retro-ink dark:text-retro-ink-dark">
              <ValueText value={analytics.stats?.totalSessions || 0} />
            </p>
          </div>
          <div className="retro-card p-6">
            <h3 className="text-lg font-medium text-secondary-900 dark:text-retro-ink-dark mb-2">
              Completion Rate
            </h3>
            <p className="text-3xl font-bold text-retro-ink dark:text-retro-ink-dark">
              <ValueText value={`${Math.round(analytics.stats?.completionRate || 0)}%`} />
            </p>
          </div>
          <div className="retro-card p-6">
            <h3 className="text-lg font-medium text-secondary-900 dark:text-retro-ink-dark mb-2">
              Average Score
            </h3>
            <p className="text-3xl font-bold text-retro-ink dark:text-retro-ink-dark">
              <ValueText value={Math.round((analytics.averageScores?.avgOverall || 0) * 10) / 10} />
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Available Simulations */}
        <div className="retro-card">
          <div className="px-6 py-4 border-b-2 border-black dark:border-retro-ink-dark">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-retro-ink dark:text-retro-ink-dark">
                Available Simulations
              </h2>
              <Link to="/simulations">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </div>
          </div>
          <div className="p-6">
            {simulations && simulations.length > 0 ? (
              <div className="space-y-4">
                {simulations.slice(0, 3).map((simulation) => (
                  <div
                    key={simulation.id}
                    className="border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark p-4 shadow-retro-2 dark:shadow-retro-dark-2 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1 transition-transform"
                  >
                    <h3 className="font-semibold mb-2 text-retro-ink dark:text-retro-ink-dark">
                      {simulation.title}
                    </h3>
                    <p className="text-sm mb-3 text-secondary-600 dark:text-secondary-400">
                      {simulation.description}
                    </p>

                    <div className="flex items-center gap-2 mb-3">
                      {simulation.category && (
                        <RetroBadge color={categoryNameToBadgeColor(simulation.category.name)} className="text-xs">
                          <TagIcon className="h-3 w-3 mr-1" />
                          {simulation.category.name}
                        </RetroBadge>
                      )}
                      
                      <RetroBadge color={difficultyToBadgeColor(simulation.difficulty)} className="text-xs">
                        {getDifficultyLabel(simulation.difficulty)}
                      </RetroBadge>
                    </div>

                    <div className="flex justify-between items-center">
                      <div className="flex items-center text-sm text-secondary-600 dark:text-secondary-400">
                        <ClockIcon className="h-4 w-4 mr-1" />
                        {simulation.estimatedDurationMinutes} min
                      </div>
                      <Link to={`/simulations/${simulation.id}`}>
                        <Button size="sm" className="inline-flex items-center">
                          <PlayIcon className="h-4 w-4 mr-1" />
                          Start
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-secondary-600 dark:text-secondary-400">No simulations available</p>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="retro-card">
          <div className="px-6 py-4 border-b-2 border-black dark:border-retro-ink-dark">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-retro-ink dark:text-retro-ink-dark">
                Recent Sessions
              </h2>
              <Link to="/sessions">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </div>
          </div>
          <div className="p-6">
            {recentSessions && recentSessions.length > 0 ? (
              <div className="space-y-4">
                {recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark p-4 shadow-retro-2 dark:shadow-retro-dark-2 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1 transition-transform"
                  >
                    <h3 className="font-semibold text-retro-ink dark:text-retro-ink-dark">
                      {session.simulation?.title || 'Unknown Simulation'}
                    </h3>
                    <div className="flex justify-between items-center mt-2">
                      <RetroBadge color={getSessionStatusBadgeColor(session.status)} className="text-xs">
                        {getSessionStatusIcon(session.status, 'h-3 w-3')}
                        <span className="ml-1">{getSessionStatusLabel(session.status)}</span>
                      </RetroBadge>
                      <div className="flex items-center gap-2">
                        {(session.status === SessionStatus.ACTIVE || 
                          session.status === SessionStatus.PAUSED ||
                          (session.status as string) === 'started' ||
                          (session.status as string) === 'in_progress') && (
                          <Link to={`/simulations/${session.simulation?.id}/session/${session.id}`}>
                            <Button size="sm" className="inline-flex items-center">
                              <PlayIcon className="h-4 w-4 mr-1" />
                              Continue
                            </Button>
                          </Link>
                        )}
                        <Link to={`/sessions/${session.id}`}>
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="mb-4 text-secondary-600 dark:text-secondary-400">
                  You haven't started any sessions yet
                </p>
                <Link to="/simulations">
                  <Button>Start Your First Session</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}; 