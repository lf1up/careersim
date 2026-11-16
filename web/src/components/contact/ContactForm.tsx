'use client';

import { useRef, useState, type FormEvent } from 'react';
import { AltchaWidget, type AltchaHandle } from '@/components/auth/AltchaWidget';
import { Button } from '@/components/ui/Button';
import { RetroInput } from '@/components/ui/RetroInput';
import { RetroAlert } from '@/components/ui/RetroBadge';

export type ContactReason = 'general' | 'higher-limits' | 'supporter';

export function ContactForm({ reason }: { reason: ContactReason }) {
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const captcha = useRef<AltchaHandle>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof || busy) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set('audience', 'personal');
    body.set('altcha', proof);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/contact', { method: 'POST', body });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Could not send your message. Please try again.';
        throw new Error(message);
      }
      setSent(true);
      form.reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send your message. Please try again.');
    } finally {
      setBusy(false);
      setProof(null);
      captcha.current?.reset();
    }
  }

  if (sent) return <RetroAlert tone="success" title="Message sent">Your message has been sent.</RetroAlert>;
  return (
    <form onSubmit={submit} className="space-y-5">
      <RetroInput name="name" label="Name" autoComplete="name" maxLength={120} required />
      <RetroInput name="email" label="Email" type="email" autoComplete="email" maxLength={254} required />
      <RetroInput name="company" label="Company (optional)" autoComplete="organization" maxLength={160} />
      <label className="block space-y-2 text-sm font-semibold">Reason
        <select name="reason" defaultValue={reason} className="w-full border-2 border-black bg-white p-3 text-black dark:bg-retro-surface-dark dark:text-retro-ink-dark dark:border-retro-ink-dark">
          <option value="general">General question</option>
          <option value="higher-limits">Higher limits</option>
          <option value="supporter">Supporter question</option>
        </select>
      </label>
      <label className="block space-y-2 text-sm font-semibold">Message
        <textarea name="message" minLength={20} maxLength={4000} rows={6} required className="w-full border-2 border-black bg-white p-3 text-black shadow-retro-2 dark:bg-retro-surface-dark dark:text-retro-ink-dark dark:border-retro-ink-dark" />
      </label>
      <div hidden aria-hidden="true"><label>Website<input name="website" autoComplete="off" tabIndex={-1} /></label></div>
      <AltchaWidget challengeUrl="/api/altcha-challenge" onVerified={setProof} onReset={() => setProof(null)} handleRef={captcha} />
      {error && <RetroAlert tone="error" title="Could not send">{error}</RetroAlert>}
      <p className="text-sm text-secondary-600 dark:text-secondary-400">A contact request does not change your plan or limits. A Supporter question does not verify membership.</p>
      <Button type="submit" disabled={!proof || busy} isLoading={busy}>Send message</Button>
    </form>
  );
}
