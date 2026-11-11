import type { Metadata } from 'next';
import { ContactForm, type ContactReason } from '@/components/contact/ContactForm';
import { ContactScrollReset } from '@/components/contact/ContactScrollReset';
import { RetroCard } from '@/components/ui/RetroCard';

export const metadata: Metadata = { title: 'Contact CareerSim', description: 'Ask a question or discuss higher practice limits with the CareerSim team.' };
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const params = await searchParams;
  const reason: ContactReason = params.reason === 'higher-limits' || params.reason === 'supporter' ? params.reason : 'general';
  return (
    <div className="max-w-2xl mx-auto space-y-6 pt-2 pb-3 sm:pt-0 sm:pb-4 retro-fade-in">
      <ContactScrollReset />
      <RetroCard title="CONTACT US" subtitle="Questions, support, or higher limits. No company required.">
        <ContactForm reason={reason} />
      </RetroCard>
    </div>
  );
}
