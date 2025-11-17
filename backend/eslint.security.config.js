import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import securityNode from 'eslint-plugin-security-node';
import globals from 'globals/index.js';

export default [
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.spec.ts',
      'src/**/*.test.ts',
      'src/tests/**'
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'security': security,
      'security-node': securityNode
    },
    rules: {
      // Security-focused rules
      'security/detect-object-injection': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-bidi-characters': 'error',
      
      // Security-node specific rules  
      'security-node/detect-crlf': 'warn', // Changed from error to warn for development logging
      'security-node/detect-absence-of-name-option-in-exrpress-session': 'error',
      'security-node/detect-buffer-unsafe-allocation': 'error',
      'security-node/detect-runinthiscontext-method-in-nodes-vm': 'error',
      'security-node/detect-sql-injection': 'error',
      'security-node/detect-nosql-injection': 'error',
      'security-node/detect-eval-with-expr': 'error',
      'security-node/detect-html-injection': 'error',
      'security-node/detect-insecure-randomness': 'error',
    }
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      '**/*.js',
      '**/*.d.ts'
    ]
  }
];