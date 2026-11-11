import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/billing', () => ({ getBillingAccount: vi.fn().mockResolvedValue({ tier: 'plus' }) }));
import { QuotaNotice } from './QuotaNotice';
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());
it('offers paid users contact after a cap without a Supporter upsell', () => {
  render(<QuotaNotice error={{ payload: { error: 'RATE_LIMITED', quotaKind: 'messages', tier: 'plus', message: 'Text allowance reached.', resetsAt: '2026-11-10T18:00:00Z' } }} />);
  expect(screen.getByText('Text allowance reached.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Need higher limits? Contact us to discuss your needs.' })).toHaveAttribute('href', '/contact?reason=higher-limits');
  expect(screen.queryByText(/Supporter/)).toBeNull();
  expect(screen.getByText(/UTC/)).toBeVisible();
});
it('preserves the Free reset and Plus upgrade path', () => {
  render(<QuotaNotice error={{ payload: { error: 'RATE_LIMITED', quotaKind: 'sessions', tier: 'free', message: 'New session allowance reached.', resetsAt: '2026-11-10T18:00:00Z' } }} />);
  expect(screen.getByRole('link', { name: 'Explore Plus' })).toHaveAttribute('href', '/pricing?tier=plus');
  expect(screen.getByText(/Resets/)).toBeVisible();
});
it('does not confuse a safety burst limit with a subscription cap', () => {
  const { container } = render(<QuotaNotice error={{ payload: { error: 'RATE_LIMITED', message: 'Too fast.' } }} />);
  expect(container).toBeEmptyDOMElement();
});
it('resolves verified access for worker voice quota notices', async () => {
  render(<QuotaNotice error={{ error: 'voice_quota_exhausted', message: 'Voice resets at midnight UTC.' }} />);
  expect(await screen.findByRole('link', { name: 'Need higher limits? Contact us to discuss your needs.' })).toBeVisible();
});
it('shows the exact UTC reset from a rejected voice start', () => {
  render(<QuotaNotice error={{ payload: { error: 'voice_quota_exhausted', message: 'Daily voice budget exhausted', tier: 'plus', resetAt: '2026-11-11T00:00:00.000Z', capSeconds: 43200 } }} />);
  expect(screen.getByText('Resets Nov 11, 2026, 12:00 AM UTC.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Need higher limits? Contact us to discuss your needs.' })).toBeVisible();
});

it('keeps reset guidance and Contact without an upgrade link when pricing is disabled', () => {
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'false');
  render(<QuotaNotice error={{ payload: { error: 'RATE_LIMITED', quotaKind: 'sessions', tier: 'free' } }} />);
  expect(screen.queryByRole('link', { name: 'Explore Plus' })).toBeNull();
  expect(screen.getByText(/wait for timed usage to reset/i)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Need higher limits? Contact us to discuss your needs.' })).toHaveAttribute('href', '/contact?reason=higher-limits');
});
