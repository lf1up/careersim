'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { isPricingEnabled } from '@/lib/pricing';
import { getBillingAccount, refreshBillingAccount, createBillingPortal, scheduleBillingChange, getSupporterAccess, fetchPlanCatalog, money, windowLabel, type BillingAccount, type BillingChoice, type PlanCatalogResponse } from '@/lib/billing';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroAlert } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';

const supporterBenefits = ['Guidance and support from the development team', 'Chat directly with the developers', "Help decide the project's future together"];
function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
function statusLabel(account: BillingAccount): string {
  if (account.confirmationPending || account.pendingCheckout) return 'Pending payment confirmation. Returning from checkout does not activate a subscription.';
  if (account.reason === 'grace') return 'Payment failed. Grace access is temporary; update your payment method in the billing portal.';
  if (account.reason === 'revoked') return 'Paid access revoked. Your saved content is retained.';
  if (account.reason === 'disputed') return 'Paid access suspended while the current payment dispute is reviewed.';
  if (account.reason === 'expired') return 'Paid access ended. Your saved content is retained.';
  if (account.cancelAtPeriodEnd) return 'Renewal canceled. You retain access through your paid period.';
  return account.reason === 'paid' ? 'Subscription active' : 'Free practice access';
}

export function BillingPanel() {
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [catalog, setCatalog] = useState<PlanCatalogResponse | null>(null);
  const [channel, setChannel] = useState<Awaited<ReturnType<typeof getSupporterAccess>> | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lostAuth, setLostAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextChoice, setNextChoice] = useState<BillingChoice>({ tier: 'plus', interval: 'month' });
  const [notice, setNotice] = useState<string | null>(null);
  const attempts = useRef(0);
  const mounted = useRef(true);
  const currentTier = useRef<BillingAccount['tier'] | null>(null);

  const handleFailure = useCallback((failure: unknown) => {
    if (!mounted.current) return;
    if (failure instanceof ApiError && failure.status === 401) {
      setLostAuth(true);
      setAccount(null);
      setChannel(null);
    } else setError(failure instanceof ApiError || failure instanceof Error && failure.name !== 'ZodError' ? failure.message : 'Billing is temporarily unavailable. Please try again.');
  }, []);
  const accept = useCallback(async (result: BillingAccount) => {
    // A verified change refetches all current counters and entitlement facts.
    const changed = currentTier.current !== null && currentTier.current !== result.tier;
    const latest = changed ? await getBillingAccount() : result;
    if (!mounted.current) return;
    currentTier.current = latest.tier;
    setAccount(latest);
    if (!latest.supporterAccess || latest.tier !== 'supporter') {
      setChannel(null);
      setChannelError(null);
    }
    setLostAuth(false);
    if (changed) window.dispatchEvent(new Event('billing:updated'));
  }, []);

  useEffect(() => {
    mounted.current = true;
    void getBillingAccount().then(result => {
      if (!mounted.current) return;
      setNextChoice({ tier: result.tier === 'supporter' ? 'supporter' : 'plus', interval: result.interval ?? 'month' });
      return accept(result);
    }).catch(handleFailure);
    void fetchPlanCatalog().then(value => { if (mounted.current) setCatalog(value); }).catch(() => {});
    return () => { mounted.current = false; };
  }, [accept, handleFailure]);

  const refresh = useCallback(async () => {
    setError(null);
    setBusy(true);
    try { await accept(await refreshBillingAccount()); } catch (failure) { handleFailure(failure); }
    finally { if (mounted.current) setBusy(false); }
  }, [accept, handleFailure]);

  useEffect(() => {
    if (!account || !(account.confirmationPending || account.pendingCheckout) || attempts.current >= 5 || busy || lostAuth) return;
    const timer = setTimeout(() => { attempts.current += 1; void refresh(); }, 2000);
    return () => clearTimeout(timer);
  }, [account, busy, lostAuth, refresh]);

  useEffect(() => {
    let canceled = false;
    if (account?.supporterAccess && account.tier === 'supporter') {
      void getSupporterAccess().then(value => { if (!canceled) { setChannel(value); setChannelError(null); } }).catch(failure => {
        if (canceled) return;
        if (failure instanceof ApiError && failure.status === 401) handleFailure(failure);
        else setChannelError('Supporter access could not be verified. Refresh billing or contact us for help.');
      });
    }
    return () => { canceled = true; };
  }, [account?.supporterAccess, account?.tier, handleFailure]);

  async function portal() {
    setBusy(true); setError(null);
    try { const result = await createBillingPortal(); window.location.assign(result.url); }
    catch (failure) { handleFailure(failure); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function change() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await scheduleBillingChange(nextChoice);
      setNotice(`Change scheduled for ${dateLabel(result.effectiveAt)} UTC.`);
      await accept(await getBillingAccount());
    } catch (failure) { handleFailure(failure); }
    finally { if (mounted.current) setBusy(false); }
  }

  const chosenPlan = catalog?.plans.find(plan => plan.tier === nextChoice.tier);
  const chosenPrice = chosenPlan?.prices.find(price => price.interval === nextChoice.interval);
  const usageLabels = { sessions: 'New sessions', chatMessages: 'Text messages', customSimulations: 'Saved custom simulations', customPersonas: 'Saved custom personas', voice: 'Voice minutes today' };
  const canChange = !!account?.planChangesAvailable && chosenPlan?.availability === 'available' && chosenPrice && account.paidThrough && (nextChoice.tier !== account.tier || nextChoice.interval !== account.interval);
  return <section id="billing" aria-label="Billing" className="scroll-mt-6"><RetroCard title="BILLING" titleAs="h2" subtitle="Your verified access, allowances, and payment settings.">
    <div className="space-y-5">
      {lostAuth ? <Link className="underline" href="/login?next=%2Fprofile%23billing">Sign in to view billing</Link> : !account && !error ? <p role="status">Loading billing…</p> : null}
      {error && <RetroAlert tone="error" title="Billing unavailable">{error}</RetroAlert>}
      {notice && <p role="status">{notice}</p>}
      {account && !lostAuth && <>
        <div className="space-y-2" aria-live="polite">
          <p className="font-retro text-lg">{account.tier === 'free' ? 'Free' : account.tier === 'plus' ? 'Plus' : 'Supporter'}</p>
          <p>{statusLabel(account)}</p>
          {account.interval && <p>Current billing: {account.interval === 'year' ? 'Yearly' : 'Monthly'}</p>}
          {account.accessThrough && <p>{account.reason === 'grace' ? 'Grace access through' : 'Paid access through'} {dateLabel(account.accessThrough)} UTC.{account.reason === 'paid' && account.renews && !account.cancelAtPeriodEnd ? ' Renewal is automatic.' : ''}</p>}
          {account.pendingChange && <p>Scheduled: {account.pendingChange.choice.tier === 'plus' ? 'Plus' : 'Supporter'}, {account.pendingChange.choice.interval === 'year' ? 'yearly' : 'monthly'} on {dateLabel(account.pendingChange.effectiveAt)} UTC.</p>}
        </div>
        <section aria-label="Practice allowances" className="space-y-3 border-y-2 border-black/20 dark:border-white/20 py-4">
          <h3 className="font-semibold">Practice allowances</h3>
          <p className="text-sm">Sessions reset per {windowLabel(account.limits.sessionsWindowMs)}; text messages per {windowLabel(account.limits.chatWindowMs)}. Voice resets at midnight UTC. Saved items are owned totals, not monthly credits.</p>
          <dl className="space-y-3 text-sm">
            {(Object.keys(usageLabels) as Array<keyof typeof usageLabels>).map(key => {
              const metric = account.usage[key];
              const limit = key === 'sessions' ? account.limits.sessionsCreateMax : key === 'chatMessages' ? account.limits.chatMessagesMax : key === 'customSimulations' ? account.limits.customSimulationsMax : key === 'customPersonas' ? account.limits.customPersonasMax : account.limits.voiceDailyMinutes;
              return <div key={key} className="flex justify-between gap-3 flex-wrap"><dt>{usageLabels[key]}</dt><dd className="font-monoRetro text-right">{metric ? `${Number(metric.used.toFixed(2)).toLocaleString('en-US')} / ${metric.limit.toLocaleString('en-US')}` : `Usage temporarily unavailable / ${limit.toLocaleString('en-US')}`}{metric?.resetAt && <span className="block text-xs font-sans">Resets {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(metric.resetAt))} UTC</span>}</dd></div>;
            })}
          </dl>
          <p className="text-sm">Changes to your plan keep existing usage. Saved content stays available after a downgrade; delete saved items to free inventory slots.</p>
        </section>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy} onClick={() => { attempts.current = 0; void refresh(); }}>Refresh billing</Button>
          {(account.interval || account.paidThrough) && <Button disabled={busy} onClick={portal}>Manage payments and cancellation</Button>}
          {isPricingEnabled() && <Link className="retro-btn-base inline-flex px-4 py-2 bg-retro-accent dark:bg-retro-accent-dark text-black" href="/pricing">{account.tier === 'free' ? 'Explore Plus' : 'Compare plans'}</Link>}
        </div>
        {account.interval && (account.planChangesAvailable && catalog ? <section aria-label="Change plan" className="space-y-3">
          <h3 className="font-semibold">Next renewal</h3>
          <label className="block text-sm">Next plan<select className="block w-full p-2 border-2 border-black bg-white text-black" value={nextChoice.tier} onChange={event => setNextChoice({ ...nextChoice, tier: event.target.value === 'supporter' ? 'supporter' : 'plus' })}>{catalog.plans.filter(plan => plan.tier !== 'free').map(plan => <option key={plan.tier} value={plan.tier} disabled={plan.availability !== 'available'}>{plan.name}{plan.availability !== 'available' ? ' (unavailable)' : ''}</option>)}</select></label>
          <label className="block text-sm">Next billing interval<select className="block w-full p-2 border-2 border-black bg-white text-black" value={nextChoice.interval} onChange={event => setNextChoice({ ...nextChoice, interval: event.target.value === 'year' ? 'year' : 'month' })}><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
          {account.paidThrough && chosenPrice && <p className="text-sm">Changes take effect on {dateLabel(account.paidThrough)} UTC. Your next full charge is {money(chosenPrice.amountCents)} USD, before applicable taxes, {nextChoice.interval === 'year' ? 'billed yearly and auto-renewing each year' : 'billed monthly and auto-renewing each month'}. Current benefits continue until then.</p>}
          <Button disabled={!canChange || busy} onClick={change}>Schedule {chosenPlan?.name ?? 'plan'} {nextChoice.interval === 'year' ? 'yearly' : 'monthly'} for {money(chosenPrice?.amountCents ?? 0)}</Button>
        </section> : <p className="text-sm">For tier or billing interval changes, <Link href="/contact?reason=general" className="underline">contact us</Link>. Your current paid period stays in place.</p>)}
        <section aria-label="Supporter benefits" className="space-y-3 border-t-2 border-black/20 dark:border-white/20 pt-5">
          <h3 className="font-semibold">Supporter</h3>
          <ul className="list-disc pl-5 text-sm space-y-2">{supporterBenefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
          {channel && account.supporterAccess ? <><p className="text-sm whitespace-pre-line">{channel.instructions}</p><a className="font-semibold underline" href={channel.channelUrl} target="_blank" rel="noopener noreferrer">Open Supporter channel</a></> : <p className="text-sm">The private channel is available after Supporter membership is verified.</p>}
          {channelError && <p role="alert" className="text-sm">{channelError} <Link href="/contact?reason=supporter" className="underline">Contact the team</Link></p>}
        </section>
        <p className="text-sm"><Link href="/contact?reason=higher-limits" className="font-semibold underline">Need higher limits? Contact us to discuss your needs.</Link></p>
      </>}
      {!account && error && !lostAuth && <Button onClick={refresh} disabled={busy}>Retry billing</Button>}
    </div>
  </RetroCard></section>;
}
