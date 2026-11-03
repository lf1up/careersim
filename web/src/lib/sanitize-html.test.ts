// @vitest-environment node
import { expect, it } from 'vitest';
import { sanitizeGhostHtml } from './sanitize-html';

it('enforces the iframe allowlist during server rendering without a global browser Element', () => {
  expect(sanitizeGhostHtml('<iframe src="https://untrusted.example/embed"></iframe>')).not.toContain('<iframe');
  const html = sanitizeGhostHtml('<iframe src="https://www.youtube.com/embed/example" srcdoc="unsafe"></iframe>');
  expect(html).toContain('src="https://www.youtube.com/embed/example"');
  expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
  expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  expect(html).not.toContain('srcdoc');
});

it('removes scripts, event handlers and javascript URLs from server-rendered CMS HTML', () => {
  const html = sanitizeGhostHtml('<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">link</a>');
  expect(html).not.toMatch(/<script|onerror|javascript:/);
});
