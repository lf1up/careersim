import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { 
  Simulation, 
  SimulationSession, 
  PerformanceAnalytics,
  SimulationDifficulty,
  SessionStatus
} from '../types/index.ts';
import { getSessionStatusIcon, getSessionStatusColor, getSessionStatusLabel } from '../utils/sessionStatus.tsx';
import { 
  ClockIcon,
  TagIcon,
  PlayIcon
} from '@heroicons/react/24/outline';

// Difficulty utility functions
const getDifficultyColor = (difficulty: SimulationDifficulty): string => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'bg-green-100 text-green-800';
    case SimulationDifficulty.INTERMEDIATE:
      return 'bg-yellow-100 text-yellow-800';
    case SimulationDifficulty.ADVANCED:
      return 'bg-orange-100 text-orange-800';
    case SimulationDifficulty.EXPERT:
      return 'bg-red-100 text-red-800';
    case SimulationDifficulty.MASTER:
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getDifficultyLabel = (difficulty: SimulationDifficulty): string => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'Beginner';
    case SimulationDifficulty.INTERMEDIATE:
      return 'Intermediate';
    case SimulationDifficulty.ADVANCED:
      return 'Advanced';
    case SimulationDifficulty.EXPERT:
      return 'Expert';
    case SimulationDifficulty.MASTER:
      return 'Master';
    default:
      return 'Unknown';
  }
};

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
          <p className="text-red-600 mb-4">{error}</p>
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
        <h1 className="text-3xl font-bold text-secondary-900">
          Welcome back, {user?.firstName}!
        </h1>
        <p className="mt-2 text-secondary-600">
          Continue your career development journey
        </p>
      </div>

      {/* Analytics Overview */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-secondary-900 mb-2">
              Total Sessions
            </h3>
            <p className="text-3xl font-bold text-primary-600">
              {analytics.stats?.totalSessions || 0}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-secondary-900 mb-2">
              Completion Rate
            </h3>
            <p className="text-3xl font-bold text-green-600">
              {Math.round(analytics.stats?.completionRate || 0)}%
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-secondary-900 mb-2">
              Average Score
            </h3>
            <p className="text-3xl font-bold text-blue-600">
              {Math.round((analytics.averageScores?.avgOverall || 0) * 10) / 10}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Available Simulations */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-secondary-200">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-secondary-900">
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
                    className="border border-secondary-200 rounded-lg p-4 hover:border-primary-300 transition-colors"
                  >
                    <h3 className="font-medium text-secondary-900 mb-2">
                      {simulation.title}
                    </h3>
                    <p className="text-sm text-secondary-600 mb-3">
                      {simulation.description}
                    </p>

                    <div className="flex items-center gap-2 mb-3">
                      {simulation.category && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                          <TagIcon className="h-3 w-3 mr-1" />
                          {simulation.category.name}
                        </span>
                      )}
                      
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getDifficultyColor(simulation.difficulty)}`}>
                        {getDifficultyLabel(simulation.difficulty)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <div className="flex items-center text-sm text-secondary-500">
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
              <p className="text-secondary-600">No simulations available</p>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-secondary-200">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-secondary-900">
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
                    className="border border-secondary-200 rounded-lg p-4 hover:border-primary-300 transition-colors"
                  >
                    <h3 className="font-medium text-secondary-900">
                      {session.simulation?.title || 'Unknown Simulation'}
                    </h3>
                    <div className="flex justify-between items-center mt-2">
                      <span className={`inline-flex items-center px-2 py-1 text-xs rounded-full ${getSessionStatusColor(session.status)}`}>
                        {getSessionStatusIcon(session.status, 'h-3 w-3')}
                        <span className="ml-1">{getSessionStatusLabel(session.status)}</span>
                      </span>
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
                <p className="text-secondary-600 mb-4">
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