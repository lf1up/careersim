import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.VITE_PORT || '3000'),
    open: false, // Don't automatically open browser
  },
  build: {
    outDir: 'build',
    sourcemap: true,
  },
  css: {
    postcss: './postcss.config.js',
  },
})