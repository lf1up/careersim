import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DetailPage, { generateMetadata } from './page';
import { apiClient } from '@/lib/api';
import { getPublicSimulation } from '@/lib/public-api';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiClient: { getSimulation: vi.fn() } }));
vi.mock('@/lib/public-api', () => ({ getPublicSimulation: vi.fn(), listPublicSimulations: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it.each(['creator:123', 'creator%3A123'])('loads custom details through the authenticated client for %s without public metadata', async (routeParam) => {
  vi.mocked(getPublicSimulation).mockRejectedValue(new Error('Anonymous access denied'));
  vi.mocked(apiClient.getSimulation).mockResolvedValue({ slug: 'creator:123', title: 'Community onboarding', description: 'Meet the community.', scenario: 'Introduce yourself.', objectives: [], participants: [], persona_name: 'Mike', persona_slug: null, avatar_url: null, persona_role: 'Community leader', persona_category: 'OTHER', persona_difficulty_level: 2, difficulty: 2, estimated_duration_minutes: null, skills_to_learn: [], tags: [], success_criteria: { communication: [], problem_solving: [], emotional: [] }, conversation_goals: [] });
  render(await DetailPage({ params: Promise.resolve({ slug: routeParam }) }));
  expect(await screen.findByText('Community onboarding')).toBeVisible();
  expect(apiClient.getSimulation).toHaveBeenCalledWith('creator:123');
  expect(getPublicSimulation).not.toHaveBeenCalled();
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: routeParam }) });
  expect(metadata.robots).toMatchObject({ index: false, follow: false });
  expect(JSON.stringify(metadata)).not.toContain('Community onboarding');
  expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to sessions' })).toHaveAttribute('href', '/sessions');
});
it('shows unavailable custom details without revealing data or falling back to the public catalogue', async () => {
  vi.mocked(apiClient.getSimulation).mockRejectedValue(new Error('Simulation not found'));
  render(await DetailPage({ params: Promise.resolve({ slug: 'creator:unknown' }) }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Simulation not found');
  expect(getPublicSimulation).not.toHaveBeenCalled();
});
