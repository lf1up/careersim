import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '../../components/ui/Button.tsx';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
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
    tone: string;
    formality: string;
    pace: string;
    emotionalRange: string[];
    commonPhrases: string[];
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
        await apiClient.updatePersona(editingPersona.id, formData);
        toast.success('Persona updated successfully');
      } else {
        await apiClient.createPersona(formData);
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
      conversationStyle: persona.conversationStyle || {
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
      responsePatterns: persona.responsePatterns || {
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
        return 'bg-blue-100 text-blue-800';
      case PersonaCategory.WORKPLACE_COMMUNICATION:
        return 'bg-green-100 text-green-800';
      case PersonaCategory.LEADERSHIP:
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getDifficultyColor = (level: number) => {
    if (level <= 2) return 'bg-green-100 text-green-800';
    if (level <= 3) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Personas</h1>
          <p className="mt-1 text-sm text-gray-500">Manage AI personas for simulations</p>
        </div>
        <button 
          onClick={handleCreateNew}
          className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          Create Persona
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="p-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All Categories</option>
            <option value={PersonaCategory.JOB_SEEKING}>Job Seeking</option>
            <option value={PersonaCategory.WORKPLACE_COMMUNICATION}>Workplace Communication</option>
            <option value={PersonaCategory.LEADERSHIP}>Leadership</option>
          </select>
          <select
            value={filters.active}
            onChange={(e) => handleFilterChange('active', e.target.value)}
            className="p-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All Statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <div className="flex items-center text-sm text-gray-500">
            <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.707A1 1 0 013 7V4z" />
            </svg>
            {pagination.count} total personas
          </div>
        </div>
      </div>

      {/* Personas Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-secondary-200">
                <thead className="bg-secondary-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                      Persona
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                      Difficulty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-secondary-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-secondary-200">
                  {personas.map((persona) => (
                    <tr key={persona.id} className="hover:bg-secondary-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {persona.avatarUrl && (
                            <img
                              className="h-10 w-10 rounded-full mr-4"
                              src={persona.avatarUrl}
                              alt={persona.name}
                            />
                          )}
                          <div>
                            <div className="text-sm font-medium text-secondary-900">
                              {persona.name}
                            </div>
                            <div className="text-sm text-secondary-500">
                              {persona.role}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getCategoryBadgeColor(persona.category)}`}>
                          {formatCategoryText(persona.category)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getDifficultyColor(persona.difficultyLevel)}`}>
                          {getDifficultyText(persona.difficultyLevel)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          persona.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {persona.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-500">
                        {new Date(persona.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleEdit(persona)}
                          className="text-primary-600 hover:text-primary-900 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(persona)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.total > 1 && (
              <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-secondary-200">
                <div className="flex-1 flex justify-between sm:hidden">
                  <Button
                    onClick={() => setFilters(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                    disabled={pagination.current === 1}
                    variant="secondary"
                  >
                    Previous
                  </Button>
                  <Button
                    onClick={() => setFilters(prev => ({ ...prev, page: Math.min(pagination.total, prev.page + 1) }))}
                    disabled={pagination.current === pagination.total}
                    variant="secondary"
                  >
                    Next
                  </Button>
                </div>
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-secondary-700">
                      Showing{' '}
                      <span className="font-medium">
                        {(pagination.current - 1) * pagination.limit + 1}
                      </span>{' '}
                      to{' '}
                      <span className="font-medium">
                        {Math.min(pagination.current * pagination.limit, pagination.count)}
                      </span>{' '}
                      of{' '}
                      <span className="font-medium">{pagination.count}</span> results
                    </p>
                  </div>
                  <div>
                    <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                      <Button
                        onClick={() => setFilters(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                        disabled={pagination.current === 1}
                        variant="secondary"
                        className="rounded-l-md"
                      >
                        Previous
                      </Button>
                      <Button
                        onClick={() => setFilters(prev => ({ ...prev, page: Math.min(pagination.total, prev.page + 1) }))}
                        disabled={pagination.current === pagination.total}
                        variant="secondary"
                        className="rounded-r-md"
                      >
                        Next
                      </Button>
                    </nav>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-secondary-900">
                  {editingPersona ? 'Edit Persona' : 'Create Persona'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
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
                      Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        setFormData(prev => ({ 
                          ...prev, 
                          name,
                          slug: !editingPersona ? generateSlug(name) : prev.slug
                        }));
                      }}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Slug *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.slug}
                      onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Role *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.role}
                      onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Category *
                    </label>
                    <select
                      required
                      value={formData.category}
                      onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as PersonaCategory }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value={PersonaCategory.JOB_SEEKING}>Job Seeking</option>
                      <option value={PersonaCategory.WORKPLACE_COMMUNICATION}>Workplace Communication</option>
                      <option value={PersonaCategory.LEADERSHIP}>Leadership</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Difficulty Level *
                    </label>
                    <select
                      required
                      value={formData.difficultyLevel}
                      onChange={(e) => setFormData(prev => ({ ...prev, difficultyLevel: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value={1}>1 - Beginner</option>
                      <option value={2}>2 - Intermediate</option>
                      <option value={3}>3 - Advanced</option>
                      <option value={4}>4 - Expert</option>
                      <option value={5}>5 - Master</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Avatar URL
                    </label>
                    <input
                      type="url"
                      value={formData.avatarUrl}
                      onChange={(e) => setFormData(prev => ({ ...prev, avatarUrl: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>

                {/* Text Areas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Personality *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={formData.personality}
                      onChange={(e) => setFormData(prev => ({ ...prev, personality: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Primary Goal *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={formData.primaryGoal}
                      onChange={(e) => setFormData(prev => ({ ...prev, primaryGoal: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Hidden Motivation *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={formData.hiddenMotivation}
                      onChange={(e) => setFormData(prev => ({ ...prev, hiddenMotivation: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary-700 mb-2">
                      Background Story
                    </label>
                    <textarea
                      rows={4}
                      value={formData.backgroundStory}
                      onChange={(e) => setFormData(prev => ({ ...prev, backgroundStory: e.target.value }))}
                      className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>

                {/* Conversation Style */}
                <div className="space-y-4">
                  <h3 className="text-md font-semibold text-secondary-900">Conversation Style</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Tone</label>
                      <input
                        type="text"
                        value={formData.conversationStyle?.tone || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), tone: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Formality</label>
                      <input
                        type="text"
                        value={formData.conversationStyle?.formality || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), formality: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Pace</label>
                      <input
                        type="text"
                        value={formData.conversationStyle?.pace || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), pace: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Emotional Range (CSV)</label>
                      <input
                        type="text"
                        value={toCsv(formData.conversationStyle?.emotionalRange)}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), emotionalRange: fromCsv(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Common Phrases (CSV)</label>
                      <input
                        type="text"
                        value={toCsv(formData.conversationStyle?.commonPhrases)}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), commonPhrases: fromCsv(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Initiative Probability (0..1)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={formData.conversationStyle?.initiativeProbability ?? ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), initiativeProbability: e.target.value === '' ? undefined : Number(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Starts Conversation</label>
                      <select
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
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      >
                        <option value="">Unspecified</option>
                        <option value="true">Always</option>
                        <option value="sometimes">Sometimes</option>
                        <option value="false">Never</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Inactivity Nudge Delay Min (sec)</label>
                      <input
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
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Inactivity Nudge Delay Max (sec)</label>
                      <input
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
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Max Inactivity Nudges</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.conversationStyle?.inactivityNudgeMaxCount ?? ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), inactivityNudgeMaxCount: e.target.value === '' ? undefined : Number(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Burstiness Min (messages)</label>
                      <input
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
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Burstiness Max (messages)</label>
                      <input
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
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Typing Speed (WPM)</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.conversationStyle?.typingSpeedWpm ?? ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), typingSpeedWpm: e.target.value === '' ? undefined : Number(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Backchannel Probability (0..1)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={formData.conversationStyle?.backchannelProbability ?? ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), backchannelProbability: e.target.value === '' ? undefined : Number(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Opening Style</label>
                      <input
                        type="text"
                        value={formData.conversationStyle?.openingStyle || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), openingStyle: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Nudge Style</label>
                      <input
                        type="text"
                        value={formData.conversationStyle?.nudgeStyle || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          conversationStyle: { ...(prev.conversationStyle || {}), nudgeStyle: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Triggers and Responses */}
                <div className="space-y-4">
                  <h3 className="text-md font-semibold text-secondary-900">Triggers and Response Patterns</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Trigger Words (CSV)</label>
                      <input
                        type="text"
                        value={toCsv(formData.triggerWords)}
                        onChange={(e) => setFormData(prev => ({ ...prev, triggerWords: fromCsv(e.target.value) }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Positive Responses (CSV)</label>
                      <input
                        type="text"
                        value={toCsv(formData.responsePatterns?.positive)}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          responsePatterns: { ...(prev.responsePatterns || { positive: [], negative: [], neutral: [] }), positive: fromCsv(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-secondary-700 mb-2">Negative Responses (CSV)</label>
                      <input
                        type="text"
                        value={toCsv(formData.responsePatterns?.negative)}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          responsePatterns: { ...(prev.responsePatterns || { positive: [], negative: [], neutral: [] }), negative: fromCsv(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text sm font-medium text-secondary-700 mb-2">Neutral Responses (CSV)</label>
                      <input
                        type="text"
                        value={toCsv(formData.responsePatterns?.neutral)}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          responsePatterns: { ...(prev.responsePatterns || { positive: [], negative: [], neutral: [] }), neutral: fromCsv(e.target.value) }
                        }))}
                        className="w-full px-3 py-2 border border-secondary-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
                  />
                  <label htmlFor="isActive" className="ml-2 block text-sm text-secondary-900">
                    Active
                  </label>
                </div>

                {/* Form Actions */}
                <div className="flex justify-end space-x-3 pt-6 border-t border-secondary-200">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingPersona ? 'Update Persona' : 'Create Persona'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}; 