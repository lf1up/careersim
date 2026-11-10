import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { account, refresh, portal, supporter, change, catalogFetch } = vi.hoisted(() => ({ account: vi.fn(), refresh: vi.fn(), portal: vi.fn(), supporter: vi.fn(), change: vi.fn(), catalogFetch: vi.fn() }));
vi.mock('@/lib/billing', async (original) => ({ ...await original<typeof import('@/lib/billing')>(), getBillingAccount: account, refreshBillingAccount: refresh, createBillingPortal: portal, getSupporterAccess: supporter, scheduleBillingChange: change, fetchPlanCatalog: catalogFetch }));
import { ApiError } from '@/lib/api';
import { catalog, freeAccount, paidLimits } from './fixtures';
import { BillingPanel } from './BillingPanel';
const plus = { ...freeAccount, tier: 'plus' as const, limits: paidLimits, reason: 'paid' as const, status: 'active', interval: 'year' as const, paidThrough: '2027-11-10T00:00:00.000Z', accessThrough: '2027-11-10T00:00:00.000Z', renews: true, usage: { ...freeAccount.usage, sessions: { used: 23, limit: 100, resetAt: '2026-11-10T18:00:00.000Z' } } };
beforeEach(() => { vi.clearAllMocks(); account.mockResolvedValue(freeAccount); refresh.mockResolvedValue(freeAccount); catalogFetch.mockResolvedValue(catalog); });
afterEach(() => vi.useRealTimers());
it('keeps checkout pending until authoritative activation without re-login', async () => {
  const pending = { ...freeAccount, pendingCheckout: true, confirmationPending: true };
  account.mockResolvedValueOnce(pending).mockResolvedValue(plus);
  refresh.mockResolvedValue(plus);
  render(<BillingPanel />);
  await screen.findByText(/Pending payment confirmation/);
  expect(screen.queryByText('Subscription active')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  await screen.findByText('Subscription active');
  expect(screen.getByText('23 / 100')).toBeVisible();
  expect(account).toHaveBeenCalledTimes(2);
});
it('shows annual paid-through, cancellation and scheduled changes separately', async () => {
  account.mockResolvedValue({ ...plus, cancelAtPeriodEnd: true, renews: false, pendingChange: { choice: { tier: 'plus', interval: 'month' }, effectiveAt: '2027-11-10T00:00:00.000Z' } });
  render(<BillingPanel />);
  await screen.findByText(/Renewal canceled/);
  expect(screen.getByText(/Paid access through Nov 10, 2027/)).toBeVisible();
  expect(screen.getByText(/Scheduled: Plus, monthly/)).toHaveTextContent('Nov 10, 2027');
  expect(screen.getByText(/Current billing: Yearly/)).toBeVisible();
});
it.each([
  ['grace', 'Payment failed. Grace access'],
  ['revoked', 'Paid access revoked'],
  ['disputed', 'Paid access suspended'],
  ['expired', 'Paid access ended'],
] as const)('shows the verified %s state', async (reason, copy) => {
  account.mockResolvedValue({ ...plus, tier: reason === 'grace' ? 'plus' : 'free', reason, status: reason });
  render(<BillingPanel />);
  await screen.findByText(new RegExp(copy));
  expect(screen.queryByText('Subscription active')).toBeNull();
});
it('shows portal errors and a sign-in route after lost authentication', async () => {
  account.mockResolvedValue(plus);
  portal.mockRejectedValue(new Error('Payment management is unavailable.'));
  render(<BillingPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage payments and cancellation' }));
  await screen.findByText('Payment management is unavailable.');
  refresh.mockRejectedValue(new ApiError(401, 'Sign in required'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  expect(await screen.findByRole('link', { name: 'Sign in to view billing' })).toHaveAttribute('href', '/login?next=%2Fprofile%23billing');
});
it('loads the private channel only for verified Supporter access', async () => {
  account.mockResolvedValue({ ...plus, tier: 'supporter', supporterAccess: true });
  supporter.mockResolvedValue({ channelUrl: 'https://community.example/private', instructions: 'Use your CareerSim email for membership verification.' });
  render(<BillingPanel />);
  await screen.findByRole('link', { name: 'Open Supporter channel' });
  expect(screen.getByText('Use your CareerSim email for membership verification.')).toBeVisible();
  for (const benefit of catalog.plans[2].benefits.slice(3)) expect(screen.getByText(benefit)).toBeVisible();
});
it('never exposes a Supporter channel to Plus', async () => {
  account.mockResolvedValue(plus);
  render(<BillingPanel />);
  await screen.findByText('Subscription active');
  expect(supporter).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Open Supporter channel' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Need higher limits? Contact us to discuss your needs.' })).toHaveAttribute('href', '/contact?reason=higher-limits');
});
it('bounds automatic pending refreshes and leaves an honest pending state', async () => {
  vi.useFakeTimers();
  const pending = { ...freeAccount, pendingCheckout: true, confirmationPending: true };
  account.mockResolvedValue(pending);
  refresh.mockResolvedValue(pending);
  render(<BillingPanel />);
  await act(async () => {});
  for (let n = 0; n < 8; n++) await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(refresh.mock.calls.length).toBeLessThanOrEqual(5);
  expect(screen.getByText(/Pending payment confirmation/)).toBeVisible();
  expect(screen.queryByText('Subscription active')).toBeNull();
});
it('discloses the next charge before scheduling a supported interval change', async () => {
  account.mockResolvedValue({ ...plus, planChangesAvailable: true });
  change.mockResolvedValue({ choice: { tier: 'plus', interval: 'month' }, effectiveAt: plus.paidThrough });
  render(<BillingPanel />);
  fireEvent.change(await screen.findByLabelText('Next billing interval'), { target: { value: 'month' } });
  const confirm = await screen.findByRole('button', { name: 'Schedule Plus monthly for $9' });
  expect(screen.getByText(/Changes take effect on Nov 10, 2027/)).toBeVisible();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(change).toHaveBeenCalledWith({ tier: 'plus', interval: 'month' }));
});

it('shows the verified grace deadline separately from the paid period', async () => {
  account.mockResolvedValue({ ...plus, reason: 'grace', paidThrough: '2026-11-07T00:00:00.000Z', accessThrough: '2026-11-10T00:00:00.000Z' });
  render(<BillingPanel />);
  await screen.findByText(/Grace access through Nov 10, 2026 UTC/);
  expect(screen.queryByText(/Paid access through Nov 7/)).toBeNull();
});
it('does not claim future access when a paid period was revoked', async () => {
  account.mockResolvedValue({ ...plus, tier: 'free', reason: 'revoked', accessThrough: null });
  render(<BillingPanel />);
  await screen.findByText(/Paid access revoked/);
  expect(screen.queryByText(/Paid access through/)).toBeNull();
});
