import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { RetroBadge } from '@/components/ui/RetroBadge';
import { RetroCard } from '@/components/ui/RetroCard';
import { isBlogEnabled } from '@/lib/blog';
import { getAllPostSlugs, getPostBySlug } from '@/lib/ghost';
import { sanitizeGhostHtml } from '@/lib/sanitize-html';
import {
  absoluteUrl,
  metadataFor,
  serializeJsonLd,
  SITE_NAME,
  truncateDescription,
} from '@/lib/seo';

import '../ghost-content.css';

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  if (!isBlogEnabled()) return [];
  const slugs = await getAllPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;

  if (!isBlogEnabled()) {
    return metadataFor({
      title: 'Blog',
      path: `/blog/${slug}`,
      robots: { index: false, follow: false },
    });
  }

  const post = await getPostBySlug(slug);

  if (!post) {
    return metadataFor({
      title: 'Post not found',
      description: 'This blog post could not be found.',
      path: `/blog/${slug}`,
      robots: { index: false, follow: false },
    });
  }

  const description = truncateDescription(
    post.custom_excerpt || post.excerpt || post.title || SITE_NAME,
  );
  const authors = (post.authors ?? [])
    .map((author) => author.name)
    .filter((name): name is string => Boolean(name));
  const images = post.feature_image
    ? [post.feature_image]
    : ['/opengraph-image'];

  return metadataFor({
    title: post.title || 'Blog post',
    description,
    path: `/blog/${post.slug}`,
    images,
    type: 'article',
    publishedTime: post.published_at ?? undefined,
    modifiedTime: post.updated_at ?? undefined,
    authors: authors.length > 0 ? authors : undefined,
    keywords: (post.tags ?? [])
      .map((tag) => tag.name)
      .filter((name): name is string => Boolean(name)),
  });
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function BlogPostPage({ params }: PageProps) {
  if (!isBlogEnabled()) notFound();

  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) notFound();

  const html = sanitizeGhostHtml(post.html);
  const published = formatDate(post.published_at);
  const authors = (post.authors ?? []).filter((author) => author.name);
  const tags = (post.tags ?? []).filter((tag) => tag.name && tag.slug);
  const primaryAuthor = authors[0];
  const excerpt = post.custom_excerpt || post.excerpt;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd({
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description:
              post.custom_excerpt || post.excerpt || post.title || undefined,
            url: absoluteUrl(`/blog/${post.slug}`),
            datePublished: post.published_at ?? undefined,
            dateModified: post.updated_at ?? post.published_at ?? undefined,
            image: post.feature_image ? [post.feature_image] : undefined,
            author: authors.map((author) => ({
              '@type': 'Person',
              name: author.name,
              url: author.website || undefined,
            })),
            publisher: {
              '@type': 'Organization',
              name: SITE_NAME,
              url: absoluteUrl('/'),
            },
            mainEntityOfPage: {
              '@type': 'WebPage',
              '@id': absoluteUrl(`/blog/${post.slug}`),
            },
          }),
        }}
      />

      <article className="max-w-4xl mx-auto space-y-6 pt-2 pb-3 sm:pt-0 sm:pb-4 retro-fade-in">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/blog">
            <Button variant="ghost" size="sm">
              ← All posts
            </Button>
          </Link>
          <span className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
            {post.slug}
          </span>
        </div>

        <RetroCard>
          <div className="space-y-5">
            {post.feature_image ? (
              <div className="relative aspect-[16/9] w-full overflow-hidden border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2 bg-secondary-100 dark:bg-secondary-900">
                <Image
                  src={post.feature_image}
                  alt={post.feature_image_alt || post.title || ''}
                  fill
                  priority
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 768px"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-semibold text-retro-ink dark:text-retro-ink-dark">
                {post.title}
              </h1>
              <p className="text-sm font-monoRetro text-secondary-600 dark:text-secondary-400">
                {primaryAuthor?.name ? (
                  <>
                    by{' '}
                    <span className="font-semibold text-retro-ink dark:text-retro-ink-dark">
                      {primaryAuthor.name}
                    </span>
                    {published ? ' · ' : null}
                  </>
                ) : null}
                {published ? (
                  <time dateTime={post.published_at ?? undefined}>
                    {published}
                  </time>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {typeof post.reading_time === 'number' &&
                post.reading_time > 0 && (
                  <RetroBadge color="cyan">
                    {post.reading_time} min read
                  </RetroBadge>
                )}
              {tags.map((tag) => (
                <RetroBadge key={tag.id ?? tag.slug} color="teal">
                  {tag.name}
                </RetroBadge>
              ))}
            </div>

            {excerpt ? (
              <div className="border-l-4 border-black dark:border-retro-ink-dark pl-4 py-1 bg-retro-paper dark:bg-retro-surface-dark/40">
                <p className="text-[10px] font-semibold tracking-wider2 text-secondary-600 dark:text-secondary-400 mb-1">
                  SUMMARY
                </p>
                <p className="text-sm text-retro-ink dark:text-retro-ink-dark">
                  {excerpt}
                </p>
              </div>
            ) : null}
          </div>
        </RetroCard>

        <RetroCard title="Article" titleAs="h2">
          {html ? (
            <div
              className="ghost-content"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="text-sm text-secondary-600 dark:text-secondary-400">
              This post has no content yet.
            </p>
          )}
        </RetroCard>

        <RetroCard title="Practice what you learned" titleAs="h2">
          <p className="text-sm text-retro-ink dark:text-retro-ink-dark mb-4">
            Reading helps — rehearsing seals it in. Jump into an AI career
            simulation and try the skills from this post in a live conversation.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/simulations">
              <Button variant="primary">Browse simulations</Button>
            </Link>
            <Link href="/blog">
              <Button variant="outline">More posts</Button>
            </Link>
          </div>
        </RetroCard>
      </article>
    </>
  );
}
