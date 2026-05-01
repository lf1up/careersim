import type { MailMessage } from '../../plugins/mailer.js';

function shell(
  productName: string,
  title: string,
  body: string,
  cta?: { label: string; url: string },
): string {
  return `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; background: #f5f1e8; padding: 24px; color: #1a1a1a;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border: 2px solid #000; box-shadow: 4px 4px 0 #000; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${escapeHtml(title)}</h1>
      ${body}
      ${
        cta
          ? `<p style="margin: 24px 0 0;"><a href="${escapeAttr(cta.url)}" style="display: inline-block; background: #ffd966; color: #1a1a1a; border: 2px solid #000; padding: 10px 16px; text-decoration: none; font-weight: 600;">${escapeHtml(cta.label)}</a></p>
             <p style="margin: 16px 0 0; font-size: 12px; color: #666;">If the button doesn't work, paste this link into your browser:<br/><span style="word-break: break-all;">${escapeHtml(cta.url)}</span></p>`
          : ''
      }
      <p style="margin: 24px 0 0; font-size: 12px; color: #666;">— ${escapeHtml(productName)}</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export function verifyEmailMail(
  email: string,
  code: string,
  productName: string,
): MailMessage {
  const subject = `Your ${productName} confirmation code: ${code}`;
  const text = `Welcome to ${productName}!

Your 6-digit confirmation code is: ${code}

It expires in 10 minutes. If you didn't start a signup, you can safely ignore this email.`;
  const html = shell(
    productName,
    'Confirm your email',
    `<p>Welcome to ${escapeHtml(productName)}! Enter this 6-digit code to finish creating your account:</p>
     <p style="font-size: 28px; letter-spacing: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 16px 0; padding: 12px; border: 2px solid #000; background: #fffbe6; text-align: center;">${escapeHtml(
       code,
     )}</p>
     <p style="margin: 0; font-size: 13px; color: #555;">The code expires in 10 minutes. If you didn't request it, ignore this email.</p>`,
  );
  return { to: email, subject, text, html };
}

export function loginLinkMail(
  email: string,
  url: string,
  productName: string,
): MailMessage {
  const subject = `Your ${productName} sign-in link`;
  const text = `Click the link below to sign in to ${productName}:

${url}

It expires in 60 minutes. If you didn't request it, ignore this email.`;
  const html = shell(
    productName,
    'Sign in to ' + productName,
    `<p>Click the button below to sign in. The link expires in 60 minutes and can only be used once.</p>`,
    { label: 'Sign in', url },
  );
  return { to: email, subject, text, html };
}

export function resetPasswordMail(
  email: string,
  url: string,
  productName: string,
): MailMessage {
  const subject = `Reset your ${productName} password`;
  const text = `A password reset was requested for your ${productName} account.

Open the link below to choose a new password:

${url}

It expires in 30 minutes. If you didn't request this, your account is still safe — just ignore this email.`;
  const html = shell(
    productName,
    'Reset your password',
    `<p>A password reset was requested for your ${escapeHtml(productName)} account. Click the button below to choose a new password. The link expires in 30 minutes.</p>
     <p style="margin: 16px 0 0; font-size: 13px; color: #555;">If you didn't request this, ignore this email — your current password stays in effect.</p>`,
    { label: 'Reset password', url },
  );
  return { to: email, subject, text, html };
}

export function changeEmailMail(
  newEmail: string,
  code: string,
  productName: string,
): MailMessage {
  const subject = `Confirm your new ${productName} email: ${code}`;
  const text = `We received a request to change a ${productName} account's email to this address.

Your 6-digit confirmation code is: ${code}

It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = shell(
    productName,
    'Confirm your new email',
    `<p>We received a request to change a ${escapeHtml(productName)} account's email to this address. Enter this code back in the app to finish the change:</p>
     <p style="font-size: 28px; letter-spacing: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 16px 0; padding: 12px; border: 2px solid #000; background: #fffbe6; text-align: center;">${escapeHtml(
       code,
     )}</p>
     <p style="margin: 0; font-size: 13px; color: #555;">The code expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
  );
  return { to: newEmail, subject, text, html };
}
