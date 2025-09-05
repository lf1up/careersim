import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { RetroBadge } from '../components/ui/RetroBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { SimulationSession, SessionStatus } from '../types/index.ts';
import { getSessionStatusIcon, getSessionStatusLabel, getSessionStatusBadgeColor } from '../utils/sessionStatus.tsx';
import {
  PlayIcon,
  EyeIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

// Status utility functions are now imported from shared utils

const formatDuration = (seconds: number | undefined | null): string => {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) {
    return '0s';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const Sessions: React.FC = () => {
  const [sessions, setSessions] = useState<SimulationSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: '',
    page: 1,
    limit: 20
  });

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const params = {
          ...filters,
          status: filters.status || undefined,
        };

        const response = await apiClient.getSessions(params);
        setSessions(response?.sessions || []);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
        setError('Failed to load sessions. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessions();
  }, [filters]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1
    }));
  };

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-retro tracking-wider2">MY SESSIONS</h1>
        <p className="mt-2 font-monoRetro">
          Track your simulation progress and review past sessions
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div>
          <label htmlFor="status" className="block text-sm font-semibold mb-1">
            Status
          </label>
          <select
            id="status"
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="retro-input block w-56 sm:text-sm"
          >
            <option value="">All Statuses</option>
            <option value={SessionStatus.ACTIVE}>In Progress</option>
            <option value={SessionStatus.PAUSED}>Paused</option>
            <option value={SessionStatus.COMPLETED}>Completed</option>
          </select>
        </div>
      </div>

      {/* Sessions List */}
      {sessions && sessions.length > 0 ? (
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="retro-card hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 transition-transform"
            >
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold">
                        {session.simulation?.title || 'Unknown Simulation'}
                      </h3>
                      <RetroBadge color={getSessionStatusBadgeColor(session.status)} className="text-xs">
                        {getSessionStatusIcon(session.status)}
                        <span className="ml-1">{getSessionStatusLabel(session.status)}</span>
                      </RetroBadge>
                    </div>
                    
                    <p className="text-sm mb-4">
                      {session.simulation?.description}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center text-sm">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        Started: {formatDate(session.startedAt)}
                      </div>
                      
                      <div className="flex items-center text-sm">
                        <ClockIcon className="h-4 w-4 mr-2" />
                        Duration: {formatDuration(session.totalDuration)}
                      </div>
                      
                      <div className="flex items-center text-sm">
                        <CheckCircleIcon className="h-4 w-4 mr-2" />
                        Progress: {session.currentStep || 0}/{session.totalSteps || 0} steps
                      </div>
                      
                      {session.completedAt && (
                        <div className="flex items-center text-sm">
                          <CheckCircleIcon className="h-4 w-4 mr-2" />
                          Completed: {formatDate(session.completedAt)}
                        </div>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full border-2 border-black h-3 mb-4 shadow-retro-2">
                      <div
                        className="bg-primary-500 h-[10px] transition-all duration-300"
                        style={{ 
                          width: `${(session.totalSteps || 0) > 0 ? ((session.currentStep || 0) / (session.totalSteps || 1)) * 100 : 0}%` 
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 ml-4">
                    <Link to={`/sessions/${session.id}`}>
                      <Button variant="outline" size="sm" className="inline-flex items-center">
                        <EyeIcon className="h-4 w-4 mr-1" />
                        View Details
                      </Button>
                    </Link>
                    
                    {(session.status === SessionStatus.ACTIVE || 
                      session.status === SessionStatus.PAUSED ||
                      (session.status as string) === 'started' ||
                      (session.status as string) === 'in_progress') ? (
                      <Link to={`/simulations/${session.simulation?.id}/session/${session.id}`}>
                        <Button size="sm" className="inline-flex items-center">
                          <PlayIcon className="h-4 w-4 mr-1" />
                          Continue
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <PlayIcon className="mx-auto h-12 w-12 text-secondary-400" />
          <h3 className="mt-2 text-sm font-medium text-secondary-900">No sessions found</h3>
          <p className="mt-1 text-sm text-secondary-500">
            Start your first simulation to see your sessions here.
          </p>
          <div className="mt-6">
            <Link to="/simulations">
              <Button>Browse Simulations</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}; 