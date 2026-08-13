import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's automatic cleanup only hooks in when the test framework exposes
// globals; with globals disabled we register it explicitly.
afterEach(cleanup);
