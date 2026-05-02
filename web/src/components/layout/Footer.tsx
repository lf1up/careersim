'use client';

import { usePathname } from 'next/navigation';

import { CONTACT_EMAIL } from '@/lib/seo';

export function Footer() {
  const pathname = usePathname();
  const isSessionChatPage = /^\/sessions\/[^/]+$/.test(pathname);

  if (isSessionChatPage) return null;

  return (
    <footer className="pb-4 pt-1 text-center text-xs leading-5 text-secondary-600 dark:text-secondary-400">
      Have any questions? Send an email to{' '}
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="font-semibold text-retro-ink underline decoration-retro-accent decoration-2 underline-offset-4 dark:text-retro-accent-dark dark:decoration-retro-accent2-dark"
      >
        {CONTACT_EMAIL}
      </a>
    </footer>
  );
}
