import { describe, expect, it } from 'vitest';

import {
  catalogueActions,
  mergeNavItems,
  pluginRobotsDisallow,
  simulationHrefFor,
  simulationLabel,
} from './index';
import type { WebPlugin } from './types';

const plugin: WebPlugin = {
  id: 'fixture',
  navItems: [{ href: '/create', label: 'Create' }],
  simulationHref: (slug) => (slug.startsWith('fixture:') ? `/s/${slug.slice('fixture:'.length)}` : null),
  robotsDisallow: ['/create'],
};

describe('web extensions', () => {
  it('appends plugin nav items after the host items', () => {
    expect(mergeNavItems([{ href: '/dashboard', label: 'Dashboard' }], [plugin])).toEqual([
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/create', label: 'Create' },
    ]);
  });

  it('keeps Create beside the catalogue search instead of in the navbar', () => {
    expect(catalogueActions([plugin])).toEqual([{ href: '/create', label: 'Create' }]);
    expect(catalogueActions([])).toEqual([]);
  });

  it('keeps catalogue links and lets a plugin override namespaced slugs', () => {
    expect(simulationHrefFor('behavioral-interview', [plugin])).toBe(
      '/simulations/behavioral-interview',
    );
    expect(simulationHrefFor('fixture:abc', [plugin])).toBe('/s/abc');
    expect(simulationHrefFor('a b', [])).toBe('/simulations/a%20b');
  });

  it('collects robots disallow paths and prefers a snapshot title over the slug', () => {
    expect(pluginRobotsDisallow([plugin])).toEqual(['/create']);
    expect(pluginRobotsDisallow([])).toEqual([]);
    expect(simulationLabel('fixture:abc', { title: 'My sim' })).toBe('My sim');
    expect(
      simulationLabel('fixture:abc', { catalogTitle: 'Catalogue', title: 'Mine' }),
    ).toBe('Catalogue');
    expect(simulationLabel('fixture:abc', { title: null })).toBe('fixture:abc');
  });
});
