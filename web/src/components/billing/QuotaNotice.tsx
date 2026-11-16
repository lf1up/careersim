'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBillingAccount } from '@/lib/billing';
import { isPricingEnabled } from '@/lib/pricing';
import { RetroAlert } from '@/components/ui/RetroBadge';

type QuotaPayload = { message?: string; tier?: 'free' | 'plus' | 'supporter'; resetsAt?: string };
function quotaPayload(error: unknown): QuotaPayload | null {
  if (!error || typeof error !== 'object') return null;
  const payload = 'payload' in error ? error.payload : error;
  if (!payload || typeof payload !== 'object') return null;
  const code = 'error' in payload ? payload.error : 'code' in payload ? payload.code : undefined;
  const isQuota = 'quotaKind' in payload && (payload.quotaKind === 'sessions' || payload.quotaKind === 'messages') || code === 'voice_quota_exhausted' || code === 'CUSTOM_SIMULATIONS_LIMIT' || code === 'CUSTOM_PERSONAS_LIMIT';
  if (!isQuota) return null;
  const tier = 'tier' in payload && (payload.tier === 'free' || payload.tier === 'plus' || payload.tier === 'supporter') ? payload.tier : undefined;
  const resetAt = 'resetsAt' in payload ? payload.resetsAt : 'resetAt' in payload ? payload.resetAt : undefined;
  return { tier, message: 'message' in payload && typeof payload.message === 'string' ? payload.message : undefined, resetsAt: typeof resetAt === 'string' && Number.isFinite(Date.parse(resetAt)) ? resetAt : undefined };
}
export function QuotaNotice({ error }: { error: unknown }) {
  const payload = quotaPayload(error);
  const [verifiedTier, setVerifiedTier] = useState<'free' | 'plus' | 'supporter' | null>(null);
  const needsTier = payload !== null && !payload.tier;
  useEffect(() => {
    let canceled = false;
    if (needsTier) void getBillingAccount().then(account => { if (!canceled) setVerifiedTier(account.tier); }).catch(() => {});
    return () => { canceled = true; };
  }, [needsTier]);
  if (!payload) return null;
  const tier = payload.tier ?? verifiedTier;
  const pricingEnabled = isPricingEnabled();
  return <RetroAlert tone="warning" title="Practice allowance reached">
    <div className="space-y-2 text-sm">
      <p>{payload.message ?? 'Your current practice allowance has been reached.'}</p>
      {payload.resetsAt && <p>Resets {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(payload.resetsAt))} UTC.</p>}
      {tier === 'free' && <p>{pricingEnabled ? <><Link href="/pricing?tier=plus" className="font-semibold underline">Explore Plus</Link> for higher allowances, or wait for timed usage to reset.</> : 'Wait for timed usage to reset.'} Delete saved custom items to free inventory slots.</p>}
      {(tier !== 'free' || !pricingEnabled) && <p><Link href="/contact?reason=higher-limits" className="font-semibold underline">Need higher limits? Contact us to discuss your needs.</Link></p>}
    </div>
  </RetroAlert>;
}
export function isQuotaError(error: unknown): boolean { return quotaPayload(error) !== null; }
