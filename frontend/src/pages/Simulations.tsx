import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Simulation, SimulationDifficulty } from '../types/index.ts';
import { 
  ClockIcon,
  BeakerIcon,
  TagIcon,
  PlayIcon
} from '@heroicons/react/24/outline';

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

export const Simulations: React.FC = () => {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    category: '',
    difficulty: '',
    page: 1,
    limit: 12
  });

  useEffect(() => {
    const fetchSimulations = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const params = {
          ...filters,
          category: filters.category || undefined,
          difficulty: filters.difficulty || undefined,
        };

        const response = await apiClient.getSimulations(params);
        setSimulations(response?.simulations || []);
      } catch (error) {
        console.error('Failed to fetch simulations:', error);
        setError('Failed to load simulations. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSimulations();
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-secondary-900">Simulations</h1>
        <p className="mt-2 text-secondary-600">
          Explore and practice with realistic career scenarios
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-secondary-700 mb-1">
            Category
          </label>
          <select
            id="category"
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="block w-full rounded-md border-secondary-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
          >
            <option value="">All Categories</option>
            <option value="interview">Interview</option>
            <option value="negotiation">Negotiation</option>
            <option value="presentation">Presentation</option>
            <option value="networking">Networking</option>
            <option value="leadership">Leadership</option>
          </select>
        </div>

        <div>
          <label htmlFor="difficulty" className="block text-sm font-medium text-secondary-700 mb-1">
            Difficulty
          </label>
          <select
            id="difficulty"
            value={filters.difficulty}
            onChange={(e) => handleFilterChange('difficulty', e.target.value)}
            className="block w-full rounded-md border-secondary-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
          >
            <option value="">All Levels</option>
            <option value={SimulationDifficulty.BEGINNER}>Beginner</option>
            <option value={SimulationDifficulty.INTERMEDIATE}>Intermediate</option>
            <option value={SimulationDifficulty.ADVANCED}>Advanced</option>
            <option value={SimulationDifficulty.EXPERT}>Expert</option>
            <option value={SimulationDifficulty.MASTER}>Master</option>
          </select>
        </div>
      </div>

      {/* Simulations Grid */}
      {simulations && simulations.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {simulations.map((simulation) => (
            <div
              key={simulation.id}
              className="bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-secondary-200"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-secondary-900 mb-2">
                      {simulation.title}
                    </h3>
                    <p className="text-sm text-secondary-600 mb-3">
                      {simulation.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
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

                <div className="flex items-center justify-between">
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
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <BeakerIcon className="mx-auto h-12 w-12 text-secondary-400" />
          <h3 className="mt-2 text-sm font-medium text-secondary-900">No simulations found</h3>
          <p className="mt-1 text-sm text-secondary-500">
            Try adjusting your filters or check back later for new simulations.
          </p>
        </div>
      )}
    </div>
  );
}; 