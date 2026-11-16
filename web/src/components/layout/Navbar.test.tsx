import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { auth } = vi.hoisted(() => ({ auth: {
  isAuthenticated: true, isLoading: false, user: { email: 'test@example.com' }, logout: vi.fn(),
} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock('@careersim/plugins', () => ({ plugins: [{ id: 'creator', navItems: [{ href: '/create', label: 'Create', badge: 'BETA', showToGuests: true }] }] }));
import { Navbar } from './Navbar';
import { Footer } from './Footer';

beforeEach(() => { auth.isAuthenticated = true; vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'true'); });
afterEach(() => vi.unstubAllEnvs());

it('shows Pricing instead of Create in the signed-in header and keeps account access', () => {
  render(<><Navbar /><Footer /></>);
  const navigation = within(screen.getByRole('navigation'));
  expect(navigation.queryByRole('link', { name: /Create/ })).not.toBeInTheDocument();
  for (const name of ['Dashboard', 'Simulations', 'Sessions', 'Analytics', 'Pricing']) {
    expect(navigation.getByRole('link', { name })).toBeInTheDocument();
  }
  expect(navigation.getByRole('link', { name: 'Profile and billing' })).toHaveAttribute('href', '/profile');
  const footer = screen.getByRole('contentinfo');
  expect(footer).toHaveTextContent('Have questions? Contact us or send an email to');
  expect(within(footer).getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
  fireEvent.click(navigation.getByRole('button', { name: 'Open main menu' }));
  expect(navigation.getByRole('link', { name: 'Profile & billing' })).toHaveAttribute('href', '/profile');
  expect(navigation.queryByRole('link', { name: /Create/ })).not.toBeInTheDocument();
  expect(navigation.getAllByRole('link', { name: 'Pricing' })).toHaveLength(2);
});

it('keeps pricing in the guest navigation', () => {
  auth.isAuthenticated = false;
  render(<Navbar />);
  expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  expect(screen.queryByRole('link', { name: /Create/ })).not.toBeInTheDocument();
});

it.each([true, false])('hides desktop and mobile pricing links while keeping Contact when authenticated=%s', (authenticated) => {
  auth.isAuthenticated = authenticated;
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'false');
  render(<><Navbar /><Footer /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Open main menu' }));
  expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
});
