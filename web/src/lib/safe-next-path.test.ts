import { expect, it } from 'vitest';
import { safeNextPath } from './safe-next-path';

it.each(['/\\evil.example', '/\tevil.example', '/\t/evil.example', '/\n/evil.example', '//evil.example', 'https://evil.example'])('rejects unsafe redirect target %j', (value) => {
  expect(safeNextPath(value, '/dashboard')).toBe('/dashboard');
});

it('preserves valid in-app destinations including query strings and fragments', () => {
  expect(safeNextPath('/create?id=123#results', '/dashboard')).toBe('/create?id=123#results');
  expect(safeNextPath(null, '/dashboard')).toBe('/dashboard');
});
