import type { APIRoute } from 'astro';
import { proxyContactRequest } from '../../lib/contact-proxy';

export const prerender = false;

export const GET: APIRoute = async ({ request }) =>
  proxyContactRequest(request, '/api/altcha-challenge');
