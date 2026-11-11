import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WebPlugin } from '@/extensions';
const { auth, plugins } = vi.hoisted(() => ({ auth: { isAuthenticated: true }, plugins: [] as WebPlugin[] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@careersim/plugins', () => ({ plugins }));
vi.mock('@/components/ui/SimulationPortrait', () => ({ SimulationPortrait: () => null }));
import { SimulationsClient } from './SimulationsClient';
beforeEach(() => {
  auth.isAuthenticated = true;
  plugins.length = 0;
  plugins.push({ id: 'creator', navItems: [{ href: '/create', label: 'Create', badge: 'BETA', showToGuests: true }] });
});
it('places the installed Create action after search and preserves catalog filtering', () => {
  render(<SimulationsClient initialSimulations={[
    { slug: 'interview', title: 'Interview practice', persona_name: 'Alex', tags: ['career'] },
    { slug: 'negotiation', title: 'Salary negotiation', persona_name: 'Sam' },
  ]} />);
  const create = screen.getByRole('link', { name: /Create BETA/ });
  const search = screen.getByRole('searchbox', { name: 'Search simulations' });
  expect(create).toHaveAttribute('href', '/create');
  expect(search.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(search, { target: { value: 'career' } });
  expect(screen.getByText('Interview practice')).toBeVisible();
  expect(screen.queryByText('Salary negotiation')).not.toBeInTheDocument();
  expect(create).toBeVisible();
});
it('does not link to creation when the plugin is absent', () => {
  plugins.length = 0;
  render(<SimulationsClient initialSimulations={[]} />);
  expect(screen.queryByRole('link', { name: /Create/ })).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Search simulations' })).toBeInTheDocument();
});
it('keeps guest creation available only when the plugin opts in', () => {
  auth.isAuthenticated = false;
  render(<SimulationsClient initialSimulations={[]} />);
  expect(screen.getByRole('link', { name: /Create BETA/ })).toHaveAttribute('href', '/create');
});
