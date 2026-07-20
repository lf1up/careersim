import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize Ghost Koenig HTML before rendering with dangerouslySetInnerHTML.
 * Ghost is a trusted CMS, but sanitizing still guards against a compromised
 * admin session injecting script tags into post content.
 */

/** Hosts allowed for iframe embeds (HTTPS only). */
const ALLOWED_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
]);

const IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation';
const IFRAME_REFERRER_POLICY = 'strict-origin-when-cross-origin';
const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

function isAllowedIframeSrc(src: string | null): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && ALLOWED_IFRAME_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

let hooksRegistered = false;

function ensureSanitizeHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'iframe') return;
    if (!('getAttribute' in node) || typeof node.getAttribute !== 'function') {
      return;
    }

    const src = node.getAttribute('src');
    if (!isAllowedIframeSrc(src)) {
      node.parentNode?.removeChild(node);
      return;
    }

    node.setAttribute('sandbox', IFRAME_SANDBOX);
    node.setAttribute('referrerpolicy', IFRAME_REFERRER_POLICY);
    node.setAttribute('allow', IFRAME_ALLOW);
  });
}

export function sanitizeGhostHtml(html: string | null | undefined): string {
  if (!html) return '';

  ensureSanitizeHooks();

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      'target',
      'rel',
      'frameborder',
      'allow',
      'allowfullscreen',
      'sandbox',
      'referrerpolicy',
    ],
    ADD_TAGS: ['iframe'],
  });
}
