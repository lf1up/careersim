import React, { useState, useEffect } from 'react';
import {
  FunnelIcon,
  EyeIcon,
  TagIcon,
  UserGroupIcon,
  PencilIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { BeakerIcon } from '@heroicons/react/24/solid';
import { apiClient } from '../../utils/api.ts';
import { Simulation, SimulationStatus, SimulationDifficulty, Persona, ConversationGoal, Category } from '../../types/index.ts';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import { Button } from '../../components/ui/Button.tsx';
import toast from 'react-hot-toast';
import { RetroBadge } from '../../components/ui/RetroBadge.tsx';
import { categoryNameToBadgeColor, difficultyToBadgeColor, getDifficultyLabel } from '../../utils/badges.ts';
import { ValueText } from '../../components/ui/ValueText.tsx';
import { RetroTable } from '../../components/ui/RetroTable.tsx';
import { RetroDialog } from '../../components/ui/RetroDialog.tsx';
import { RetroInput, RetroSelect, RetroTextArea, RetroCheckbox } from '../../components/ui/RetroInput.tsx';

// labels handled via shared utils

// difficulty styling handled via retro badge style

interface SimulationsTableProps {
  simulations: Simulation[];
  onEdit: (simulation: Simulation) => void;
  onDelete: (simulation: Simulation) => void;
  onEditPersonas: (simulation: Simulation) => void;
}

const SimulationsTable: React.FC<SimulationsTableProps> = ({ simulations, onEdit, onDelete, onEditPersonas }) => {
  const columns = [
    {
      key: 'simulation',
      header: 'Simulation',
      render: (simulation: Simulation) => (
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10 border-2 border-black">
            {simulation.thumbnailUrl ? (
              <img
                className="h-full w-full object-cover"
                src={simulation.thumbnailUrl}
                alt={simulation.title}
              />
            ) : (
              <div className="h-full w-full bg-primary-100 flex items-center justify-center">
                <BeakerIcon className="h-6 w-6 text-black" />
              </div>
            )}
          </div>
          <div className="ml-4">
            <div className="text-sm font-semibold">
              {simulation.title}
            </div>
            <div className="text-sm text-neutral-600 max-w-xs truncate">
              {simulation.description}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (simulation: Simulation) => (
        <RetroBadge color={categoryNameToBadgeColor(simulation.category.name)} className="text-xs">
          <TagIcon className="h-3 w-3 mr-1" />
          {simulation.category.name}
        </RetroBadge>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      render: (simulation: Simulation) => (
        <RetroBadge color={difficultyToBadgeColor(simulation.difficulty)} className="text-xs">
          {getDifficultyLabel(simulation.difficulty)}
        </RetroBadge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (simulation: Simulation) => (
        <span className={`inline-flex px-2 py-1 text-xs font-semibold border-2 border-black shadow-retro-2`}>
          {simulation.status.charAt(0).toUpperCase() + simulation.status.slice(1).toLowerCase()}
        </span>
      ),
    },
    {
      key: 'personas',
      header: 'Personas',
      render: (simulation: Simulation) => (
        <div className="flex items-center space-x-2">
          <div className="text-sm">
            {simulation.personas && simulation.personas.length > 0 ? (
              <div className="flex items-center whitespace-nowrap">
                <UserGroupIcon className="h-4 w-4 mr-1 text-neutral-700" />
                <span className="text-sm">
                  {simulation.personas.length} persona{simulation.personas.length !== 1 ? 's' : ''}
                </span>
              </div>
            ) : (
              <span className="text-sm text-neutral-700">No personas</span>
            )}
          </div>
          <button
            onClick={() => onEditPersonas(simulation)}
            className="retro-btn-base bg-white px-2 py-1"
            title="Edit Personas"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
        </div>
      ),
    },
    {
      key: 'stats',
      header: 'Stats',
      render: (simulation: Simulation) => (
        <div className="text-sm text-neutral-700 whitespace-nowrap">
          <div className="flex items-center">
            <EyeIcon className="h-4 w-4 mr-1" />
            {simulation.viewCount} views
          </div>
          <div className="text-xs text-neutral-500 whitespace-nowrap">
            ✅ {simulation.completionCount} completions
          </div>
          {Array.isArray(simulation.conversationGoals) && simulation.conversationGoals.length > 0 && (
            <div className="text-xs text-neutral-500 whitespace-nowrap">
              🎯 {simulation.conversationGoals.length} goal{simulation.conversationGoals.length !== 1 ? 's' : ''}
            </div>
          )}
          {simulation.averageRating > 0 && (
            <div className="text-xs text-neutral-500 whitespace-nowrap">
              ⭐ {simulation.averageRating.toFixed(1)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      render: (simulation: Simulation) => (
        <span className="text-sm text-neutral-700">{new Date(simulation.createdAt).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (simulation: Simulation) => (
        <div className="flex justify-end space-x-2">
          <button
            onClick={() => onEdit(simulation)}
            className="retro-btn-base bg-white px-2 py-1 text-sm"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(simulation)}
            className="retro-btn-base bg-white px-2 py-1 text-sm"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <RetroTable<Simulation>
      columns={columns}
      data={simulations}
      keyExtractor={(row) => row.id}
      tableClassName="min-w-[1200px]"
    />
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
      .sort((a, b) => a.goalNumber - b.goalNumber)
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
          goalNumber: typeof (g as any).goalNumber === 'number' && (g as any).goalNumber > 0 ? (g as any).goalNumber : idx + 1,
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
    <RetroDialog open={true} onClose={onClose} title="Edit Simulation" className="!max-w-7xl w-[95vw]">
      <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <RetroInput
                label="Title *"
                required
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: (e.target as HTMLInputElement).value }))}
              />
              <RetroInput
                label="Duration (minutes) *"
                type="number"
                required
                min={1}
                value={formData.estimatedDurationMinutes}
                onChange={(e) => setFormData(prev => ({ ...prev, estimatedDurationMinutes: Number((e.target as HTMLInputElement).value) }))}
              />
              <RetroSelect
                label="Difficulty *"
                required
                value={formData.difficulty}
                onChange={(e) => setFormData(prev => ({ ...prev, difficulty: Number((e.target as HTMLSelectElement).value) as SimulationDifficulty }))}
              >
                <option value={SimulationDifficulty.BEGINNER}>1 - Beginner</option>
                <option value={SimulationDifficulty.INTERMEDIATE}>2 - Intermediate</option>
                <option value={SimulationDifficulty.ADVANCED}>3 - Advanced</option>
                <option value={SimulationDifficulty.EXPERT}>4 - Expert</option>
                <option value={SimulationDifficulty.MASTER}>5 - Master</option>
              </RetroSelect>
              <RetroSelect
                label="Status *"
                required
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: (e.target as HTMLSelectElement).value as SimulationStatus }))}
              >
                <option value={SimulationStatus.DRAFT}>Draft</option>
                <option value={SimulationStatus.PUBLISHED}>Published</option>
                <option value={SimulationStatus.ARCHIVED}>Archived</option>
              </RetroSelect>
              <RetroInput
                label="Tags (comma separated)"
                value={formData.tags}
                onChange={(e) => setFormData(prev => ({ ...prev, tags: (e.target as HTMLInputElement).value }))}
                placeholder="tag1, tag2, tag3"
                containerClassName="md:col-span-2"
              />
            </div>

            {/* Text Areas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <RetroTextArea
                label="Description *"
                required
                rows={4}
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: (e.target as HTMLTextAreaElement).value }))}
              />
              <RetroTextArea
                label="Scenario *"
                required
                rows={4}
                value={formData.scenario}
                onChange={(e) => setFormData(prev => ({ ...prev, scenario: (e.target as HTMLTextAreaElement).value }))}
              />
              <RetroTextArea
                label="Objectives (one per line)"
                rows={4}
                value={formData.objectives}
                onChange={(e) => setFormData(prev => ({ ...prev, objectives: (e.target as HTMLTextAreaElement).value }))}
                placeholder="Enter each objective on a new line"
                containerClassName="md:col-span-2"
              />
            </div>

            {/* Conversation Goals */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-md font-medium text-secondary-900">Conversation Goals</h3>
                <Button
                  type="button"
                  onClick={() => {
                    setGoals((prev) => {
                      const nextStep = (prev[prev.length - 1]?.goalNumber || 0) + 1;
                      return [
                        ...prev,
                        {
                          goalNumber: nextStep,
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
                          <span className="text-sm font-medium text-secondary-700">Goal {goal.goalNumber}</span>
                          <RetroCheckbox
                            label="Optional"
                            checked={!!goal.isOptional}
                            onChange={(e) => {
                              const checked = (e.target as HTMLInputElement).checked;
                              setGoals(prev => prev.map((g, i) => i === index ? { ...g, isOptional: checked } : g));
                            }}
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (index === 0) return;
                              setGoals(prev => {
                                const copy = prev.slice();
                                const tmp = copy[index - 1];
                                copy[index - 1] = copy[index];
                                copy[index] = tmp;
                                return copy.map((g, idx) => ({ ...g, goalNumber: idx + 1 }));
                              });
                            }}
                            disabled={index === 0}
                          >
                            Move Up
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (index === goals.length - 1) return;
                              setGoals(prev => {
                                const copy = prev.slice();
                                const tmp = copy[index + 1];
                                copy[index + 1] = copy[index];
                                copy[index] = tmp;
                                return copy.map((g, idx) => ({ ...g, goalNumber: idx + 1 }));
                              });
                            }}
                            disabled={index === goals.length - 1}
                          >
                            Move Down
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setGoals(prev => prev.filter((_, i) => i !== index).map((g, idx) => ({ ...g, goalNumber: idx + 1 })));
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <RetroInput
                            label="Title"
                            value={goal.title || ''}
                            onChange={(e) => setGoals(prev => prev.map((g, i) => i === index ? { ...g, title: (e.target as HTMLInputElement).value } : g))}
                          />
                        </div>
                        <div>
                          <RetroInput
                            label="Description"
                            value={goal.description || ''}
                            onChange={(e) => setGoals(prev => prev.map((g, i) => i === index ? { ...g, description: (e.target as HTMLInputElement).value } : g))}
                          />
                        </div>
                        <div>
                          <RetroTextArea
                            label="Key Behaviors (one per line)"
                            rows={3}
                            value={(goal.keyBehaviors || []).join('\n')}
                            onChange={(e) => {
                              const list = (e.target as HTMLTextAreaElement).value.split('\n').map(s => s.trim()).filter(Boolean);
                              setGoals(prev => prev.map((g, i) => i === index ? { ...g, keyBehaviors: list } : g));
                            }}
                          />
                        </div>
                        <div>
                          <RetroTextArea
                            label="Success Indicators (one per line)"
                            rows={3}
                            value={(goal.successIndicators || []).join('\n')}
                            onChange={(e) => {
                              const list = (e.target as HTMLTextAreaElement).value.split('\n').map(s => s.trim()).filter(Boolean);
                              setGoals(prev => prev.map((g, i) => i === index ? { ...g, successIndicators: list } : g));
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status */}
            <RetroCheckbox
              label="Public Simulation"
              checked={formData.isPublic}
              onChange={(e) => setFormData(prev => ({ ...prev, isPublic: (e.target as HTMLInputElement).checked }))}
            />

            {/* Form Actions */}
            <div className="flex justify-end space-x-3 pt-6 border-t-2 border-black">
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
    </RetroDialog>
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
    <RetroDialog
      open={true}
      onClose={onClose}
      title={`Manage Personas for "${simulation.title}"`}
      className="!max-w-7xl w-[95vw]"
    >
      <div className="space-y-6">
        <div>
          <h3 className="text-md font-medium text-secondary-900 mb-4">
            Select Personas <span className="font-monoRetro text-sm">({selectedPersonaIds.length} selected)</span>
          </h3>
          {availablePersonas.length === 0 ? (
            <div className="text-center py-8">
              <UserGroupIcon className="mx-auto h-12 w-12 text-neutral-400" />
              <h3 className="mt-2 text-sm font-medium">No personas available</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Create personas first to attach them to simulations.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availablePersonas.map((persona) => {
                const isSelected = selectedPersonaIds.includes(persona.id);
                return (
                  <div
                    key={persona.id}
                    className={`p-4 border-2 border-black shadow-retro-2 cursor-pointer transition-colors ${
                      isSelected ? 'bg-yellow-100' : 'bg-white hover:bg-neutral-50'
                    }`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('input[type="checkbox"]')) return;
                      handlePersonaToggle(persona.id);
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
                        className="mt-1 mr-3 h-4 w-4"
                      />
                      <div className="flex-1">
                        <div className="flex items-center">
                          <h4 className="text-sm font-semibold text-secondary-900">
                            {persona.name}
                          </h4>
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs border-2 border-black bg-white shadow-retro-2">
                            {persona.difficultyText}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-700 mt-1">{persona.role}</p>
                        <p className="text-xs text-neutral-600 mt-1 line-clamp-2">
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
        <div className="flex justify-end space-x-3 pt-6 border-t-2 border-black">
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
    </RetroDialog>
  );
};

interface CreateSimulationModalProps {
  onClose: () => void;
  onCreated: (simulation: Simulation) => void;
}

const CreateSimulationModal: React.FC<CreateSimulationModalProps> = ({ onClose, onCreated }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    scenario: '',
    difficulty: SimulationDifficulty.BEGINNER as SimulationDifficulty,
    status: SimulationStatus.DRAFT as SimulationStatus,
    estimatedDurationMinutes: 30,
    isPublic: true,
    objectives: '',
    tags: '',
    categoryId: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const cats = await apiClient.getCategories();
        setCategories(cats);
        if (cats.length > 0) {
          setFormData(prev => ({ ...prev, categoryId: cats[0].id }));
        }
      } catch (e) {
        toast.error('Failed to load categories');
      }
    };
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const payload = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        scenario: formData.scenario.trim(),
        objectives: formData.objectives
          ? formData.objectives.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        difficulty: Number(formData.difficulty),
        estimatedDurationMinutes: Number(formData.estimatedDurationMinutes),
        status: formData.status,
        isPublic: !!formData.isPublic,
        tags: formData.tags
          ? formData.tags.split(',').map(t => t.trim()).filter(Boolean)
          : [],
        categoryId: formData.categoryId,
      };
      const created = await apiClient.createSimulation(payload as any);
      toast.success('Simulation created');
      onCreated(created);
    } catch (error: any) {
      console.error('Failed to create simulation:', error);
      const message = error.response?.data?.error || 'Failed to create simulation';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <RetroDialog open={true} onClose={onClose} title="Create Simulation" className="!max-w-7xl w-[95vw]">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <RetroInput
            label="Title *"
            required
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: (e.target as HTMLInputElement).value }))}
          />
          <RetroInput
            label="Duration (minutes) *"
            type="number"
            required
            min={1}
            value={formData.estimatedDurationMinutes}
            onChange={(e) => setFormData(prev => ({ ...prev, estimatedDurationMinutes: Number((e.target as HTMLInputElement).value) }))}
          />
          <RetroSelect
            label="Difficulty *"
            required
            value={formData.difficulty}
            onChange={(e) => setFormData(prev => ({ ...prev, difficulty: Number((e.target as HTMLSelectElement).value) as SimulationDifficulty }))}
          >
            <option value={SimulationDifficulty.BEGINNER}>1 - Beginner</option>
            <option value={SimulationDifficulty.INTERMEDIATE}>2 - Intermediate</option>
            <option value={SimulationDifficulty.ADVANCED}>3 - Advanced</option>
            <option value={SimulationDifficulty.EXPERT}>4 - Expert</option>
            <option value={SimulationDifficulty.MASTER}>5 - Master</option>
          </RetroSelect>
          <RetroSelect
            label="Status *"
            required
            value={formData.status}
            onChange={(e) => setFormData(prev => ({ ...prev, status: (e.target as HTMLSelectElement).value as SimulationStatus }))}
          >
            <option value={SimulationStatus.DRAFT}>Draft</option>
            <option value={SimulationStatus.PUBLISHED}>Published</option>
            <option value={SimulationStatus.ARCHIVED}>Archived</option>
          </RetroSelect>
          <RetroSelect
            label="Category *"
            required
            value={formData.categoryId}
            onChange={(e) => setFormData(prev => ({ ...prev, categoryId: (e.target as HTMLSelectElement).value }))}
            containerClassName="md:col-span-2"
          >
            <option value="" disabled>Select category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </RetroSelect>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <RetroTextArea
            label="Description *"
            required
            rows={4}
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: (e.target as HTMLTextAreaElement).value }))}
          />
          <RetroTextArea
            label="Scenario *"
            required
            rows={4}
            value={formData.scenario}
            onChange={(e) => setFormData(prev => ({ ...prev, scenario: (e.target as HTMLTextAreaElement).value }))}
          />
          <RetroTextArea
            label="Objectives (one per line)"
            rows={4}
            value={formData.objectives}
            onChange={(e) => setFormData(prev => ({ ...prev, objectives: (e.target as HTMLTextAreaElement).value }))}
            placeholder="Enter each objective on a new line"
            containerClassName="md:col-span-2"
          />
        </div>

        <RetroCheckbox
          label="Public Simulation"
          checked={formData.isPublic}
          onChange={(e) => setFormData(prev => ({ ...prev, isPublic: (e.target as HTMLInputElement).checked }))}
        />

        <div className="flex justify-end space-x-3 pt-6 border-t-2 border-black">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading || !formData.categoryId}>
            {loading ? 'Creating...' : 'Create Simulation'}
          </Button>
        </div>
      </form>
    </RetroDialog>
  );
};

export const AdminSimulations: React.FC = () => {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSimulation, setEditingSimulation] = useState<Simulation | null>(null);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersonaSimulation, setEditingPersonaSimulation] = useState<Simulation | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
          <h1 className="text-2xl font-retro tracking-wider2">SIMULATION MANAGEMENT</h1>
          <p className="mt-1 text-sm font-monoRetro">
            Manage simulations, content, and publishing status
          </p>
        </div>
        <button className="retro-btn-base bg-white px-4 py-2 gap-2" onClick={() => setShowCreateModal(true)}>
          <PlusIcon className="h-4 w-4" />
          Create Simulation
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="retro-card overflow-hidden">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BeakerIcon className="h-6 w-6 text-black" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-semibold truncate">
                    Total Simulations
                  </dt>
                  <dd className="text-2xl font-semibold">
                    <ValueText value={pagination.count} />
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="retro-card overflow-hidden">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TagIcon className="h-6 w-6" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-semibold truncate">
                    Published
                  </dt>
                  <dd className="text-2xl font-semibold">
                    <ValueText value={simulations.filter(s => s.status === SimulationStatus.PUBLISHED).length} />
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="retro-card overflow-hidden">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <EyeIcon className="h-6 w-6" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-semibold truncate">
                    Total Views
                  </dt>
                  <dd className="text-2xl font-semibold">
                    <ValueText value={simulations.reduce((sum, s) => sum + s.viewCount, 0).toLocaleString()} />
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="retro-card overflow-hidden">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TagIcon className="h-6 w-6" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-semibold truncate">
                    Completions
                  </dt>
                  <dd className="text-2xl font-semibold">
                    <ValueText value={simulations.reduce((sum, s) => sum + s.completionCount, 0).toLocaleString()} />
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="retro-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="retro-input"
          >
            <option value="">All Statuses</option>
            <option value={SimulationStatus.DRAFT}>Draft</option>
            <option value={SimulationStatus.PUBLISHED}>Published</option>
            <option value={SimulationStatus.ARCHIVED}>Archived</option>
          </select>
          <select
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="retro-input"
          >
            <option value="">All Categories</option>
            {/* Categories would be loaded from API */}
          </select>
          <div className="flex items-center text-sm">
            <FunnelIcon className="h-4 w-4 mr-2 text-black" />
            {pagination.count} total simulations
          </div>
        </div>
      </div>

      {/* Simulations Table */}
      <div className="retro-card overflow-hidden">
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
            <BeakerIcon className="mx-auto h-12 w-12 text-black" />
            <h3 className="mt-2 text-sm font-medium">No simulations</h3>
            <p className="mt-1 text-sm">
              Get started by creating a new simulation.
            </p>
            <div className="mt-6">
              <button className="retro-btn-base bg-white px-4 py-2 inline-flex items-center text-sm" onClick={() => setShowCreateModal(true)}>
                <BeakerIcon className="-ml-1 mr-2 h-5 w-5 text-black" />
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
            Showing <ValueText value={((pagination.current - 1) * pagination.limit) + 1} /> to{' '}
            <ValueText value={Math.min(pagination.current * pagination.limit, pagination.count)} /> of{' '}
            <ValueText value={pagination.count} /> results
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
      {/* Create Simulation Modal */}
      {showCreateModal && (
        <CreateSimulationModal
          onClose={() => setShowCreateModal(false)}
          onCreated={async () => {
            // Refresh list
            try {
              const params = {
                ...filters,
                status: filters.status || undefined,
                category: filters.category || undefined,
              } as any;
              const response = await apiClient.getAdminSimulations(params);
              setSimulations(response.simulations);
              setPagination(response.pagination);
            } finally {
              setShowCreateModal(false);
            }
          }}
        />
      )}
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