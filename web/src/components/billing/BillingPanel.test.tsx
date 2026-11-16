import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { account, refresh, portal, pro, change, catalogFetch } = vi.hoisted(() => ({ account: vi.fn(), refresh: vi.fn(), portal: vi.fn(), pro: vi.fn(), change: vi.fn(), catalogFetch: vi.fn() }));
vi.mock('@/lib/billing', async (original) => ({ ...await original<typeof import('@/lib/billing')>(), getBillingAccount: account, refreshBillingAccount: refresh, createBillingPortal: portal, getProAccess: pro, scheduleBillingChange: change, fetchPlanCatalog: catalogFetch }));
import { ApiError } from '@/lib/api';
import { catalog, freeAccount, plusLimits, proLimits } from './fixtures';
import { BillingPanel } from './BillingPanel';
const plus = { ...freeAccount, tier: 'plus' as const, limits: plusLimits, reason: 'paid' as const, status: 'active', interval: 'year' as const, paidThrough: '2027-11-10T00:00:00.000Z', accessThrough: '2027-11-10T00:00:00.000Z', renews: true, usage: { ...freeAccount.usage, sessions: { used: 23, limit: 100, resetAt: '2026-11-10T18:00:00.000Z' } } };
const proAccount = { ...plus, tier: 'pro' as const, limits: proLimits, proAccess: true, usage: {
  sessions: { used: 23, limit: 200, resetAt: '2026-11-10T18:00:00.000Z' },
  chatMessages: { used: 1234, limit: 6000, resetAt: '2026-11-10T18:00:00.000Z' },
  customSimulations: { used: 123, limit: 500, resetAt: null },
  customPersonas: { used: 87, limit: 500, resetAt: null },
  voice: { used: 90, limit: 720, resetAt: '2026-11-11T00:00:00.000Z' },
} };
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'true'); vi.clearAllMocks(); account.mockResolvedValue(freeAccount); refresh.mockResolvedValue(freeAccount); catalogFetch.mockResolvedValue(catalog); pro.mockReset().mockResolvedValue({ channelUrl: 'https://community.example/private', instructions: 'Use your CareerSIM email for membership verification.' }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
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
it('loads the private channel only for verified Pro access', async () => {
  account.mockResolvedValue(proAccount);
  pro.mockResolvedValue({ channelUrl: 'https://community.example/private', instructions: 'Use your CareerSIM email for membership verification.' });
  render(<BillingPanel />);
  await screen.findByRole('link', { name: 'Open Pro channel' });
  expect(screen.getByText('Use your CareerSIM email for membership verification.')).toBeVisible();
  for (const benefit of catalog.plans[2].benefits.slice(3)) expect(screen.getByText(benefit)).toBeVisible();
});
it('shows all verified Pro usage against its independent allowances', async () => {
  account.mockResolvedValue(proAccount);
  render(<BillingPanel />);
  for (const text of ['23 / 200', '1,234 / 6,000', '123 / 500', '87 / 500', '90 / 720']) expect(await screen.findByText(text)).toBeVisible();
  expect(screen.getByText(/Sessions reset per 6 hours; text messages per 6 hours/)).toBeVisible();
});
it('keeps actual Pro allowances visible when usage counters are unavailable', async () => {
  account.mockResolvedValue({ ...proAccount, usage: freeAccount.usage });
  render(<BillingPanel />);
  for (const limit of ['200', '6,000', '720']) expect(await screen.findByText(`Usage temporarily unavailable / ${limit}`)).toBeVisible();
  expect(screen.getAllByText('Usage temporarily unavailable / 500')).toHaveLength(2);
});
it('recovers the Pro channel after a temporary error and successful billing refresh', async () => {
  const verifiedPro = proAccount;
  account.mockResolvedValue(verifiedPro);
  refresh.mockResolvedValue({ ...verifiedPro });
  pro.mockRejectedValueOnce(new Error('Temporary outage')).mockResolvedValue({ channelUrl: 'https://community.example/private', instructions: 'Join with your CareerSIM email.' });
  render(<BillingPanel />);
  await screen.findByText(/Pro access could not be verified/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  expect(await screen.findByRole('link', { name: 'Open Pro channel' })).toHaveAttribute('href', 'https://community.example/private');
  expect(screen.getByText('Join with your CareerSIM email.')).toBeVisible();
  expect(screen.queryByText(/Pro access could not be verified/)).toBeNull();
});
it('returns to sign-in when refreshed Pro verification loses authentication', async () => {
  const verifiedPro = proAccount;
  account.mockResolvedValue(verifiedPro);
  refresh.mockResolvedValue({ ...verifiedPro });
  pro.mockRejectedValueOnce(new Error('Temporary outage')).mockRejectedValueOnce(new ApiError(401, 'Sign in required'));
  render(<BillingPanel />);
  await screen.findByText(/Pro access could not be verified/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  expect(await screen.findByRole('link', { name: 'Sign in to view billing' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Open Pro channel' })).toBeNull();
});
it('ignores an older channel response after refreshed access is downgraded', async () => {
  const channel = Promise.withResolvers<{ channelUrl: string; instructions: string }>();
  account.mockResolvedValueOnce(proAccount).mockResolvedValue(freeAccount);
  refresh.mockResolvedValue(freeAccount);
  pro.mockReturnValueOnce(channel.promise);
  render(<BillingPanel />);
  await screen.findByText('Subscription active');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  await screen.findByText('Free practice access');
  await act(async () => { channel.resolve({ channelUrl: 'https://community.example/private', instructions: 'Old membership' }); });
  expect(screen.queryByRole('link', { name: 'Open Pro channel' })).toBeNull();
  expect(screen.queryByText('Old membership')).toBeNull();
});
it.each([plus, { ...plus, proAccess: true }, { ...proAccount, proAccess: false }])('requires both a Pro tier and verified access before loading the channel: %j', async (value) => {
  account.mockResolvedValue(value);
  render(<BillingPanel />);
  await screen.findByText('Subscription active');
  expect(pro).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Open Pro channel' })).toBeNull();
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

it.each([freeAccount, plus])('hides pricing links for $tier while retaining Contact and payment management', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'false');
  account.mockResolvedValue(value);
  render(<BillingPanel />);
  await screen.findByText(value.tier === 'free' ? 'Free practice access' : 'Subscription active');
  expect(screen.queryByRole('link', { name: /Explore Plus|Compare plans/ })).toBeNull();
  expect(screen.getByRole('link', { name: 'Need higher limits? Contact us to discuss your needs.' })).toHaveAttribute('href', '/contact?reason=higher-limits');
  if (value.tier === 'plus') expect(screen.getByRole('button', { name: 'Manage payments and cancellation' })).toBeVisible();
});
