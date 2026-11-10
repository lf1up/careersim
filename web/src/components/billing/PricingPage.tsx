'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api';
import { fetchPlanCatalog, startCheckout, windowLabel, money, type PlanCatalogResponse, type BillingChoice, type BillingInterval } from '@/lib/billing';
import { Button } from '@/components/ui/Button';
import { RetroAlert } from '@/components/ui/RetroBadge';

export function PricingPage({ catalog: initialCatalog, initialInterval = 'month' }: { catalog: PlanCatalogResponse; initialInterval?: BillingInterval }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading } = useAuth();

  async function buy(selected: BillingChoice) {
    setBusy(selected.tier);
    setError(null);
    try {
      const current = await fetchPlanCatalog(true);
      setCatalog(current);
      if (current.plans.find(plan => plan.tier === selected.tier)?.availability !== 'available') throw new Error('This plan is currently unavailable. Please check again later.');
      const checkout = await startCheckout(selected);
      window.location.assign(checkout.url);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/pricing?tier=${selected.tier}&interval=${selected.interval}`)}`);
        return;
      }
      setError(failure instanceof Error ? failure.message : 'Could not open checkout. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return <div className="space-y-8 pb-10 retro-fade-in">
    <header className="max-w-3xl mx-auto text-center space-y-4">
      <p className="font-monoRetro text-sm uppercase tracking-wider2">More room to practice</p>
      <h1 className="font-retro text-2xl sm:text-3xl leading-relaxed">Choose your plan</h1>
      <p>Core scenarios, feedback, and your practice history on every plan.</p>
      <fieldset className="flex justify-center gap-4 border-0 p-0">
        <legend className="sr-only">Billing interval</legend>
        {(['month', 'year'] as const).map(value => <label key={value} className={`cursor-pointer border-2 border-black dark:border-retro-ink-dark px-4 py-3 shadow-retro-2 focus-within:ring-2 focus-within:ring-retro-accent ${interval === value ? 'bg-retro-accent dark:bg-retro-accent-dark text-black' : 'bg-white dark:bg-retro-surface-dark'}`}><input className="mr-2 accent-black" type="radio" name="billing-interval" value={value} checked={interval === value} onChange={() => setInterval(value)} />{value === 'month' ? 'Monthly' : 'Yearly'}</label>)}
      </fieldset>
    </header>
    {error && <RetroAlert tone="error" title="Checkout unavailable">{error} <Link href="/profile#billing" className="underline">Manage existing billing</Link></RetroAlert>}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      {catalog.plans.map(plan => {
        const free = plan.tier === 'free';
        const price = plan.prices.find(price => price.interval === interval);
        const titleId = `plan-${plan.tier}`;
        const limits = plan.limits;
        return <section aria-labelledby={titleId} key={plan.tier} className={`retro-card flex flex-col min-w-0 ${plan.tier === 'plus' ? 'ring-4 ring-retro-accent dark:ring-retro-accent-dark' : ''}`}>
          <div className="p-6 border-b-2 border-black dark:border-retro-ink-dark space-y-3">
            <h2 id={titleId} className="font-retro text-xl">{plan.name}</h2>
            {plan.tier === 'plus' && <p className="text-sm font-semibold">For regular practice</p>}
            <p className="font-monoRetro text-4xl font-bold">{money(price?.amountCents ?? 0)}</p>
            <p>{free ? 'Free to practice' : interval === 'year' ? 'billed yearly' : 'billed monthly'}</p>
            {price && interval === 'year' && <><p className="text-sm">{plan.tier === 'supporter' ? 'About ' : ''}{money(price.amountCents / 12, 2)} monthly equivalent</p><p className="inline-block px-2 py-1 bg-retro-accent dark:bg-retro-accent-dark text-black font-semibold text-sm">{price.discountLabel}</p></>}
          </div>
          <div className="p-6 flex flex-col flex-1 gap-5">
            <ul className="space-y-3 text-sm leading-relaxed">
              <li>{limits.sessionsCreateMax.toLocaleString('en-US')} new sessions per {windowLabel(limits.sessionsWindowMs)}</li>
              <li>{limits.chatMessagesMax.toLocaleString('en-US')} text messages per {windowLabel(limits.chatWindowMs)}</li>
              <li>{limits.customSimulationsMax.toLocaleString('en-US')} saved custom simulations</li>
              <li>{limits.customPersonasMax.toLocaleString('en-US')} saved custom personas</li>
              <li>{limits.voiceDailyMinutes === 0 ? 'Voice quota disabled' : `${limits.voiceDailyMinutes.toLocaleString('en-US')} voice minutes / day (${(limits.voiceDailyMinutes / 60).toLocaleString('en-US')} hours)`}</li>
            </ul>
            <ul className="space-y-3 text-sm border-t-2 border-black/20 dark:border-white/20 pt-5">{plan.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
            <div className="mt-auto pt-2">
              {free ? <Link href={isAuthenticated ? '/simulations' : '/register'} className="retro-btn-base inline-flex px-4 py-2 w-full justify-center bg-white dark:bg-retro-surface-dark">{isAuthenticated ? 'Keep practicing' : 'Start free'}</Link> : plan.availability !== 'available' ? <Button className="w-full" disabled>{plan.tier === 'supporter' ? 'Supporter coming soon' : 'Checkout unavailable'}</Button> : isAuthenticated ? <Button className="w-full" variant={plan.tier === 'plus' ? 'secondary' : 'outline'} disabled={busy !== null || isLoading} isLoading={busy === plan.tier} onClick={() => buy({ tier: plan.tier as BillingChoice['tier'], interval })}>Choose {plan.name}</Button> : <Link href={`/login?next=${encodeURIComponent(`/pricing?tier=${plan.tier}&interval=${interval}`)}`} className={`retro-btn-base inline-flex px-4 py-2 w-full justify-center ${plan.tier === 'plus' ? 'bg-retro-accent text-black' : 'bg-white dark:bg-retro-surface-dark'}`}>Sign in for {plan.name}</Link>}
            </div>
          </div>
        </section>;
      })}
    </div>
    <div className="max-w-3xl mx-auto text-center space-y-3 text-sm leading-relaxed">
      <p>All prices in USD, before applicable checkout taxes. Cancel renewal anytime in your billing portal; access continues through your paid period.</p>
      <p>{interval === 'year' ? 'Yearly subscriptions auto-renew at the full yearly price. The full year is charged upfront, not in monthly installments.' : 'Monthly subscriptions auto-renew at the monthly price.'}</p>
      <p>Yearly billing changes payment timing only. Usage allowances stay the same. Voice resets at midnight UTC. Saved custom items are totals you keep, not monthly creation credits. Deleting an item frees a slot.</p>
      <p><Link href="/contact?reason=higher-limits" className="font-semibold underline underline-offset-4">{catalog.higherLimitsMessage}</Link></p>
    </div>
  </div>;
}
