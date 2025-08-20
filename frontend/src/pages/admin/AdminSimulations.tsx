import React, { useState, useEffect } from 'react';
import {
  FunnelIcon,
  EyeIcon,
  BeakerIcon,
  TagIcon,
  UserGroupIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { Simulation, SimulationStatus, SimulationDifficulty, Persona, ConversationGoal } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import { Button } from '../../components/ui/Button.tsx';
import toast from 'react-hot-toast';

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

const getDifficultyColor = (difficulty: SimulationDifficulty): string => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'bg-green-100 text-green-800';
    case SimulationDifficulty.INTERMEDIATE:
      return 'bg-blue-100 text-blue-800';
    case SimulationDifficulty.ADVANCED:
      return 'bg-yellow-100 text-yellow-800';
    case SimulationDifficulty.EXPERT:
      return 'bg-orange-100 text-orange-800';
    case SimulationDifficulty.MASTER:
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

interface SimulationsTableProps {
  simulations: Simulation[];
  onEdit: (simulation: Simulation) => void;
  onDelete: (simulation: Simulation) => void;
  onEditPersonas: (simulation: Simulation) => void;
}

const SimulationsTable: React.FC<SimulationsTableProps> = ({ simulations, onEdit, onDelete, onEditPersonas }) => {
  return (
    <div className="overflow-x-auto" style={{ 
      scrollbarWidth: 'thin', 
      scrollbarColor: '#d1d5db #f3f4f6',
      WebkitOverflowScrolling: 'touch'
    }}>
      <div className="inline-block min-w-full align-middle">
        <table className="min-w-full bg-white divide-y divide-gray-200" style={{ minWidth: '1200px' }}>
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Simulation
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Category
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Difficulty
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Personas
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Stats
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Created
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {simulations.map((simulation) => (
            <tr key={simulation.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-10 w-10">
                    {simulation.thumbnailUrl ? (
                      <img
                        className="h-10 w-10 rounded-lg object-cover"
                        src={simulation.thumbnailUrl}
                        alt={simulation.title}
                      />
                    ) : (
                      <div className="h-10 w-10 bg-primary-100 rounded-lg flex items-center justify-center">
                        <BeakerIcon className="h-6 w-6 text-primary-600" />
                      </div>
                    )}
                  </div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-gray-900">
                      {simulation.title}
                    </div>
                    <div className="text-sm text-gray-500 max-w-xs truncate">
                      {simulation.description}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="text-sm text-gray-900">
                    {simulation.category.name}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getDifficultyColor(simulation.difficulty)}`}>
                  {getDifficultyLabel(simulation.difficulty)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  simulation.status === SimulationStatus.PUBLISHED
                    ? 'bg-green-100 text-green-800'
                    : simulation.status === SimulationStatus.DRAFT
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {simulation.status.charAt(0).toUpperCase() + simulation.status.slice(1).toLowerCase()}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center space-x-2">
                  <div className="text-sm text-gray-900">
                    {simulation.personas && simulation.personas.length > 0 ? (
                      <div className="flex items-center">
                        <UserGroupIcon className="h-4 w-4 mr-1 text-gray-400" />
                        <span className="text-xs">
                          {simulation.personas.length} persona{simulation.personas.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">No personas</span>
                    )}
                  </div>
                  <button
                    onClick={() => onEditPersonas(simulation)}
                    className="text-primary-600 hover:text-primary-900"
                    title="Edit Personas"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div>
                  <div className="flex items-center">
                    <EyeIcon className="h-4 w-4 mr-1" />
                    {simulation.viewCount} views
                  </div>
                  <div className="text-xs text-gray-400">
                    {simulation.completionCount} completions
                  </div>
                  {Array.isArray(simulation.conversationGoals) && simulation.conversationGoals.length > 0 && (
                    <div className="text-xs text-gray-400">
                      🎯 {simulation.conversationGoals.length} goal{simulation.conversationGoals.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  {simulation.averageRating > 0 && (
                    <div className="text-xs text-gray-400">
                      ⭐ {simulation.averageRating.toFixed(1)}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {new Date(simulation.createdAt).toLocaleDateString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => onEdit(simulation)}
                    className="text-primary-600 hover:text-primary-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(simulation)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
};

interface EditSimulationModalProps {
  simulation: Simulation;
  onClose: () => void;
  onSave: (simulation: Simulation) => void;
}

const EditSimulationModal: React.FC<EditSimulationModalProps> = ({ simulation, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    title: simulation.title,
    description: simulation.description,
    scenario: simulation.scenario,
    difficulty: simulation.difficulty,
    status: simulation.status,
    estimatedDurationMinutes: simulation.estimatedDurationMinutes,
    isPublic: simulation.isPublic,
    objectives: Array.isArray(simulation.objectives) ? simulation.objectives.join('\n') : '',
    tags: Array.isArray(simulation.tags) ? simulation.tags.join(', ') : '',
  });

  const [goals, setGoals] = useState<ConversationGoal[]>(
    (simulation.conversationGoals || [])
      .slice()
      .sort((a, b) => a.stepNumber - b.stepNumber)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const updateData = {
        title: formData.title,
        description: formData.description,
        scenario: formData.scenario,
        difficulty: formData.difficulty,
        status: formData.status,
        estimatedDurationMinutes: formData.estimatedDurationMinutes,
        isPublic: formData.isPublic,
        objectives: formData.objectives ? formData.objectives.split('\n').filter(obj => obj.trim() !== '') : [],
        tags: formData.tags ? formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '') : [],
        conversationGoals: goals.map((g, idx) => ({
          stepNumber: typeof g.stepNumber === 'number' && g.stepNumber > 0 ? g.stepNumber : idx + 1,
          isOptional: !!g.isOptional,
          title: (g.title || '').trim(),
          description: (g.description || '').trim(),
          keyBehaviors: Array.isArray(g.keyBehaviors) ? g.keyBehaviors.filter(Boolean) : [],
          successIndicators: Array.isArray(g.successIndicators) ? g.successIndicators.filter(Boolean) : [],
        })),
      };

      const updatedSimulation = await apiClient.updateSimulation(simulation.id, updateData);
      toast.success('Simulation updated successfully');
      onSave(updatedSimulation);
    } catch (error: any) {
      console.error('Failed to update simulation:', error);
      const message = error.response?.data?.error || 'Failed to update simulation';
      toast.error(message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-secondary-900">
              Edit Simulation
            </h2>
            <button
              onClick={onClose}
              className="text-secondary-400 hover:text-secondary-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Duration (minutes) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.estimatedDurationMinutes}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimatedDurationMinutes: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Difficulty *
                </label>
                <select
                  required
                  value={formData.difficulty}
                  onChange={(e) => setFormData(prev => ({ ...prev, difficulty: Number(e.target.value) as SimulationDifficulty }))}
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value={SimulationDifficulty.BEGINNER}>1 - Beginner</option>
                  <option value={SimulationDifficulty.INTERMEDIATE}>2 - Intermediate</option>
                  <option value={SimulationDifficulty.ADVANCED}>3 - Advanced</option>
                  <option value={SimulationDifficulty.EXPERT}>4 - Expert</option>
                  <option value={SimulationDifficulty.MASTER}>5 - Master</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Status *
                </label>
                <select
                  required
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as SimulationStatus }))}
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value={SimulationStatus.DRAFT}>Draft</option>
                  <option value={SimulationStatus.PUBLISHED}>Published</option>
                  <option value={SimulationStatus.ARCHIVED}>Archived</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="tag1, tag2, tag3"
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Text Areas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Description *
                </label>
                <textarea
                  required
                  rows={4}
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Scenario *
                </label>
                <textarea
                  required
                  rows={4}
                  value={formData.scenario}
                  onChange={(e) => setFormData(prev => ({ ...prev, scenario: e.target.value }))}
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Objectives (one per line)
                </label>
                <textarea
                  rows={4}
                  value={formData.objectives}
                  onChange={(e) => setFormData(prev => ({ ...prev, objectives: e.target.value }))}
                  placeholder="Enter each objective on a new line"
                  className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Conversation Goals */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-medium text-secondary-900">Conversation Goals</h3>
                <Button
                  type="button"
                  onClick={() => {
                    setGoals((prev) => {
                      const nextStep = (prev[prev.length - 1]?.stepNumber || 0) + 1;
                      return [
                        ...prev,
                        {
                          stepNumber: nextStep,
                          isOptional: false,
                          title: '',
                          description: '',
                          keyBehaviors: [],
                          successIndicators: [],
                        },
                      ];
                    });
                  }}
                >
                  Add Goal
                </Button>
              </div>

              {goals.length === 0 ? (
                <p className="text-sm text-secondary-500">No goals defined. Add goals to structure the conversation and enable progress tracking.</p>
              ) : (
                <div className="space-y-4">
                  {goals.map((goal, index) => (
                    <div key={index} className="border border-secondary-200 rounded-md p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <span className="text-sm font-medium text-secondary-700">Step {goal.stepNumber}</span>
                          <label className="inline-flex items-center text-sm text-secondary-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded mr-2"
                              checked={!!goal.isOptional}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setGoals(prev => prev.map((g, i) => i === index ? { ...g, isOptional: checked } : g));
                              }}
                            />
                            Optional
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            className="px-2 py-1 text-xs border border-secondary-300 rounded disabled:opacity-50"
                            onClick={() => {
                              if (index === 0) return;
                              setGoals(prev => {
                                const copy = prev.slice();
                                const tmp = copy[index - 1];
                                copy[index - 1] = copy[index];
                                copy[index] = tmp;
                                return copy.map((g, idx) => ({ ...g, stepNumber: idx + 1 }));
                              });
                            }}
                            disabled={index === 0}
                          >
                            Move Up
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs border border-secondary-300 rounded disabled:opacity-50"
                            onClick={() => {
                              if (index === goals.length - 1) return;
                              setGoals(prev => {
                                const copy = prev.slice();
                                const tmp = copy[index + 1];
                                copy[index + 1] = copy[index];
                                copy[index] = tmp;
                                return copy.map((g, idx) => ({ ...g, stepNumber: idx + 1 }));
                              });
                            }}
                            disabled={index === goals.length - 1}
                          >
                            Move Down
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded"
                            onClick={() => {
                              setGoals(prev => prev.filter((_, i) => i !== index).map((g, idx) => ({ ...g, stepNumber: idx + 1 })));
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-secondary-700 mb-2">Title</label>
                          <input
                            type="text"
                            value={goal.title || ''}
                            onChange={(e) => setGoals(prev => prev.map((g, i) => i === index ? { ...g, title: e.target.value } : g))}
                            className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-secondary-700 mb-2">Description</label>
                          <input
                            type="text"
                            value={goal.description || ''}
                            onChange={(e) => setGoals(prev => prev.map((g, i) => i === index ? { ...g, description: e.target.value } : g))}
                            className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-secondary-700 mb-2">Key Behaviors (one per line)</label>
                          <textarea
                            rows={3}
                            value={(goal.keyBehaviors || []).join('\n')}
                            onChange={(e) => {
                              const list = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                              setGoals(prev => prev.map((g, i) => i === index ? { ...g, keyBehaviors: list } : g));
                            }}
                            className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-secondary-700 mb-2">Success Indicators (one per line)</label>
                          <textarea
                            rows={3}
                            value={(goal.successIndicators || []).join('\n')}
                            onChange={(e) => {
                              const list = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                              setGoals(prev => prev.map((g, i) => i === index ? { ...g, successIndicators: list } : g));
                            }}
                            className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="isPublic"
                checked={formData.isPublic}
                onChange={(e) => setFormData(prev => ({ ...prev, isPublic: e.target.checked }))}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
              />
              <label htmlFor="isPublic" className="ml-2 block text-sm text-secondary-900">
                Public Simulation
              </label>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end space-x-3 pt-6 border-t border-secondary-200">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit">
                Update Simulation
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

interface PersonaManagementModalProps {
  simulation: Simulation;
  onClose: () => void;
  onSave: (updatedSimulation: Simulation) => void;
}

const PersonaManagementModal: React.FC<PersonaManagementModalProps> = ({ simulation, onClose, onSave }) => {
  const [loading, setLoading] = useState(false);
  const [availablePersonas, setAvailablePersonas] = useState<Persona[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>(
    simulation.personas?.map(p => p.id) || []
  );

  useEffect(() => {
    const fetchPersonas = async () => {
      try {
        const personas = await apiClient.getAdminPersonas({ limit: 100 });
        setAvailablePersonas(personas.personas);
      } catch (error) {
        toast.error('Failed to load personas');
      }
    };

    fetchPersonas();
  }, []);

  const handleSave = async () => {
    try {
      setLoading(true);
      const result = await apiClient.updateSimulationPersonas(simulation.id, selectedPersonaIds);
      
      // Update the simulation object with the new personas
      const updatedSimulation = {
        ...simulation,
        personas: result.personas
      };
      
      toast.success('Personas updated successfully');
      onSave(updatedSimulation);
    } catch (error: any) {
      console.error('Failed to update personas:', error);
      const message = error.response?.data?.error || 'Failed to update personas';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePersonaToggle = (personaId: string) => {
    setSelectedPersonaIds(prev => 
      prev.includes(personaId) 
        ? prev.filter(id => id !== personaId)
        : [...prev, personaId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-secondary-900">
              Manage Personas for "{simulation.title}"
            </h2>
            <button
              onClick={onClose}
              className="text-secondary-400 hover:text-secondary-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-medium text-secondary-900 mb-4">
              Select Personas ({selectedPersonaIds.length} selected)
            </h3>
            
            {availablePersonas.length === 0 ? (
              <div className="text-center py-8">
                <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No personas available</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Create personas first to attach them to simulations.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                {availablePersonas.map((persona) => {
                  const isSelected = selectedPersonaIds.includes(persona.id);
                  return (
                    <div
                      key={persona.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        isSelected 
                          ? 'border-primary-500 bg-primary-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={(e) => {
                        // Only handle click if it's not on the checkbox
                        if (e.target !== e.currentTarget.querySelector('input[type="checkbox"]')) {
                          handlePersonaToggle(persona.id);
                        }
                      }}
                    >
                      <div className="flex items-start">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            handlePersonaToggle(persona.id);
                          }}
                          className="mt-1 mr-3 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <div className="flex-1">
                          <div className="flex items-center">
                            <h4 className="text-sm font-medium text-gray-900">
                              {persona.name}
                            </h4>
                            <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              {persona.difficultyText}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{persona.role}</p>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {persona.personality}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-secondary-200">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? 'Updating...' : 'Update Personas'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AdminSimulations: React.FC = () => {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSimulation, setEditingSimulation] = useState<Simulation | null>(null);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersonaSimulation, setEditingPersonaSimulation] = useState<Simulation | null>(null);
  const [filters, setFilters] = useState({
    status: '',
    category: '',
    page: 1,
    limit: 20,
  });
  const [pagination, setPagination] = useState({
    current: 1,
    total: 1,
    count: 0,
    limit: 20,
  });

  useEffect(() => {
    const fetchSimulations = async () => {
      try {
        setLoading(true);
        const params = {
          ...filters,
          status: filters.status || undefined,
          category: filters.category || undefined,
        };

        const response = await apiClient.getAdminSimulations(params);
        setSimulations(response.simulations);
        setPagination(response.pagination);
      } catch (error) {
        toast.error('Failed to load simulations');
        console.error('Fetch simulations error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSimulations();
  }, [filters]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1, // Reset to first page when filtering
    }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  // Handle edit simulation
  const handleEdit = (simulation: Simulation) => {
    setEditingSimulation(simulation);
    setShowModal(true);
  };

  // Handle save simulation
  const handleSave = (updatedSimulation: Simulation) => {
    setSimulations(prev => prev.map(sim => 
      sim.id === updatedSimulation.id ? updatedSimulation : sim
    ));
    setShowModal(false);
    setEditingSimulation(null);
  };

  // Handle close modal
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingSimulation(null);
  };

  // Handle edit personas
  const handleEditPersonas = (simulation: Simulation) => {
    setEditingPersonaSimulation(simulation);
    setShowPersonaModal(true);
  };

  // Handle close persona modal
  const handleClosePersonaModal = () => {
    setShowPersonaModal(false);
    setEditingPersonaSimulation(null);
  };

  // Handle save persona changes
  const handleSavePersonas = (updatedSimulation: Simulation) => {
    setSimulations(prev => prev.map(sim => 
      sim.id === updatedSimulation.id ? updatedSimulation : sim
    ));
    setShowPersonaModal(false);
    setEditingPersonaSimulation(null);
  };

  // Handle delete simulation
  const handleDelete = async (simulation: Simulation) => {
    if (!window.confirm(`Are you sure you want to delete "${simulation.title}"?`)) {
      return;
    }

    try {
      await apiClient.deleteSimulation(simulation.id);
      toast.success('Simulation deleted successfully');
      // Refresh the simulations list
      const response = await apiClient.getAdminSimulations(filters);
      setSimulations(response.simulations);
      setPagination(response.pagination);
    } catch (error: any) {
      console.error('Failed to delete simulation:', error);
      const message = error.response?.data?.error || 'Failed to delete simulation';
      toast.error(message);
    }
  };



  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Simulation Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage simulations, content, and publishing status
          </p>
        </div>
        <button className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
          Create Simulation
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BeakerIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Total Simulations
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {pagination.count}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TagIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Published
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {simulations.filter(s => s.status === SimulationStatus.PUBLISHED).length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <EyeIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Total Views
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {simulations.reduce((sum, s) => sum + s.viewCount, 0).toLocaleString()}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TagIcon className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Completions
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {simulations.reduce((sum, s) => sum + s.completionCount, 0).toLocaleString()}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="p-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All Statuses</option>
            <option value={SimulationStatus.DRAFT}>Draft</option>
            <option value={SimulationStatus.PUBLISHED}>Published</option>
            <option value={SimulationStatus.ARCHIVED}>Archived</option>
          </select>
          <select
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="p-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All Categories</option>
            {/* Categories would be loaded from API */}
          </select>
          <div className="flex items-center text-sm text-gray-500">
            <FunnelIcon className="h-4 w-4 mr-2" />
            {pagination.count} total simulations
          </div>
        </div>
      </div>

      {/* Simulations Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="max-w-full">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : simulations.length > 0 ? (
          <SimulationsTable 
            simulations={simulations} 
            onEdit={handleEdit}
            onDelete={handleDelete}
            onEditPersonas={handleEditPersonas}
          />
        ) : (
          <div className="text-center py-12">
            <BeakerIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No simulations</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a new simulation.
            </p>
            <div className="mt-6">
              <button className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
                <BeakerIcon className="-ml-1 mr-2 h-5 w-5" />
                New Simulation
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Pagination */}
      {pagination.total > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Showing {((pagination.current - 1) * pagination.limit) + 1} to{' '}
            {Math.min(pagination.current * pagination.limit, pagination.count)} of{' '}
            {pagination.count} results
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => handlePageChange(pagination.current - 1)}
              disabled={pagination.current === 1}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => handlePageChange(pagination.current + 1)}
              disabled={pagination.current === pagination.total}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showModal && editingSimulation && (
        <EditSimulationModal
          simulation={editingSimulation}
          onClose={handleCloseModal}
          onSave={handleSave}
        />
      )}

      {/* Persona Management Modal */}
      {showPersonaModal && editingPersonaSimulation && (
        <PersonaManagementModal
          simulation={editingPersonaSimulation}
          onClose={handleClosePersonaModal}
          onSave={handleSavePersonas}
        />
      )}
    </div>
  );
}; 