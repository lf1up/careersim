import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import { RetroTable, RetroPagination } from '../../components/ui/RetroTable.tsx';
import { RetroBadge } from '../../components/ui/RetroBadge.tsx';
import { RetroDialog } from '../../components/ui/RetroDialog.tsx';
import { RetroInput, RetroSelect, RetroTextArea, RetroCheckbox } from '../../components/ui/RetroInput.tsx';
import { FunnelIcon, PencilIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../utils/api.ts';
import { Persona, PersonaCategory } from '../../types/index.ts';

interface PersonaFormData {
  name: string;
  slug: string;
  role: string;
  personality: string;
  primaryGoal: string;
  hiddenMotivation: string;
  category: PersonaCategory;
  difficultyLevel: number;
  avatarUrl?: string;
  backgroundStory?: string;
  conversationStyle?: {
    tone?: string;
    formality?: string;
    pace?: string;
    emotionalRange?: string[];
    commonPhrases?: string[];
    initiativeProbability?: number;
    startsConversation?: boolean | 'sometimes';
    inactivityNudgeDelaySec?: { min?: number; max?: number };
    inactivityNudgeMaxCount?: number;
    burstiness?: { min?: number; max?: number };
    typingSpeedWpm?: number;
    backchannelProbability?: number;
    openingStyle?: string;
    nudgeStyle?: string;
  };
  triggerWords?: string[];
  responsePatterns?: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };
  isActive: boolean;
}

const initialFormData: PersonaFormData = {
  name: '',
  slug: '',
  role: '',
  personality: '',
  primaryGoal: '',
  hiddenMotivation: '',
  category: PersonaCategory.JOB_SEEKING,
  difficultyLevel: 1,
  avatarUrl: '',
  backgroundStory: '',
  conversationStyle: {
    tone: '',
    formality: '',
    pace: '',
    emotionalRange: [],
    commonPhrases: [],
    initiativeProbability: undefined,
    startsConversation: undefined,
    inactivityNudgeDelaySec: undefined,
    inactivityNudgeMaxCount: undefined,
    burstiness: undefined,
    typingSpeedWpm: undefined,
    backchannelProbability: undefined,
    openingStyle: '',
    nudgeStyle: '',
  },
  triggerWords: [],
  responsePatterns: {
    positive: [],
    negative: [],
    neutral: [],
  },
  isActive: true,
};

export const AdminPersonas: React.FC = () => {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [formData, setFormData] = useState<PersonaFormData>(initialFormData);
  const [filters, setFilters] = useState({
    category: '',
    active: '',
    page: 1,
    limit: 20,
  });
  const [pagination, setPagination] = useState({
    current: 1,
    total: 1,
    count: 0,
    limit: 20,
  });

  // Load personas
  const loadPersonas = useCallback(async () => {
    try {
      setLoading(true);
      const { personas, pagination } = await apiClient.getAdminPersonas({
        page: filters.page,
        limit: filters.limit,
        ...(filters.category && { category: filters.category }),
        ...(filters.active !== '' && { active: filters.active === 'true' }),
      });
      setPersonas(personas);
      setPagination(pagination);
    } catch (error) {
      console.error('Failed to load personas:', error);
      toast.error('Failed to load personas');
    } finally {
      setLoading(false);
    }
  }, [filters.page, filters.limit, filters.category, filters.active]);

  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  // Handle filter changes
  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1, // Reset to first page when filtering
    }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingPersona) {
        await apiClient.updatePersona(editingPersona.id, formData as Partial<Persona>);
        toast.success('Persona updated successfully');
      } else {
        await apiClient.createPersona(formData as Partial<Persona>);
        toast.success('Persona created successfully');
      }
      
      setShowModal(false);
      setEditingPersona(null);
      setFormData(initialFormData);
      loadPersonas();
    } catch (error: any) {
      console.error('Failed to save persona:', error);
      const message = error.response?.data?.error || 'Failed to save persona';
      toast.error(message);
    }
  };

  // Handle edit
  const handleEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setFormData({
      name: persona.name,
      slug: persona.slug,
      role: persona.role,
      personality: persona.personality,
      primaryGoal: persona.primaryGoal,
      hiddenMotivation: persona.hiddenMotivation,
      category: persona.category,
      difficultyLevel: persona.difficultyLevel,
      avatarUrl: persona.avatarUrl || '',
      backgroundStory: persona.backgroundStory || '',
      conversationStyle: (persona.conversationStyle as any) || {
        tone: '',
        formality: '',
        pace: '',
        emotionalRange: [],
        commonPhrases: [],
        initiativeProbability: undefined,
        startsConversation: undefined,
        inactivityNudgeDelaySec: undefined,
        inactivityNudgeMaxCount: undefined,
        burstiness: undefined,
        typingSpeedWpm: undefined,
        backchannelProbability: undefined,
        openingStyle: '',
        nudgeStyle: '',
      },
      triggerWords: persona.triggerWords || [],
      responsePatterns: (persona.responsePatterns as any) || {
        positive: [],
        negative: [],
        neutral: [],
      },
      isActive: persona.isActive,
    });
    setShowModal(true);
  };

  // Handle delete
  const handleDelete = async (persona: Persona) => {
    if (!window.confirm(`Are you sure you want to delete "${persona.name}"?`)) {
      return;
    }

    try {
      await apiClient.deletePersona(persona.id);
      toast.success('Persona deleted successfully');
      loadPersonas();
    } catch (error: any) {
      console.error('Failed to delete persona:', error);
      const message = error.response?.data?.error || 'Failed to delete persona';
      toast.error(message);
    }
  };

  // Handle create new
  const handleCreateNew = () => {
    setEditingPersona(null);
    setFormData(initialFormData);
    setShowModal(true);
  };

  // Generate slug from name
  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  const toCsv = (arr?: string[]) => (arr && arr.length ? arr.join(', ') : '');
  const fromCsv = (text: string): string[] =>
    text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const getCategoryBadgeColor = (category: PersonaCategory) => {
    switch (category) {
      case PersonaCategory.JOB_SEEKING:
        return 'blue';
      case PersonaCategory.WORKPLACE_COMMUNICATION:
        return 'green';
      case PersonaCategory.LEADERSHIP:
        return 'purple';
      default:
        return 'default';
    }
  };

  const getDifficultyColor = (level: number) => {
    if (level <= 2) return 'green';
    if (level <= 3) return 'amber';
    return 'red';
  };

  const getDifficultyText = (level: number) => {
    const levels = ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master'];
    return levels[level] || 'Unknown';
  };

  const formatCategoryText = (category: PersonaCategory) => {
    return category
      .replace('_', ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const columns = [
    {
      key: 'persona',
      header: 'Persona',
      render: (persona: Persona) => (
        <div className="flex items-center">
          {persona.avatarUrl ? (
            <img className="h-10 w-10 mr-3 border-2 border-black shadow-[2px_2px_0_#111827] object-cover" src={persona.avatarUrl} alt={persona.name} />
          ) : (
            <div className="h-10 w-10 mr-3 border-2 border-black flex items-center justify-center shadow-[2px_2px_0_#111827]">
              <span className="font-bold">{persona.name?.[0]}</span>
            </div>
          )}
          <div>
            <div className="text-sm font-semibold">{persona.name}</div>
            <div className="text-sm font-monoRetro">{persona.role}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (p: Persona) => (
        <RetroBadge color={getCategoryBadgeColor(p.category)}>{formatCategoryText(p.category)}</RetroBadge>
      ),
    },
    {
      key: 'difficultyLevel',
      header: 'Difficulty',
      render: (p: Persona) => (
        <RetroBadge color={getDifficultyColor(p.difficultyLevel)}>{getDifficultyText(p.difficultyLevel)}</RetroBadge>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (p: Persona) => (
        <RetroBadge color={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Active' : 'Inactive'}</RetroBadge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      className: 'text-sm font-monoRetro',
      render: (p: Persona) => new Date(p.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: <div className="text-right">Actions</div>,
      className: 'text-right',
      render: (p: Persona) => (
        <div className="flex justify-end gap-2">
          <button onClick={() => handleEdit(p)} className="retro-btn-base bg-white px-2 py-1">
            <PencilIcon className="h-4 w-4" />
          </button>
          <button onClick={() => handleDelete(p)} className="retro-btn-base bg-white px-2 py-1">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-retro tracking-wider2">PERSONA MANAGEMENT</h1>
          <p className="mt-1 text-sm font-monoRetro">Manage AI personas for simulations</p>
        </div>
        <button onClick={handleCreateNew} className="retro-btn-base bg-white px-3 py-2 inline-flex items-center gap-2">
          <PlusIcon className="h-4 w-4" />
          Create Persona
        </button>
      </div>

      <div className="retro-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <RetroSelect
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            aria-label="Category filter"
          >
            <option value="">All Categories</option>
            <option value={PersonaCategory.JOB_SEEKING}>Job Seeking</option>
            <option value={PersonaCategory.WORKPLACE_COMMUNICATION}>Workplace Communication</option>
            <option value={PersonaCategory.LEADERSHIP}>Leadership</option>
          </RetroSelect>
          <RetroSelect
            value={filters.active}
            onChange={(e) => handleFilterChange('active', e.target.value)}
            aria-label="Status filter"
          >
            <option value="">All Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </RetroSelect>
          <div className="flex items-center text-sm">
            <FunnelIcon className="h-4 w-4 mr-2" />
            {pagination.count} total personas
          </div>
        </div>
      </div>

      <div className="retro-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : personas.length > 0 ? (
          <RetroTable
            columns={columns as any}
            data={personas}
            keyExtractor={(p: Persona) => p.id}
          />
        ) : (
          <div className="text-center py-12">
            <p>No personas found</p>
          </div>
        )}
      </div>

      {pagination.total > 1 && (
        <RetroPagination
          page={pagination.current}
          pageCount={pagination.total}
          onPageChange={handlePageChange}
        />
      )}

      <RetroDialog
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingPersona ? 'Edit Persona' : 'Create Persona'}
        className="max-w-5xl"
        bodyClassName="max-h-[75vh]"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RetroInput
              label="Name"
              required
              value={formData.name}
              onChange={(e) => {
                const name = e.target.value;
                setFormData(prev => ({ ...prev, name, slug: !editingPersona ? generateSlug(name) : prev.slug }));
              }}
            />
            <RetroInput
              label="Slug"
              required
              value={formData.slug}
              onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
            />
            <RetroInput
              label="Role"
              required
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
            />
            <RetroSelect
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as PersonaCategory }))}
              required
              aria-label="Category"
              label="Category"
            >
              <option value={PersonaCategory.JOB_SEEKING}>Job Seeking</option>
              <option value={PersonaCategory.WORKPLACE_COMMUNICATION}>Workplace Communication</option>
              <option value={PersonaCategory.LEADERSHIP}>Leadership</option>
            </RetroSelect>
            <RetroSelect
              value={formData.difficultyLevel}
              onChange={(e) => setFormData(prev => ({ ...prev, difficultyLevel: parseInt(e.target.value) }))}
              required
              aria-label="Difficulty Level"
              label="Difficulty Level"
            >
              <option value={1}>1 - Beginner</option>
              <option value={2}>2 - Intermediate</option>
              <option value={3}>3 - Advanced</option>
              <option value={4}>4 - Expert</option>
              <option value={5}>5 - Master</option>
            </RetroSelect>
            <RetroInput
              label="Avatar URL"
              type="url"
              value={formData.avatarUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, avatarUrl: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RetroTextArea
              label="Personality"
              required
              rows={4}
              value={formData.personality}
              onChange={(e) => setFormData(prev => ({ ...prev, personality: e.target.value }))}
            />
            <RetroTextArea
              label="Primary Goal"
              required
              rows={4}
              value={formData.primaryGoal}
              onChange={(e) => setFormData(prev => ({ ...prev, primaryGoal: e.target.value }))}
            />
            <RetroTextArea
              label="Hidden Motivation"
              required
              rows={4}
              value={formData.hiddenMotivation}
              onChange={(e) => setFormData(prev => ({ ...prev, hiddenMotivation: e.target.value }))}
            />
            <RetroTextArea
              label="Background Story"
              rows={4}
              value={formData.backgroundStory}
              onChange={(e) => setFormData(prev => ({ ...prev, backgroundStory: e.target.value }))}
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-md font-semibold">Conversation Style</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RetroInput
                label="Tone"
                value={formData.conversationStyle?.tone || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), tone: e.target.value } }))}
              />
              <RetroInput
                label="Formality"
                value={formData.conversationStyle?.formality || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), formality: e.target.value } }))}
              />
              <RetroInput
                label="Pace"
                value={formData.conversationStyle?.pace || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), pace: e.target.value } }))}
              />
              <RetroInput
                label="Emotional Range (CSV)"
                value={toCsv(formData.conversationStyle?.emotionalRange)}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), emotionalRange: fromCsv(e.target.value) } }))}
              />
              <RetroInput
                label="Common Phrases (CSV)"
                value={toCsv(formData.conversationStyle?.commonPhrases)}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), commonPhrases: fromCsv(e.target.value) } }))}
              />
              <RetroInput
                label="Initiative Probability (0..1)"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={formData.conversationStyle?.initiativeProbability ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), initiativeProbability: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              />
              <RetroSelect
                value={
                  formData.conversationStyle?.startsConversation === undefined
                    ? ''
                    : formData.conversationStyle?.startsConversation === true
                      ? 'true'
                      : formData.conversationStyle?.startsConversation === false
                        ? 'false'
                        : 'sometimes'
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    conversationStyle: {
                      ...(prev.conversationStyle || {}),
                      startsConversation: v === '' ? undefined : v === 'true' ? true : v === 'false' ? false : 'sometimes'
                    }
                  }));
                }}
                label="Starts Conversation"
              >
                <option value="">Unspecified</option>
                <option value="true">Always</option>
                <option value="sometimes">Sometimes</option>
                <option value="false">Never</option>
              </RetroSelect>
              <RetroInput
                label="Inactivity Nudge Delay Min (sec)"
                type="number"
                min="0"
                value={formData.conversationStyle?.inactivityNudgeDelaySec?.min ?? ''}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  conversationStyle: {
                    ...(prev.conversationStyle || {}),
                    inactivityNudgeDelaySec: {
                      min: e.target.value === '' ? undefined : Number(e.target.value),
                      max: prev.conversationStyle?.inactivityNudgeDelaySec?.max,
                    }
                  }
                }))}
              />
              <RetroInput
                label="Inactivity Nudge Delay Max (sec)"
                type="number"
                min="0"
                value={formData.conversationStyle?.inactivityNudgeDelaySec?.max ?? ''}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  conversationStyle: {
                    ...(prev.conversationStyle || {}),
                    inactivityNudgeDelaySec: {
                      min: prev.conversationStyle?.inactivityNudgeDelaySec?.min,
                      max: e.target.value === '' ? undefined : Number(e.target.value),
                    }
                  }
                }))}
              />
              <RetroInput
                label="Max Inactivity Nudges"
                type="number"
                min="0"
                value={formData.conversationStyle?.inactivityNudgeMaxCount ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), inactivityNudgeMaxCount: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              />
              <RetroInput
                label="Burstiness Min (messages)"
                type="number"
                min="0"
                value={formData.conversationStyle?.burstiness?.min ?? ''}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  conversationStyle: {
                    ...(prev.conversationStyle || {}),
                    burstiness: {
                      min: e.target.value === '' ? undefined : Number(e.target.value),
                      max: prev.conversationStyle?.burstiness?.max,
                    }
                  }
                }))}
              />
              <RetroInput
                label="Burstiness Max (messages)"
                type="number"
                min="0"
                value={formData.conversationStyle?.burstiness?.max ?? ''}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  conversationStyle: {
                    ...(prev.conversationStyle || {}),
                    burstiness: {
                      min: prev.conversationStyle?.burstiness?.min,
                      max: e.target.value === '' ? undefined : Number(e.target.value),
                    }
                  }
                }))}
              />
              <RetroInput
                label="Typing Speed (WPM)"
                type="number"
                min="0"
                value={formData.conversationStyle?.typingSpeedWpm ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), typingSpeedWpm: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              />
              <RetroInput
                label="Backchannel Probability (0..1)"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={formData.conversationStyle?.backchannelProbability ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), backchannelProbability: e.target.value === '' ? undefined : Number(e.target.value) } }))}
              />
              <RetroInput
                label="Opening Style"
                value={formData.conversationStyle?.openingStyle || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), openingStyle: e.target.value } }))}
              />
              <RetroInput
                label="Nudge Style"
                value={formData.conversationStyle?.nudgeStyle || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, conversationStyle: { ...(prev.conversationStyle || {}), nudgeStyle: e.target.value } }))}
              />
            </div>
          </div>

          <div className="flex items-center">
            <RetroCheckbox
              checked={formData.isActive}
              onChange={(e) => setFormData(prev => ({ ...prev, isActive: (e.target as HTMLInputElement).checked }))}
              label="Active"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t-2 border-black">
            <button type="button" onClick={() => setShowModal(false)} className="retro-btn-base bg-white px-3 py-2">Cancel</button>
            <button type="submit" className="retro-btn-base bg-yellow-300 px-3 py-2">{editingPersona ? 'Update Persona' : 'Create Persona'}</button>
          </div>
        </form>
      </RetroDialog>
    </div>
  );
}; 