import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,jsx,ts,tsx,mdx}',
    './src/app/**/*.{js,jsx,ts,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        retro: {
          paper: '#fffdf5',
          surface: '#ffffff',
          ink: '#111827',
          muted: '#e5e7eb',
          accent: '#fbbf24',
          accent2: '#22d3ee',
          'paper-dark': '#1a1a1a',
          'surface-dark': '#262626',
          'ink-dark': '#f5f5f5',
          'muted-dark': '#404040',
          'accent-dark': '#f59e0b',
          'accent2-dark': '#06b6d4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        retro: ['"Press Start 2P"', 'system-ui', 'sans-serif'],
        monoRetro: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      letterSpacing: {
        wider2: '0.08em',
      },
      boxShadow: ({ theme }) => ({
        'retro-1': `1px 1px 0 ${theme('colors.retro.ink')}`,
        'retro-2': `2px 2px 0 ${theme('colors.retro.ink')}`,
        'retro-3': `3px 3px 0 ${theme('colors.retro.ink')}`,
        'retro-4': `4px 4px 0 ${theme('colors.retro.ink')}`,
        'retro-y-4': `0 4px 0 ${theme('colors.retro.ink')}`,
        'retro-x-4': `4px 0 0 ${theme('colors.retro.ink')}`,
        'retro-dark-1': `1px 1px 0 ${theme('colors.retro.ink-dark')}`,
        'retro-dark-2': `2px 2px 0 ${theme('colors.retro.ink-dark')}`,
        'retro-dark-3': `3px 3px 0 ${theme('colors.retro.ink-dark')}`,
        'retro-dark-4': `4px 4px 0 ${theme('colors.retro.ink-dark')}`,
        'retro-dark-y-4': `0 4px 0 ${theme('colors.retro.ink-dark')}`,
        'retro-dark-x-4': `4px 0 0 ${theme('colors.retro.ink-dark')}`,
      }),
    },
  },
  plugins: [],
};

export default config;
