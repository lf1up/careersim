import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { isBlogEnabled } from '@/lib/blog';

/**
 * Ghost publish/update webhook → on-demand ISR.
 *
 * Configure in Ghost Admin → Integrations → (your custom integration) →
 * Webhooks:
 *   - Event: Post published / Post updated / Post deleted
 *   - Target URL: https://<site>/api/revalidate?secret=<GHOST_WEBHOOK_SECRET>
 *
 * Ghost posts a JSON body that includes `post.current.slug` and, on rename
 * or delete, `post.previous.slug`. We revalidate the index and every unique
 * slug path when present.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isBlogEnabled()) {
    return NextResponse.json(
      { error: 'Blog is disabled (NEXT_PUBLIC_BLOG_ENABLED=false)' },
      { status: 503 },
    );
  }

  const secret = process.env.GHOST_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'GHOST_WEBHOOK_SECRET is not configured' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const slugs = new Set<string>();
  try {
    const body = (await request.json()) as {
      post?: {
        current?: { slug?: string };
        previous?: { slug?: string };
      };
    };
    const current = body.post?.current?.slug?.trim();
    const previous = body.post?.previous?.slug?.trim();
    if (current) slugs.add(current);
    if (previous) slugs.add(previous);
  } catch {
    // Ghost may send an empty body for some events; still revalidate the index.
  }

  revalidatePath('/blog');
  for (const slug of slugs) {
    revalidatePath(`/blog/${slug}`);
  }
  // Keep the sitemap fresh so newly published posts are discoverable quickly.
  revalidatePath('/sitemap.xml');

  const slugPaths = [...slugs].map((slug) => `/blog/${slug}`);
  return NextResponse.json({
    revalidated: true,
    paths: ['/blog', ...slugPaths, '/sitemap.xml'],
  });
}
