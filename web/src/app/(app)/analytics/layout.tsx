import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analytics',
};

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return children;
}
