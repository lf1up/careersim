import type { APIRoute } from 'astro';
import { verifySolution } from 'altcha-lib/v1';
import { Resend } from 'resend';

export const prerender = false;

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Invalid form submission.' }, 400);
  }

  // Honeypot: real users never see (or fill) this field.
  if (field(form, 'website', 200)) {
    // Pretend success so bots don't adapt.
    return json({ ok: true });
  }

  const name = field(form, 'name', 120);
  const email = field(form, 'email', 254);
  const company = field(form, 'company', 160);
  const useCase = field(form, 'useCase', 40);
  const message = field(form, 'message', MAX_MESSAGE_LENGTH);
  const altchaPayload = field(form, 'altcha', 4000);

  if (!name) return json({ error: 'Please add your name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please add a valid work email.' }, 400);
  if (!company) return json({ error: 'Please add your company.' }, 400);
  if (!(useCase in USE_CASE_LABELS)) return json({ error: 'Please pick a use case.' }, 400);
  if (message.length < MIN_MESSAGE_LENGTH) {
    return json({ error: `Please tell us a bit more (at least ${MIN_MESSAGE_LENGTH} characters).` }, 400);
  }

  const hmacKey = import.meta.env.ALTCHA_HMAC_KEY?.trim();
  if (!hmacKey) return json({ error: 'Verification service unavailable.' }, 503);

  let verified = false;
  try {
    verified = await verifySolution(altchaPayload, hmacKey, true);
  } catch {
    verified = false;
  }
  if (!verified) {
    return json({ error: 'Verification failed — refresh the page and try again.' }, 400);
  }

  const apiKey = import.meta.env.RESEND_API_KEY?.trim();
  const contactEmail =
    import.meta.env.LANDING_CONTACT_EMAIL?.trim() || 'hello@careersim.local';
  const fromEmail =
    import.meta.env.CONTACT_FROM_EMAIL?.trim() || 'onboarding@resend.dev';

  if (!apiKey) {
    console.error('contact: RESEND_API_KEY is not configured');
    return json({ error: 'Email service unavailable — please email us directly.' }, 503);
  }

  const useCaseLabel = USE_CASE_LABELS[useCase];
  const subject = `B2B pilot inquiry — ${company} (${useCaseLabel})`;
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company}`,
    `Use case: ${useCaseLabel}`,
    '',
    message,
  ].join('\n');
  const html = `
    <h2>New B2B pilot inquiry</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
    <strong>Email:</strong> ${escapeHtml(email)}<br/>
    <strong>Company:</strong> ${escapeHtml(company)}<br/>
    <strong>Use case:</strong> ${escapeHtml(useCaseLabel)}</p>
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
      return json({ error: 'Could not send your inquiry — please email us directly.' }, 502);
    }
  } catch (err) {
    console.error('contact: resend delivery failed', err);
    return json({ error: 'Could not send your inquiry — please email us directly.' }, 502);
  }

  return json({ ok: true });
};
