import GhostContentAPI, {
  type Author,
  type GhostAPI,
  type Pagination,
  type PostOrPage,
  type Tag,
  type Tags,
} from '@tryghost/content-api';

export type GhostPost = PostOrPage;
export type GhostTag = Tag;
export type GhostAuthor = Author;

const PAGE_SIZE = 100;

function getGhostConfig(): { url: string; key: string } | null {
  const url = process.env.GHOST_API_URL?.trim().replace(/\/$/, '');
  const key = process.env.GHOST_CONTENT_API_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

function getApi(): GhostAPI | null {
  const config = getGhostConfig();
  if (!config) return null;

  return GhostContentAPI({
    url: config.url,
    key: config.key,
    // Ghost 6 Content API; the JS client still accepts the v5.0 pin.
    version: 'v5.0',
  });
}

export function isGhostConfigured(): boolean {
  return getGhostConfig() !== null;
}

export async function getPosts({
  page = 1,
  limit = 12,
}: {
  page?: number;
  limit?: number;
} = {}): Promise<{ posts: GhostPost[]; pagination: Pagination | null }> {
  const api = getApi();
  if (!api) {
    return { posts: [], pagination: null };
  }

  try {
    const result = await api.posts.browse({
      limit,
      page,
      include: ['tags', 'authors'],
      order: 'published_at DESC',
    });

    return {
      posts: [...result],
      pagination: result.meta?.pagination ?? null,
    };
  } catch (error) {
    console.error('[ghost] getPosts failed:', error);
    return { posts: [], pagination: null };
  }
}

export async function getPostBySlug(slug: string): Promise<GhostPost | null> {
  const api = getApi();
  if (!api || !slug) return null;

  try {
    return await api.posts.read(
      { slug },
      { include: ['tags', 'authors'] },
    );
  } catch (error) {
    // Ghost throws when the slug is missing — treat as not found.
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      (error as { response?: { status?: number } }).response?.status === 404
    ) {
      return null;
    }
    console.error(`[ghost] getPostBySlug(${slug}) failed:`, error);
    return null;
  }
}

export async function getAllPosts(): Promise<GhostPost[]> {
  const api = getApi();
  if (!api) return [];

  const allPosts: GhostPost[] = [];
  let page: number | null = 1;

  try {
    while (page) {
      const result = await api.posts.browse({
        limit: PAGE_SIZE,
        page,
        include: ['tags', 'authors'],
        order: 'published_at DESC',
      });

      if (!result?.length) break;
      allPosts.push(...result);
      page = result.meta?.pagination?.next ?? null;
    }

    return allPosts;
  } catch (error) {
    console.error('[ghost] getAllPosts failed:', error);
    return allPosts;
  }
}

export async function getAllPostSlugs(): Promise<string[]> {
  const api = getApi();
  if (!api) return [];

  const allSlugs: string[] = [];
  let page: number | null = 1;

  try {
    while (page) {
      const result = await api.posts.browse({
        limit: PAGE_SIZE,
        page,
        fields: ['slug'],
      });

      if (!result?.length) break;
      allSlugs.push(
        ...result
          .map((post: GhostPost) => post.slug)
          .filter((slug): slug is string => Boolean(slug)),
      );
      page = result.meta?.pagination?.next ?? null;
    }

    return allSlugs;
  } catch (error) {
    console.error('[ghost] getAllPostSlugs failed:', error);
    return allSlugs;
  }
}

export async function getTags(): Promise<GhostTag[]> {
  const api = getApi();
  if (!api) return [];

  try {
    const tags: Tags = await api.tags.browse({
      limit: PAGE_SIZE,
      include: ['count.posts'],
    });
    return [...tags];
  } catch (error) {
    console.error('[ghost] getTags failed:', error);
    return [];
  }
}
