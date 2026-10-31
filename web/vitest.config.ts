import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const pluginsInstalled = fileURLToPath(
  new URL('./src/extensions/installed/index.ts', import.meta.url),
);
const pluginsEmpty = fileURLToPath(new URL('./src/extensions/empty.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@careersim/plugins': existsSync(pluginsInstalled) ? pluginsInstalled : pluginsEmpty,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
