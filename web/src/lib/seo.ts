import type { Metadata } from 'next';

export const SITE_NAME =
  process.env.NEXT_PUBLIC_SITE_NAME?.trim() || 'careersim.local';
export const SITE_DESCRIPTION =
  process.env.NEXT_PUBLIC_SITE_DESCRIPTION?.trim() ||
  'Practice career conversations with AI simulations for interviews, workplace scenarios, feedback, and professional growth.';
export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'hello@careersim.local';

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
  'https://careersim.local';

export const SITE_URL = rawSiteUrl.replace(/\/$/, '');

export function absoluteUrl(path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath}`;
}

export function metadataFor({
  title,
  description = SITE_DESCRIPTION,
  path = '/',
  images = ['/opengraph-image'],
  robots,
  keywords,
}: {
  title: string;
  description?: string;
  path?: string;
  images?: string[];
  robots?: Metadata['robots'];
  keywords?: string[];
}): Metadata {
  const url = absoluteUrl(path);

  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: 'website',
      images: images.map((image) => ({
        url: absoluteUrl(image),
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} preview`,
      })),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images.map((image) => absoluteUrl(image)),
    },
    robots,
  };
}

export function truncateDescription(value: string, maxLength = 155): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
