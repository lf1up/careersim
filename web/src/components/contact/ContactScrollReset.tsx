'use client';

import { useLayoutEffect } from 'react';

export function ContactScrollReset() {
  useLayoutEffect(() => {
    // The public layout keeps this scroll container between route changes.
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  }, []);

  return null;
}
