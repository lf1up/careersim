// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { apiBaseUrl, apiClient } from './api';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('uses the internal API URL when rendering on the server', () => {
  vi.stubEnv('API_INTERNAL_URL', 'http://api:8000/v1/');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/v1');
  expect(apiBaseUrl()).toBe('http://api:8000/v1');
});

it('keeps the browser on the public API URL', () => {
  vi.stubGlobal('window', {});
  vi.stubEnv('API_INTERNAL_URL', 'http://api:8000/v1');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/v1');
  expect(apiBaseUrl()).toBe('http://localhost:8000/v1');
});

it('builds avatar image URLs from the public origin on server and client', () => {
  vi.stubEnv('API_INTERNAL_URL', 'http://api:8000/v1/');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/v1');
  const server = apiClient.personaAvatarUrl('/personas/brenda/avatar');
  vi.stubGlobal('window', {});
  const client = apiClient.personaAvatarUrl('/personas/brenda/avatar');
  expect(server).toBe('http://localhost:8000/v1/personas/brenda/avatar');
  expect(client).toBe(server);
});
