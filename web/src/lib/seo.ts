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
  type = 'website',
  publishedTime,
  modifiedTime,
  authors,
}: {
  title: string;
  description?: string;
  path?: string;
  images?: string[];
  robots?: Metadata['robots'];
  keywords?: string[];
  /** Open Graph type — use `article` for blog posts. */
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
}): Metadata {
  const url = absoluteUrl(path);
  const resolvedImages = images.map((image) => {
    // Absolute Ghost (or other CDN) URLs pass through; relative paths
    // are resolved against SITE_URL.
    const imageUrl = /^https?:\/\//i.test(image)
      ? image
      : absoluteUrl(image);
    return {
      url: imageUrl,
      width: 1200,
      height: 630,
      alt: `${SITE_NAME} preview`,
    };
  });

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
      type,
      ...(type === 'article'
        ? {
            publishedTime,
            modifiedTime,
            authors,
          }
        : {}),
      images: resolvedImages,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: resolvedImages.map((image) => image.url),
    },
    robots,
  };
}

export function truncateDescription(value: string, maxLength = 155): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Serialize JSON-LD for inline `<script type="application/ld+json">`.
 * Escapes `<` so CMS-controlled strings cannot break out of the script tag.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
