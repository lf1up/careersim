import type { Metadata } from 'next';

import { Providers } from '@/components/layout/Providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'CareerSIM',
  description: 'Practice conversations with AI-driven career simulations.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
