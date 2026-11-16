import { z } from 'zod';
import { request } from './api';
import { safeNextPath } from './safe-next-path';

const tier = z.enum(['free', 'plus', 'pro']);
const interval = z.enum(['month', 'year']);
const choice = z.strictObject({ tier: z.enum(['plus', 'pro']), interval });
const date = z.iso.datetime({ offset: true });
const secureUrl = z.url().refine(value => new URL(value).protocol === 'https:', 'A secure destination is required.');
const contactUrl = z.string().refine(value => safeNextPath(value, '') !== '', 'Invalid contact destination.');
const limits = z.object({
  sessionsCreateMax: z.number().int().positive(), sessionsWindowMs: z.number().int().positive(),
  chatMessagesMax: z.number().int().positive(), chatWindowMs: z.number().int().positive(),
  customSimulationsMax: z.number().int().nonnegative(), customPersonasMax: z.number().int().nonnegative(), voiceDailyMinutes: z.number().int().nonnegative(),
});
const catalogSchema = z.object({
  currency: z.literal('USD'), contactUrl, higherLimitsMessage: z.string(), planChangesAvailable: z.boolean(),
  plans: z.array(z.object({
    tier, name: z.string(), limits, benefits: z.array(z.string()), availability: z.enum(['available', 'billing_disabled', 'coming_soon']),
    prices: z.array(z.object({ interval, amountCents: z.number().int().nonnegative(), discountLabel: z.string().nullable() })),
  })).refine(plans => plans.length === 3 && new Set(plans.map(plan => plan.tier)).size === 3 && plans.every(plan => plan.tier === 'free' || plan.prices.length === 2 && new Set(plan.prices.map(price => price.interval)).size === 2), 'The complete pricing catalog is required.'),
});
const usageMetric = z.object({ used: z.number().nonnegative(), limit: z.number().nonnegative(), resetAt: date.nullable() }).nullable();
const accountSchema = z.object({
  tier, limits, proAccess: z.boolean(), reason: z.enum(['free', 'paid', 'grace', 'expired', 'revoked', 'disputed']), interval: interval.nullable(), paidThrough: date.nullable(), accessThrough: date.nullable(),
  status: z.string(), cancelAtPeriodEnd: z.boolean(), renews: z.boolean(), pendingChange: z.object({ choice, effectiveAt: date }).nullable(), pendingCheckout: z.boolean(), confirmationPending: z.boolean(),
  usage: z.object({ sessions: usageMetric, chatMessages: usageMetric, customSimulations: usageMetric, customPersonas: usageMetric, voice: usageMetric }), planChangesAvailable: z.boolean(), contactUrl,
});
export type BillingChoice = z.infer<typeof choice>;
export type BillingAccount = z.infer<typeof accountSchema>;
export type PlanCatalogResponse = z.infer<typeof catalogSchema>;
export type BillingInterval = BillingChoice['interval'];
const hostedDestination = z.object({ url: secureUrl });
let cachedCatalog: { value: PlanCatalogResponse; until: number } | null = null;

export async function fetchPlanCatalog(refresh = false): Promise<PlanCatalogResponse> {
  if (!refresh && cachedCatalog && cachedCatalog.until > Date.now()) return cachedCatalog.value;
  const value = catalogSchema.parse(await request<unknown>('/billing/catalog', { cache: 'no-store' }));
  cachedCatalog = { value, until: Date.now() + 60_000 };
  return value;
}
export async function startCheckout(selected: BillingChoice): Promise<{ url: string }> {
  return hostedDestination.parse(await request<unknown>('/billing/checkout', { method: 'POST', body: choice.parse(selected) }));
}
export async function getBillingAccount(): Promise<BillingAccount> {
  return accountSchema.parse(await request<unknown>('/billing/account', { cache: 'no-store' }));
}
export async function refreshBillingAccount(): Promise<BillingAccount> {
  return accountSchema.parse(await request<unknown>('/billing/refresh', { method: 'POST' }));
}
export async function createBillingPortal(): Promise<{ url: string }> {
  return hostedDestination.parse(await request<unknown>('/billing/portal', { method: 'POST' }));
}
export async function scheduleBillingChange(selected: BillingChoice): Promise<{ choice: BillingChoice; effectiveAt: string }> {
  return z.object({ choice, effectiveAt: date }).parse(await request<unknown>('/billing/change', { method: 'POST', body: choice.parse(selected) }));
}
export async function getProAccess(): Promise<{ channelUrl: string; instructions: string }> {
  return z.object({ channelUrl: secureUrl, instructions: z.string().min(1) }).parse(await request<unknown>('/billing/pro', { cache: 'no-store' }));
}
export function windowLabel(milliseconds: number): string {
  const hours = milliseconds / 3_600_000;
  if (hours >= 1) return `${hours.toLocaleString('en-US')} ${hours === 1 ? 'hour' : 'hours'}`;
  const minutes = milliseconds / 60_000;
  return `${minutes.toLocaleString('en-US')} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
export function money(amountCents: number, decimals = amountCents % 100 === 0 ? 0 : 2): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amountCents / 100);
}
