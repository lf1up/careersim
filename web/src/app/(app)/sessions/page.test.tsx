import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SessionsPage from './page';
import { apiClient } from '@/lib/api';
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({ apiClient: { listSessions: vi.fn(), listSimulations: vi.fn() } }));
afterEach(() => vi.resetAllMocks());
it('places About before Report and opens catalogue and custom details without opening the conversation', async () => {
  vi.mocked(apiClient.listSessions).mockResolvedValue([
    { id: 'catalog-session', simulation_slug: 'interview', simulation_title: 'Interview', created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z', message_count: 2, goal_progress: [] },
    { id: 'custom-session', simulation_slug: 'creator:123', simulation_title: 'Community', created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z', message_count: 2, goal_progress: [] },
  ]);
  vi.mocked(apiClient.listSimulations).mockResolvedValue([]);
  render(<SessionsPage />);
  const catalog = (await screen.findByText('Interview')).closest('[role="link"]')! as HTMLElement;
  const custom = screen.getByText('Community').closest('[role="link"]')! as HTMLElement;
  expect(within(catalog).getAllByRole('button').map((b) => b.textContent)).toEqual(['About', 'Report']);
  fireEvent.click(within(catalog).getByRole('button', { name: 'About' }));
  expect(push).toHaveBeenLastCalledWith('/simulations/interview');
  push.mockClear();
  fireEvent.keyDown(within(custom).getByRole('button', { name: 'About' }), { key: 'Enter' });
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(within(custom).getByRole('button', { name: 'About' }));
  expect(push.mock.calls).toEqual([['/simulations/creator%3A123']]);
  push.mockClear();
  fireEvent.keyDown(custom, { key: 'Enter' });
  expect(push).toHaveBeenCalledWith('/sessions/custom-session');
});
