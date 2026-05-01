import type { ReactNode } from 'react';
import type { Metadata } from 'next';

import { SITE_NAME } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Session | ${SITE_NAME}`,
};

export default function SessionDetailLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
