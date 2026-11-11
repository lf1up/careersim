import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPricingEnabled } from '@/lib/pricing';
import { PricingPage } from '@/components/billing/PricingPage';
import { fetchPlanCatalog } from '@/lib/billing';
import { RetroAlert } from '@/components/ui/RetroBadge';
export const metadata: Metadata = { title: 'CareerSim pricing', description: 'Compare Free, Plus, and Supporter practice allowances with monthly and yearly billing.' };
export const dynamic = 'force-dynamic';
export default async function Pricing({ searchParams }: { searchParams: Promise<{ interval?: string }> }) {
  if (!isPricingEnabled()) notFound();
  const [catalog, params] = await Promise.all([fetchPlanCatalog().catch(() => null), searchParams]);
  if (!catalog) return <div className="max-w-2xl mx-auto py-10"><h1 className="font-retro text-2xl mb-6">Pricing</h1><RetroAlert tone="error" title="Pricing unavailable">We could not load the current plans. <Link href="/pricing" className="underline">Try again</Link> or <Link href="/contact" className="underline">contact us</Link>.</RetroAlert></div>;
  return <PricingPage catalog={catalog} initialInterval={params.interval === 'year' ? 'year' : 'month'} />;
}
