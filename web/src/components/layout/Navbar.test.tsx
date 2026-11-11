import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WebNavItem } from '@/extensions';

const { auth } = vi.hoisted(() => ({ auth: {
  isAuthenticated: true, isLoading: false, user: { email: 'test@example.com' }, logout: vi.fn(),
} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock('@/extensions', () => ({
  signedInNavItems: (base: WebNavItem[]) => [...base, { href: '/create', label: 'Create', badge: 'BETA' }],
  guestNavItems: (base: WebNavItem[]) => base,
}));
import { Navbar } from './Navbar';
import { Footer } from './Footer';

beforeEach(() => { auth.isAuthenticated = true; });

it('keeps signed-in navigation focused while pricing stays available in the footer and billing in the account', () => {
  render(<><Navbar /><Footer /></>);
  const navigation = within(screen.getByRole('navigation'));
  expect(navigation.queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();
  for (const name of ['Dashboard', 'Simulations', 'Sessions', 'Analytics', /Create/]) {
    expect(navigation.getByRole('link', { name })).toBeInTheDocument();
  }
  expect(navigation.getByRole('link', { name: 'Profile and billing' })).toHaveAttribute('href', '/profile');
  expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  fireEvent.click(navigation.getByRole('button', { name: 'Open main menu' }));
  expect(navigation.getByRole('link', { name: 'Profile & billing' })).toHaveAttribute('href', '/profile');
  expect(navigation.queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();
});

it('keeps pricing in the guest navigation', () => {
  auth.isAuthenticated = false;
  render(<Navbar />);
  expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
});
