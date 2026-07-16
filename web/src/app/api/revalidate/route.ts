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
 * Ghost posts a JSON body that includes `post.current.slug` (or
 * `post.previous.slug` on delete). We revalidate the index and the slug
 * path when present.
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

  let slug: string | undefined;
  try {
    const body = (await request.json()) as {
      post?: {
        current?: { slug?: string };
        previous?: { slug?: string };
      };
    };
    slug = body.post?.current?.slug || body.post?.previous?.slug;
  } catch {
    // Ghost may send an empty body for some events; still revalidate the index.
  }

  revalidatePath('/blog');
  if (slug) {
    revalidatePath(`/blog/${slug}`);
  }
  // Keep the sitemap fresh so newly published posts are discoverable quickly.
  revalidatePath('/sitemap.xml');

  return NextResponse.json({
    revalidated: true,
    paths: ['/blog', ...(slug ? [`/blog/${slug}`] : []), '/sitemap.xml'],
  });
}
