import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { captchaRequest } from '@/lib/captcha';

import {
  CONTACT_RATE_LIMIT_MESSAGE,
  clientIp,
  consumeContactQuotas,
} from '@/lib/contact-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_LENGTH = 4000;
const MIN_MESSAGE_LENGTH = 20;

const USE_CASE_LABELS: Record<string, string> = {
  training: 'Training & onboarding',
  support: 'Support practice',
  content: 'Content pipeline',
  assessment: 'Assessment & certification',
  platform: 'White-label / API',
  other: 'Something else',
};

const REASON_LABELS: Record<string, string> = {
  general: 'General question',
  'higher-limits': 'Higher limits',
  supporter: 'Supporter question',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * /business contact form handler.
 *
 * Lives on the apex `web` project so it shares the Vercel challenge session
 * with page loads. Cross-project rewrites to LANDING_ORIGIN return HTML
 * bot-challenge pages and break the ALTCHA widget.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Invalid form submission.' }, 400);
  }

  // Honeypot: real users never see (or fill) this field.
  if (field(form, 'website', 200)) {
    return json({ ok: true });
  }

  const audience = field(form, 'audience', 40) || 'business';
  if (audience !== 'business' && audience !== 'personal') return json({ error: 'Invalid audience.' }, 400);
  const personal = audience === 'personal';
  const reason = field(form, 'reason', 40);
  if (personal && !Object.hasOwn(REASON_LABELS, reason)) return json({ error: 'Please pick a valid reason.' }, 400);
  for (const [key, max] of Object.entries({ name: 120, email: 254, company: 160, message: MAX_MESSAGE_LENGTH })) {
    const value = form.get(key);
    if (typeof value === 'string' && value.trim().length > max) return json({ error: `${key} is too long.` }, 400);
  }

  const name = field(form, 'name', 120);
  const email = field(form, 'email', 254);
  const company = field(form, 'company', 160);
  const useCase = field(form, 'useCase', 40);
  const message = field(form, 'message', MAX_MESSAGE_LENGTH);
  const altchaPayload = field(form, 'altcha', 4000);

  if (!name) return json({ error: 'Please add your name.' }, 400);
  if (!EMAIL_RE.test(email)) {
    return json({ error: personal ? 'Please add a valid email.' : 'Please add a valid work email.' }, 400);
  }
  if (!personal && !company) return json({ error: 'Please add your company.' }, 400);
  if (!personal && !Object.hasOwn(USE_CASE_LABELS, useCase)) {
    return json({ error: 'Please pick a use case.' }, 400);
  }
  if (message.length < MIN_MESSAGE_LENGTH) {
    return json(
      {
        error: `Please tell us a bit more (at least ${MIN_MESSAGE_LENGTH} characters).`,
      },
      400,
    );
  }

  const verification = await captchaRequest('/verify', request, altchaPayload);
  if (verification.status !== 200) {
    return json(
      { error: 'Verification failed — refresh the page and try again.' },
      verification.status === 400 ? 400 : verification.status === 429 ? 429 : 503,
    );
  }

  // 3 sends per hour per IP and per submitter email (after ALTCHA passes).
  if (
    !consumeContactQuotas([
      `ip:${clientIp(request)}`,
      `email:${email.toLowerCase()}`,
    ])
  ) {
    return json({ error: CONTACT_RATE_LIMIT_MESSAGE }, 429);
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const contactEmail =
    process.env.CONTACT_TO_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ||
    'hello@careersim.local';
  const fromEmail =
    process.env.CONTACT_FROM_EMAIL?.trim() || 'onboarding@resend.dev';

  if (!apiKey) {
    console.error('contact: RESEND_API_KEY is not configured');
    return json(
      { error: 'Email service unavailable — please email us directly.' },
      503,
    );
  }

  const useCaseLabel = personal ? REASON_LABELS[reason] : USE_CASE_LABELS[useCase];
  const subject = personal ? `CareerSim contact: ${useCaseLabel}` : `B2B pilot inquiry — ${company} (${useCaseLabel})`;
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company || 'Not provided'}`,
    `${personal ? 'Reason' : 'Use case'}: ${useCaseLabel}`,
    '',
    message,
  ].join('\n');
  const html = `
    <h2>${personal ? 'New personal contact request' : 'New B2B pilot inquiry'}</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
    <strong>Email:</strong> ${escapeHtml(email)}<br/>
    <strong>Company:</strong> ${escapeHtml(company || 'Not provided')}<br/>
    <strong>${personal ? 'Reason' : 'Use case'}:</strong> ${escapeHtml(useCaseLabel)}</p>
    <hr/>
    <p>${escapeHtml(message).replaceAll('\n', '<br/>')}</p>
  `;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: contactEmail,
      replyTo: email,
      subject,
      text,
      html,
    });
    if (error) {
      console.error('contact: resend rejected the message', error);
      return json(
        { error: 'Could not send your inquiry — please email us directly.' },
        502,
      );
    }
  } catch (err) {
    console.error('contact: resend delivery failed', err);
    return json(
      { error: 'Could not send your inquiry — please email us directly.' },
      502,
    );
  }

  return json({ ok: true });
}
