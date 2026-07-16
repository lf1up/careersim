import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize Ghost Koenig HTML before rendering with dangerouslySetInnerHTML.
 * Ghost is a trusted CMS, but sanitizing still guards against a compromised
 * admin session injecting script tags into post content.
 */
export function sanitizeGhostHtml(html: string | null | undefined): string {
  if (!html) return '';

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'frameborder', 'allow', 'allowfullscreen'],
    ADD_TAGS: ['iframe'],
  });
}
