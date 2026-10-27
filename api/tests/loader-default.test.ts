import { describe, expect, it, vi } from 'vitest';

import { loadInstalledPlugins } from '../src/extensions/loader.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: () => false };
});

describe('loadInstalledPlugins default directory', () => {
  it('returns no plugins when that directory is absent', async () => {
    await expect(loadInstalledPlugins()).resolves.toEqual([]);
  });
});
