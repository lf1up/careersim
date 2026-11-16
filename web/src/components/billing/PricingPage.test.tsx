import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const { auth, fetchCatalog, checkout } = vi.hoisted(() => ({ auth: { isAuthenticated: false, isLoading: false }, fetchCatalog: vi.fn(), checkout: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/billing', async (original) => ({ ...await original<typeof import('@/lib/billing')>(), fetchPlanCatalog: fetchCatalog, startCheckout: checkout }));
import { catalog } from './fixtures';
import { PricingPage } from './PricingPage';
beforeEach(() => { auth.isAuthenticated = false; fetchCatalog.mockReset().mockResolvedValue(catalog); checkout.mockReset(); });
it('lists three plans and all configured allowances visibly in responsive cards', () => {
  render(<PricingPage catalog={catalog} />);
  for (const tier of ['Free', 'Plus', 'Supporter']) expect(screen.getByRole('heading', { name: tier })).toBeVisible();
  const plus = screen.getByRole('region', { name: 'Plus' });
  for (const text of ['100 new sessions per 6 hours', '3,000 text messages per 6 hours', '250 saved custom simulations', '250 saved custom personas', '360 voice minutes / day (6 hours)']) expect(within(plus).getByText(text)).toBeVisible();
  expect(screen.getByText('4 new sessions per 6 hours')).toBeVisible();
  expect(screen.getByText('420 text messages per 6 hours')).toBeVisible();
  expect(screen.getByText('7 saved custom simulations')).toBeVisible();
  expect(screen.getByText('15 saved custom personas')).toBeVisible();
  expect(screen.getByText('90 voice minutes / day (1.5 hours)')).toBeVisible();
  expect(screen.getByRole('link', { name: catalog.higherLimitsMessage })).toHaveAttribute('href', '/contact?reason=higher-limits');
  for (const plan of catalog.plans) {
    const card = within(screen.getByRole('region', { name: plan.name }));
    for (const benefit of plan.benefits) expect(card.getByText(benefit)).toBeVisible();
  }
  expect(screen.getByRole('link', { name: 'Sign in for Supporter' })).toHaveAttribute('href', '/login?next=%2Fpricing%3Ftier%3Dsupporter%26interval%3Dmonth');
  expect(plus.parentElement).toHaveClass('grid', 'lg:grid-cols-3');
});
it('defaults to monthly and exposes full annual charges with renewal terms and unchanged limits', () => {
  render(<PricingPage catalog={catalog} />);
  expect(screen.getByRole('radio', { name: 'Monthly' })).toBeChecked();
  expect(within(screen.getByRole('region', { name: 'Plus' })).getByText('$9')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Supporter' })).getByText('$49')).toBeVisible();
  const yearly = screen.getByRole('radio', { name: 'Yearly' });
  yearly.focus();
  fireEvent.click(yearly);
  expect(yearly).toBeChecked();
  expect(yearly).toHaveFocus();
  const plus = screen.getByRole('region', { name: 'Plus' });
  const supporter = screen.getByRole('region', { name: 'Supporter' });
  expect(within(plus).getByText('$90')).toBeVisible();
  expect(within(supporter).getByText('$490')).toBeVisible();
  expect(within(plus).getByText(/\$7.50.*monthly equivalent/)).toBeVisible();
  expect(within(supporter).getByText(/About \$40.83.*monthly equivalent/)).toBeVisible();
  expect(screen.getAllByText('billed yearly')).toHaveLength(2);
  expect(screen.getAllByText('2 months free')).toHaveLength(2);
  expect(screen.getByText(/Yearly subscriptions auto-renew/)).toBeVisible();
  expect(within(plus).getByText('100 new sessions per 6 hours')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Sign in for Plus' })).toHaveAttribute('href', '/login?next=%2Fpricing%3Ftier%3Dplus%26interval%3Dyear');
});
it.each(['month', 'year'] as const)('shows independent Supporter allowances with %s billing while preserving Plus allowances', (interval) => {
  render(<PricingPage catalog={catalog} initialInterval={interval} />);
  const plus = within(screen.getByRole('region', { name: 'Plus' }));
  const supporter = within(screen.getByRole('region', { name: 'Supporter' }));
  for (const text of ['100 new sessions per 6 hours', '3,000 text messages per 6 hours', '250 saved custom simulations', '250 saved custom personas', '360 voice minutes / day (6 hours)']) expect(plus.getByText(text)).toBeVisible();
  for (const text of ['200 new sessions per 6 hours', '6,000 text messages per 6 hours', '500 saved custom simulations', '500 saved custom personas', '720 voice minutes / day (12 hours)']) expect(supporter.getByText(text)).toBeVisible();
});
it('uses non-default catalog windows without claiming six hours', () => {
  render(<PricingPage catalog={{ ...catalog, plans: catalog.plans.map(plan => ({ ...plan, limits: { ...plan.limits, sessionsWindowMs: 43200000, chatWindowMs: 43200000 } })) }} />);
  expect(screen.getAllByText(/per 12 hours/)).toHaveLength(6);
  expect(screen.queryByText(/per 6 hours/)).toBeNull();
});
it('shows configured prices to the cent without claiming an unconfigured yearly discount', () => {
  const custom = { ...catalog, plans: catalog.plans.map(plan => ({ ...plan, prices: plan.prices.map(price => ({
    ...price,
    amountCents: plan.tier === 'plus' ? (price.interval === 'month' ? 1299 : 12999) : (price.interval === 'month' ? 16999 : 199999),
    discountLabel: null,
  })) })) };
  render(<PricingPage catalog={custom} />);
  expect(within(screen.getByRole('region', { name: 'Plus' })).getByText('$12.99')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Supporter' })).getByText('$169.99')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
  expect(within(screen.getByRole('region', { name: 'Plus' })).getByText('$129.99')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Supporter' })).getByText('$1,999.99')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Plus' })).getByText('$10.83 monthly equivalent')).toBeVisible();
  expect(screen.queryByText('2 months free')).toBeNull();
});
it('refreshes the catalog and blocks checkout when the offer becomes unavailable', async () => {
  auth.isAuthenticated = true;
  fetchCatalog.mockResolvedValue({ ...catalog, plans: catalog.plans.map(plan => ({ ...plan, availability: 'billing_disabled' })) });
  render(<PricingPage catalog={catalog} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Plus' }));
  await screen.findByText(/This plan is currently unavailable/);
  expect(fetchCatalog).toHaveBeenCalledWith(true);
  expect(checkout).not.toHaveBeenCalled();
});

it('restores a selected annual interval after sign-in', () => {
  render(<PricingPage catalog={catalog} initialInterval="year" />);
  expect(screen.getByRole('radio', { name: 'Yearly' })).toBeChecked();
  expect(within(screen.getByRole('region', { name: 'Plus' })).getByText('$90')).toBeVisible();
});

it.each(['month', 'year'] as const)('starts Supporter checkout with %s billing', async (interval) => {
  auth.isAuthenticated = true;
  checkout.mockRejectedValueOnce(new Error('Checkout request failed.'));
  render(<PricingPage catalog={catalog} initialInterval={interval} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Supporter' }));
  await screen.findByText('Checkout request failed.');
  expect(checkout).toHaveBeenCalledWith({ tier: 'supporter', interval });
});
