import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const output = new URL('../.vercel/output/static/', import.meta.url);
const homepage = await readFile(new URL('index.html', output), 'utf8');
const siteUrl = homepage.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
assert.ok(siteUrl, 'Homepage canonical URL is missing. Build landing first.');

function footer(html, pageUrl) {
  const markup = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
  assert.ok(markup, `Footer is missing on ${pageUrl}`);
  return markup
    .replace(/href="([^"]+)"/g, (_, href) => `href="${new URL(href, pageUrl).href}"`)
    .replace(/\s+/g, ' ');
}

const expected = footer(homepage, siteUrl);
assert.match(expected, /href="[^"]+\/contact"[^>]*>Contact<\/a>/, 'Contact must link to the app Contact page.');

for (const page of ['privacy', 'terms', 'security']) {
  const html = await readFile(new URL(`${page}/index.html`, output), 'utf8');
  assert.ok(footer(html, new URL(page, siteUrl)) === expected, `${page} footer differs from the homepage.`);
}
console.log('Homepage, Privacy, Terms, and Security footers match, including link destinations.');
