import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { RetroBadge } from '../components/ui/RetroBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Simulation, SimulationDifficulty, Category } from '../types/index.ts';
import { 
  ClockIcon,
  BeakerIcon,
  TagIcon,
  PlayIcon
} from '@heroicons/react/24/outline';

// styling handled via RetroBadge
import { categoryNameToBadgeColor, difficultyToBadgeColor, getDifficultyLabel } from '../utils/badges.ts';

export const Simulations: React.FC = () => {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    category: '',
    difficulty: '',
    page: 1,
    limit: 12
  });

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const categoriesData = await apiClient.getCategories();
        setCategories(categoriesData);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    };

    fetchCategories();
  }, []);

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
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-retro tracking-wider2">SIMULATIONS</h1>
        <p className="mt-2 font-monoRetro">
          Explore and practice with realistic career scenarios
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div>
          <label htmlFor="category" className="block text-sm font-semibold mb-1">
            Category
          </label>
          <select
            id="category"
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="retro-input block w-56 sm:text-sm"
          >
            <option value="">All Categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="difficulty" className="block text-sm font-semibold mb-1">
            Difficulty
          </label>
          <select
            id="difficulty"
            value={filters.difficulty}
            onChange={(e) => handleFilterChange('difficulty', e.target.value)}
            className="retro-input block w-56 sm:text-sm"
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
              className="retro-card hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 transition-transform"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2">
                      {simulation.title}
                    </h3>
                    <p className="text-sm mb-3">
                      {simulation.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
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

                <div className="flex items-center justify-between">
                  <div className="flex items-center text-sm">
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