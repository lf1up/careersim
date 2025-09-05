import React, { useState, useEffect } from 'react';
import {
  CpuChipIcon,
  CodeBracketIcon,
  AdjustmentsHorizontalIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  PencilIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { RetroInput } from '../../components/ui/RetroInput.tsx';
import { apiClient } from '../../utils/api.ts';
import toast from 'react-hot-toast';

interface AISettings {
  model: string;
  maxTokens: number;
  temperature: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topP: number;
  profiles?: {
    generation?: Partial<AISettings>;
    evaluation?: Partial<AISettings>;
  };
}

interface SystemPrompts {
  baseSystemPrompt: string;
  performanceAnalysisPrompt: string;
  styleGuidelines?: string;
}

interface SystemConfigResponse {
  configurations: any[];
  aiSettings: AISettings;
  systemPrompts: SystemPrompts;
  rateLimitSettings: {
    windowMs: number;
    maxRequests: number;
    enabled: boolean;
    configuredEnabled?: boolean;
    isDevelopmentOverride?: boolean;
  };
}

export const AdminSystem: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [tempSettings, setTempSettings] = useState<AISettings | null>(null);
  const [tempEvalProfile, setTempEvalProfile] = useState<Partial<AISettings> | null>(null);
  const [tempPrompts, setTempPrompts] = useState<SystemPrompts | null>(null);

  useEffect(() => {
    fetchSystemConfig();
  }, []);

  const fetchSystemConfig = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getSystemConfig();
      setConfig(data);
      // Prime evaluation profile editor with current values (fallback to base)
      if (data?.aiSettings) {
        const base = data.aiSettings;
        const evalProfile = data.aiSettings.profiles?.evaluation || {};
        setTempEvalProfile({
          model: evalProfile.model || base.model,
          maxTokens: typeof evalProfile.maxTokens === 'number' ? evalProfile.maxTokens : Math.min(2000, base.maxTokens),
          temperature: typeof evalProfile.temperature === 'number' ? evalProfile.temperature : 0.3,
          frequencyPenalty: typeof evalProfile.frequencyPenalty === 'number' ? evalProfile.frequencyPenalty : base.frequencyPenalty,
          presencePenalty: typeof evalProfile.presencePenalty === 'number' ? evalProfile.presencePenalty : base.presencePenalty,
          topP: typeof evalProfile.topP === 'number' ? evalProfile.topP : base.topP,
        });
      }
    } catch (error) {
      toast.error('Failed to load system configuration');
      console.error('System config error:', error);
    } finally {
      setLoading(false);
    }
  };



  const updateSystemPrompts = async (prompts: SystemPrompts) => {
    try {
      setSaving(true);
      await apiClient.updateSystemPrompts(prompts);
      toast.success('System prompts updated successfully');
      await fetchSystemConfig();
      setEditingPrompts(false);
      setTempPrompts(null);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update system prompts');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (content: string, type: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPrompt(type);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedPrompt(null), 2000);
    } catch (error) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleEditSettings = () => {
    setTempSettings(config?.aiSettings || null);
    setEditingSettings(true);
  };

  const handleCancelSettings = () => {
    setTempSettings(null);
    setEditingSettings(false);
  };

  const handleSaveSettings = () => {
    if (!tempSettings) return;
    (async () => {
      setSaving(true);
      try {
        await apiClient.updateAISettings(tempSettings);
        await apiClient.updateAIProfiles({ evaluation: tempEvalProfile || {} });
        toast.success('AI settings updated successfully');
        await fetchSystemConfig();
        setEditingSettings(false);
        setTempSettings(null);
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Failed to update evaluation settings');
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleEditPrompts = () => {
    setTempPrompts(config?.systemPrompts || null);
    setEditingPrompts(true);
  };

  const handleCancelPrompts = () => {
    setTempPrompts(null);
    setEditingPrompts(false);
  };

  const handleSavePrompts = () => {
    if (tempPrompts) {
      updateSystemPrompts(tempPrompts);
    }
  };

  const togglePromptExpansion = (type: string) => {
    setExpandedPrompts(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="text-gray-500">Failed to load system configuration</p>
          <Button onClick={fetchSystemConfig} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-retro tracking-wider2">SYSTEM CONFIGURATION</h1>
        <p className="mt-1 text-sm font-monoRetro">
          AI settings, internal prompts, and system configuration
        </p>
      </div>

      {/* AI Settings */}
      <div className="retro-card">
        <div className="px-6 py-4 border-b-2 border-black">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <CpuChipIcon className="h-6 w-6 mr-3" />
              <h2 className="text-lg font-semibold">AI Configuration</h2>
            </div>
            {!editingSettings && (
              <Button
                onClick={handleEditSettings}
                variant="outline"
                size="sm"
              >
                <PencilIcon className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </div>
        <div className="p-6">
          {editingSettings ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <RetroInput
                    label="Model"
                    value={tempSettings?.model || ''}
                    onChange={(e) => setTempSettings(prev => prev ? { ...prev, model: (e.target as HTMLInputElement).value } : null)}
                  />
                </div>
                <div>
                  <RetroInput
                    label="Max Tokens"
                    type="number"
                    min={100}
                    max={4000}
                    value={tempSettings?.maxTokens || 0}
                    onChange={(e) => setTempSettings(prev => prev ? { ...prev, maxTokens: parseInt((e.target as HTMLInputElement).value) } : null)}
                  />
                </div>
                <div>
                  <RetroInput
                    label="Temperature"
                    type="number"
                    step={0.1}
                    min={0}
                    max={2}
                    value={tempSettings?.temperature || 0}
                    onChange={(e) => setTempSettings(prev => prev ? { ...prev, temperature: parseFloat((e.target as HTMLInputElement).value) } : null)}
                  />
                </div>
                <div>
                  <RetroInput
                    label="Frequency Penalty"
                    type="number"
                    step={0.1}
                    min={-2}
                    max={2}
                    value={tempSettings?.frequencyPenalty || 0}
                    onChange={(e) => setTempSettings(prev => prev ? { ...prev, frequencyPenalty: parseFloat((e.target as HTMLInputElement).value) } : null)}
                  />
                </div>
                <div>
                  <RetroInput
                    label="Presence Penalty"
                    type="number"
                    step={0.1}
                    min={-2}
                    max={2}
                    value={tempSettings?.presencePenalty || 0}
                    onChange={(e) => setTempSettings(prev => prev ? { ...prev, presencePenalty: parseFloat((e.target as HTMLInputElement).value) } : null)}
                  />
                </div>
                <div>
                  <RetroInput
                    label="Top P"
                    type="number"
                    step={0.1}
                    min={0}
                    max={1}
                    value={tempSettings?.topP || 0}
                    onChange={(e) => setTempSettings(prev => prev ? { ...prev, topP: parseFloat((e.target as HTMLInputElement).value) } : null)}
                  />
                </div>
              </div>

              {/* Evaluation profile overrides */}
              <div className="border-t pt-6">
                <h3 className="text-md font-medium text-gray-900 mb-4">Evaluation Profile Overrides</h3>
                <p className="text-xs text-gray-500 mb-4">These settings are used by goal and performance evaluations. Leave blank to inherit from base settings.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <RetroInput
                      label="Model"
                      value={tempEvalProfile?.model || ''}
                      onChange={(e) => setTempEvalProfile(prev => ({ ...(prev || {}), model: (e.target as HTMLInputElement).value }))}
                      placeholder={config.aiSettings.model}
                    />
                  </div>
                  <div>
                    <RetroInput
                      label="Max Tokens"
                      type="number"
                      min={100}
                      max={4000}
                      value={typeof tempEvalProfile?.maxTokens === 'number' ? tempEvalProfile.maxTokens : ''}
                      onChange={(e) => setTempEvalProfile(prev => ({ ...(prev || {}), maxTokens: (e.target as HTMLInputElement).value === '' ? undefined : parseInt((e.target as HTMLInputElement).value) }))}
                      placeholder={String(Math.min(2000, config.aiSettings.maxTokens))}
                    />
                  </div>
                  <div>
                    <RetroInput
                      label="Temperature"
                      type="number"
                      step={0.1}
                      min={0}
                      max={2}
                      value={typeof tempEvalProfile?.temperature === 'number' ? tempEvalProfile.temperature : ''}
                      onChange={(e) => setTempEvalProfile(prev => ({ ...(prev || {}), temperature: (e.target as HTMLInputElement).value === '' ? undefined : parseFloat((e.target as HTMLInputElement).value) }))}
                      placeholder="0.3"
                    />
                  </div>
                  <div>
                    <RetroInput
                      label="Frequency Penalty"
                      type="number"
                      step={0.1}
                      min={-2}
                      max={2}
                      value={typeof tempEvalProfile?.frequencyPenalty === 'number' ? tempEvalProfile.frequencyPenalty : ''}
                      onChange={(e) => setTempEvalProfile(prev => ({ ...(prev || {}), frequencyPenalty: (e.target as HTMLInputElement).value === '' ? undefined : parseFloat((e.target as HTMLInputElement).value) }))}
                      placeholder={String(config.aiSettings.frequencyPenalty)}
                    />
                  </div>
                  <div>
                    <RetroInput
                      label="Presence Penalty"
                      type="number"
                      step={0.1}
                      min={-2}
                      max={2}
                      value={typeof tempEvalProfile?.presencePenalty === 'number' ? tempEvalProfile.presencePenalty : ''}
                      onChange={(e) => setTempEvalProfile(prev => ({ ...(prev || {}), presencePenalty: (e.target as HTMLInputElement).value === '' ? undefined : parseFloat((e.target as HTMLInputElement).value) }))}
                      placeholder={String(config.aiSettings.presencePenalty)}
                    />
                  </div>
                  <div>
                    <RetroInput
                      label="Top P"
                      type="number"
                      step={0.1}
                      min={0}
                      max={1}
                      value={typeof tempEvalProfile?.topP === 'number' ? tempEvalProfile.topP : ''}
                      onChange={(e) => setTempEvalProfile(prev => ({ ...(prev || {}), topP: (e.target as HTMLInputElement).value === '' ? undefined : parseFloat((e.target as HTMLInputElement).value) }))}
                      placeholder={String(config.aiSettings.topP)}
                    />
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">Clear a field to revert to base.</div>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  onClick={handleCancelSettings}
                  variant="outline"
                  disabled={saving}
                >
                  <XMarkIcon className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveSettings}
                  isLoading={saving}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              <div className="p-4 border-2 border-black shadow-retro-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <div className="text-lg font-semibold text-gray-900">
                  {config.aiSettings.model}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Current OpenAI model being used
                </p>
              </div>

              <div className="p-4 border-2 border-black shadow-retro-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Tokens
                </label>
                <div className="text-lg font-semibold text-gray-900">
                  {config.aiSettings.maxTokens.toLocaleString()}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Maximum response length
                </p>
              </div>

              <div className="p-4 border-2 border-black shadow-retro-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature
                </label>
                <div className="text-lg font-semibold text-gray-900">
                  {config.aiSettings.temperature}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Response creativity (0.0 - 2.0)
                </p>
              </div>

              <div className="p-4 border-2 border-black shadow-retro-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Frequency Penalty
                </label>
                <div className="text-lg font-semibold text-gray-900">
                  {config.aiSettings.frequencyPenalty}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Reduces repetition (-2.0 to 2.0)
                </p>
              </div>

              <div className="p-4 border-2 border-black shadow-retro-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Presence Penalty
                </label>
                <div className="text-lg font-semibold text-gray-900">
                  {config.aiSettings.presencePenalty}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Encourages new topics (-2.0 to 2.0)
                </p>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Top P
                </label>
                <div className="text-lg font-semibold text-gray-900">
                  {config.aiSettings.topP}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Nucleus sampling (0.0 - 1.0)
                </p>
              </div>

              {/* Evaluation profile summary */}
              <div className="p-4 border-2 border-black shadow-retro-2 md:col-span-2 lg:col-span-2 xl:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Evaluation Profile</label>
                <div className="text-sm text-gray-700">
                  <div><span className="text-gray-500">Model:</span> {(config.aiSettings.profiles?.evaluation?.model) || config.aiSettings.model}</div>
                  <div><span className="text-gray-500">Max Tokens:</span> {config.aiSettings.profiles?.evaluation?.maxTokens ?? Math.min(2000, config.aiSettings.maxTokens)}</div>
                  <div><span className="text-gray-500">Temperature:</span> {config.aiSettings.profiles?.evaluation?.temperature ?? 0.3}</div>
                  <div><span className="text-gray-500">Frequency Penalty:</span> {config.aiSettings.profiles?.evaluation?.frequencyPenalty ?? config.aiSettings.frequencyPenalty}</div>
                  <div><span className="text-gray-500">Presence Penalty:</span> {config.aiSettings.profiles?.evaluation?.presencePenalty ?? config.aiSettings.presencePenalty}</div>
                  <div><span className="text-gray-500">Top P:</span> {config.aiSettings.profiles?.evaluation?.topP ?? config.aiSettings.topP}</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Overrides used by evaluations; defaults shown where not set.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* System Status */}
      <div className="retro-card">
        <div className="px-6 py-4 border-b-2 border-black">
          <div className="flex items-center">
            <AdjustmentsHorizontalIcon className="h-6 w-6 mr-3" />
            <h2 className="text-lg font-semibold">System Status</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-green-400 rounded-full"></div>
              <div>
                <div className="text-sm font-medium text-gray-900">AI Service</div>
                <div className="text-xs text-gray-500">Operational</div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-green-400 rounded-full"></div>
              <div>
                <div className="text-sm font-medium text-gray-900">Database</div>
                <div className="text-xs text-gray-500">Connected</div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${config.rateLimitSettings.enabled ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
              <div>
                <div className="text-sm font-medium text-gray-900">Rate Limiting</div>
                <div className="text-xs text-gray-500">
                  {config.rateLimitSettings.enabled 
                    ? 'Enabled' 
                    : config.rateLimitSettings.isDevelopmentOverride
                      ? 'Disabled (Dev Mode)'
                      : 'Disabled'
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Prompts */}
      <div className="retro-card">
        <div className="px-6 py-4 border-b-2 border-black">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <CodeBracketIcon className="h-6 w-6 mr-3" />
              <h2 className="text-lg font-semibold">System Prompts</h2>
            </div>
            {!editingPrompts && (
              <Button
                onClick={handleEditPrompts}
                variant="outline"
                size="sm"
              >
                <PencilIcon className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {editingPrompts ? (
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base System Prompt
                </label>
                <textarea
                  value={tempPrompts?.baseSystemPrompt || ''}
                  onChange={(e) => setTempPrompts(prev => prev ? {...prev, baseSystemPrompt: e.target.value} : null)}
                  rows={15}
                  className="w-full px-3 py-2 retro-input font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Performance Analysis Prompt
                </label>
                <textarea
                  value={tempPrompts?.performanceAnalysisPrompt || ''}
                  onChange={(e) => setTempPrompts(prev => prev ? {...prev, performanceAnalysisPrompt: e.target.value} : null)}
                  rows={12}
                  className="w-full px-3 py-2 retro-input font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Style Guidelines
                </label>
                <textarea
                  value={tempPrompts?.styleGuidelines || ''}
                  onChange={(e) => setTempPrompts(prev => prev ? {...prev, styleGuidelines: e.target.value} : null)}
                  rows={10}
                  className="w-full px-3 py-2 retro-input font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">These are appended to every system prompt and also enforced at runtime.</p>
              </div>
              <div className="flex justify-end space-x-3">
                <Button
                  onClick={handleCancelPrompts}
                  variant="outline"
                  disabled={saving}
                >
                  <XMarkIcon className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleSavePrompts}
                  isLoading={saving}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Base System Prompt */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      Base System Prompt
                    </h3>
                    <p className="text-sm text-gray-500">
                      Core prompt template used for all persona interactions
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      onClick={() => togglePromptExpansion('base')}
                      variant="outline"
                      size="sm"
                    >
                      {expandedPrompts.base ? (
                        <>
                          <ChevronUpIcon className="h-4 w-4 mr-2" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <ChevronDownIcon className="h-4 w-4 mr-2" />
                          Expand
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => copyToClipboard(config.systemPrompts.baseSystemPrompt, 'Base System Prompt')}
                      variant="outline"
                      size="sm"
                    >
                      {copiedPrompt === 'Base System Prompt' ? (
                        <>
                          <CheckIcon className="h-4 w-4 mr-2" />
                          Copied
                        </>
                      ) : (
                        <>
                          <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <div className="border-2 border-black shadow-retro-2 bg-white p-4">
                    <pre className={`font-mono text-sm text-black whitespace-pre-wrap overflow-x-auto ${!expandedPrompts.base ? 'max-h-32 overflow-hidden' : ''}`}>
                      {config.systemPrompts.baseSystemPrompt}
                    </pre>
                  </div>
                  {!expandedPrompts.base && (
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent"></div>
                  )}
                </div>
              </div>

              {/* Performance Analysis Prompt */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      Performance Analysis Prompt
                    </h3>
                    <p className="text-sm text-gray-500">
                      Prompt used to generate user performance feedback
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      onClick={() => togglePromptExpansion('performance')}
                      variant="outline"
                      size="sm"
                    >
                      {expandedPrompts.performance ? (
                        <>
                          <ChevronUpIcon className="h-4 w-4 mr-2" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <ChevronDownIcon className="h-4 w-4 mr-2" />
                          Expand
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => copyToClipboard(config.systemPrompts.performanceAnalysisPrompt, 'Performance Analysis Prompt')}
                      variant="outline"
                      size="sm"
                    >
                      {copiedPrompt === 'Performance Analysis Prompt' ? (
                        <>
                          <CheckIcon className="h-4 w-4 mr-2" />
                          Copied
                        </>
                      ) : (
                        <>
                          <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <div className="border-2 border-black shadow-retro-2 bg-white p-4">
                    <pre className={`font-mono text-sm text-black whitespace-pre-wrap overflow-x-auto ${!expandedPrompts.performance ? 'max-h-32 overflow-hidden' : ''}`}>
                      {config.systemPrompts.performanceAnalysisPrompt}
                    </pre>
                  </div>
                  {!expandedPrompts.performance && (
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent"></div>
                  )}
                </div>
              </div>

              {/* Style Guidelines */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      Style Guidelines
                    </h3>
                    <p className="text-sm text-gray-500">
                      Global output rules applied to persona responses
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      onClick={() => togglePromptExpansion('style')}
                      variant="outline"
                      size="sm"
                    >
                      {expandedPrompts.style ? (
                        <>
                          <ChevronUpIcon className="h-4 w-4 mr-2" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <ChevronDownIcon className="h-4 w-4 mr-2" />
                          Expand
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => copyToClipboard(config.systemPrompts.styleGuidelines || '', 'Style Guidelines')}
                      variant="outline"
                      size="sm"
                    >
                      {copiedPrompt === 'Style Guidelines' ? (
                        <>
                          <CheckIcon className="h-4 w-4 mr-2" />
                          Copied
                        </>
                      ) : (
                        <>
                          <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <div className="border-2 border-black shadow-retro-2 bg-white p-4">
                    <pre className={`font-mono text-sm text-black whitespace-pre-wrap overflow-x-auto ${!expandedPrompts.style ? 'max-h-32 overflow-hidden' : ''}`}>
                      {config.systemPrompts.styleGuidelines || ''}
                    </pre>
                  </div>
                  {!expandedPrompts.style && (
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent"></div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Environment Variables */}
      <div className="retro-card">
        <div className="px-6 py-4 border-b-2 border-black">
          <div className="flex items-center">
            <AdjustmentsHorizontalIcon className="h-6 w-6 text-black mr-3" />
            <h2 className="text-lg font-medium text-gray-900">Environment Configuration</h2>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Development Settings</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Environment:</span>
                  <span className="font-medium">Development</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">API Documentation:</span>
                  <span className="font-medium text-green-600">Enabled</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Rate Limiting:</span>
                  <span className={`font-medium ${config.rateLimitSettings.enabled ? 'text-green-600' : 'text-yellow-600'}`}>
                    {config.rateLimitSettings.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Debug Logging:</span>
                  <span className="font-medium text-green-600">Enabled</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Performance Limits</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Rate Limit Window:</span>
                  <span className="font-medium">{Math.round(config.rateLimitSettings.windowMs / 60000)} minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Requests:</span>
                  <span className="font-medium">{config.rateLimitSettings.maxRequests} per window</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Max File Size:</span>
                  <span className="font-medium">10 MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Session Timeout:</span>
                  <span className="font-medium">7 days</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 