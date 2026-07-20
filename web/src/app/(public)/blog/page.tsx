import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RetroBadge } from '@/components/ui/RetroBadge';
import { RetroCard } from '@/components/ui/RetroCard';
import { isBlogEnabled } from '@/lib/blog';
import { getPosts } from '@/lib/ghost';
import { absoluteUrl, metadataFor, serializeJsonLd, SITE_NAME } from '@/lib/seo';

export const revalidate = 3600;

export function generateMetadata(): Metadata {
  if (!isBlogEnabled()) {
    return metadataFor({
      title: 'Blog',
      path: '/blog',
      robots: { index: false, follow: false },
    });
  }

  return metadataFor({
    title: 'Career skills blog',
    description:
      'Guides, frameworks, and practice tips for interviews, workplace conversations, feedback, and professional growth — from the CareerSIM team.',
    path: '/blog',
    keywords: [
      'career skills blog',
      'interview preparation tips',
      'workplace communication',
      'career coaching articles',
    ],
  });
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function BlogIndexPage() {
  if (!isBlogEnabled()) notFound();

  const { posts } = await getPosts({ page: 1, limit: 24 });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd({
            '@context': 'https://schema.org',
            '@type': 'Blog',
            name: `${SITE_NAME} blog`,
            url: absoluteUrl('/blog'),
            description:
              'Guides and practice tips for career-defining conversations.',
            blogPost: posts.map((post) => ({
              '@type': 'BlogPosting',
              headline: post.title,
              url: absoluteUrl(`/blog/${post.slug}`),
              datePublished: post.published_at ?? undefined,
              dateModified: post.updated_at ?? undefined,
              description: post.excerpt ?? post.custom_excerpt ?? undefined,
            })),
          }),
        }}
      />

      <div className="space-y-6 pb-3 sm:mr-[-5px] sm:pb-4 retro-fade-in">
        <div>
          <h1 className="text-2xl sm:text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
            Career skills blog
          </h1>
          <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
            Practical guides for interviews, workplace conversations, and the
            career moments that matter — written to pair with hands-on practice
            in CareerSIM.
          </p>
        </div>

        {posts.length === 0 ? (
          <RetroCard>
            <p className="text-sm text-secondary-600 dark:text-secondary-400">
              No posts published yet. Check back soon.
            </p>
          </RetroCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 retro-stagger">
            {posts.map((post) => {
              const published = formatDate(post.published_at);
              const tags = (post.tags ?? []).filter(
                (tag) => tag.name && tag.slug,
              );
              const author = post.primary_author?.name || post.authors?.[0]?.name;
              const excerpt = post.custom_excerpt || post.excerpt;

              return (
                <Link
                  key={post.id ?? post.slug}
                  href={`/blog/${encodeURIComponent(post.slug!)}`}
                  className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
                >
                  <RetroCard
                    className="flex flex-col h-full retro-card-interactive"
                    bodyClassName="flex-1 flex flex-col"
                    title={post.title ?? 'Untitled'}
                    subtitle={
                      <span className="font-monoRetro">
                        {post.slug}
                      </span>
                    }
                  >
                    {post.feature_image ? (
                      <div className="relative mb-6 aspect-[16/9] w-full overflow-hidden border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2 bg-secondary-100 dark:bg-secondary-900">
                        <Image
                          src={post.feature_image}
                          alt={post.feature_image_alt || post.title || ''}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                        />
                      </div>
                    ) : (
                      <div className="mb-6 flex aspect-[16/9] w-full items-center justify-center border-2 border-dashed border-black dark:border-retro-ink-dark bg-retro-paper dark:bg-retro-surface-dark">
                        <span className="font-retro text-[10px] tracking-wider2 text-secondary-500 dark:text-secondary-400">
                          NO IMAGE
                        </span>
                      </div>
                    )}

                    <div className="flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {published && (
                          <RetroBadge color="default">{published}</RetroBadge>
                        )}
                        {typeof post.reading_time === 'number' &&
                          post.reading_time > 0 && (
                            <RetroBadge color="cyan">
                              {post.reading_time} min
                            </RetroBadge>
                          )}
                        {author && (
                          <RetroBadge color="purple">{author}</RetroBadge>
                        )}
                      </div>

                      {excerpt && (
                        <p className="text-sm text-retro-ink dark:text-retro-ink-dark line-clamp-3">
                          {excerpt}
                        </p>
                      )}

                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {tags.slice(0, 5).map((tag) => (
                            <span
                              key={tag.id ?? tag.slug}
                              className="text-[11px] font-monoRetro text-secondary-600 dark:text-secondary-400"
                            >
                              #{tag.slug}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex items-center justify-end gap-2 text-xs font-semibold tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
                      <span>READ POST</span>
                      <span aria-hidden className="text-base">
                        →
                      </span>
                    </div>
                  </RetroCard>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
