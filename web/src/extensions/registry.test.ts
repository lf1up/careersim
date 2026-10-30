import { describe, expect, it, vi } from 'vitest';

import {
  signedInNavItems,
  mergeNavItems,
  pluginRobotsDisallow,
  simulationHrefFor,
  simulationLabel,
} from './index';
import type { WebPlugin } from './types';

const installedPlugins = vi.hoisted((): WebPlugin[] => []);
vi.mock('@careersim/plugins', () => ({ plugins: installedPlugins }));

const plugin: WebPlugin = {
  id: 'fixture',
  navItems: [{ href: '/create', label: 'Create' }],
  simulationHref: (slug) => (slug.startsWith('fixture:') ? `/s/${slug.slice('fixture:'.length)}` : null),
  robotsDisallow: ['/create'],
};

describe('web extensions', () => {
  it('forwards installed plugin navigation after host items', () => {
    const host = [{ href: '/analytics', label: 'Analytics' }];
    expect(signedInNavItems(host)).toEqual(host);
    installedPlugins.push(plugin);
    try {
      expect(signedInNavItems(host)).toEqual([...host, ...plugin.navItems!]);
    } finally {
      installedPlugins.length = 0;
    }
  });
  it('appends plugin nav items after the host items, and adds nothing when none are installed', () => {
    expect(mergeNavItems([{ href: '/analytics', label: 'Analytics' }], [plugin])).toEqual([
      { href: '/analytics', label: 'Analytics' },
      { href: '/create', label: 'Create' },
    ]);
    expect(mergeNavItems([{ href: '/analytics', label: 'Analytics' }], [])).toEqual([
      { href: '/analytics', label: 'Analytics' },
    ]);
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
