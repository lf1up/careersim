import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/auth/AltchaWidget', () => ({ AltchaWidget: () => null }));

import ContactPage from './page';

it('opens Contact at the top of the shared scroll container without resetting later scrolling', async () => {
  const main = document.createElement('main');
  document.body.append(main);
  main.scrollTop = 600;

  const page = await ContactPage({ searchParams: Promise.resolve({ reason: 'higher-limits' }) });
  const view = render(page, { container: main });

  expect(main.scrollTop).toBe(0);
  expect(document.activeElement).toBe(document.body);

  main.scrollTop = 200;
  view.rerender(await ContactPage({ searchParams: Promise.resolve({ reason: 'general' }) }));
  expect(main.scrollTop).toBe(200);
});
