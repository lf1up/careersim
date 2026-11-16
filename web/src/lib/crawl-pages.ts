import type { MetadataRoute } from 'next';
import type { Simulation } from './types';
import { isBlogEnabled } from './blog';
import { isPricingEnabled } from './pricing';

type CrawlPage = {
  path: string;
  title: string;
  description: string;
  group: 'core' | 'legal';
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
};

const landingPages: CrawlPage[] = [
  { path: '/', title: 'Home', description: 'AI career conversation practice and feedback.', group: 'core', changeFrequency: 'weekly', priority: 1 },
  { path: '/business', title: 'For business', description: 'Custom AI personas for team training, support practice, and content.', group: 'core', changeFrequency: 'weekly', priority: 0.85 },
  { path: '/privacy', title: 'Privacy policy', description: 'How practice data is collected, used, and protected.', group: 'legal', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', title: 'Terms of service', description: 'Rules for using the service, acceptable use, and AI-generated output.', group: 'legal', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/security', title: 'Security', description: 'How accounts and transcripts are protected and how to report a vulnerability.', group: 'legal', changeFrequency: 'yearly', priority: 0.3 },
];

/** Pages served by this web deployment, including its optional landing proxy. */
export function publicCrawlPages(): CrawlPage[] {
  return [
    ...(process.env.LANDING_ORIGIN?.trim() ? landingPages : []),
    { path: '/simulations', title: 'Simulation catalog', description: 'Browse public AI career simulations.', group: 'core', changeFrequency: 'daily', priority: 0.9 },
    { path: '/contact', title: 'Contact us', description: 'Questions, support, and requests for higher practice limits.', group: 'core', changeFrequency: 'monthly', priority: 0.6 },
    { path: '/register', title: 'Create account', description: 'Create an account to start practicing.', group: 'core', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/login', title: 'Sign in', description: 'Sign in to continue practicing.', group: 'core', changeFrequency: 'monthly', priority: 0.5 },
    ...(isPricingEnabled() ? [{ path: '/pricing', title: 'Pricing', description: 'Compare Free, Plus, and Supporter plans and practice allowances.', group: 'core' as const, changeFrequency: 'monthly' as const, priority: 0.8 }] : []),
    ...(isBlogEnabled() ? [{ path: '/blog', title: 'Blog', description: 'Guides and practice tips for career conversations.', group: 'core' as const, changeFrequency: 'daily' as const, priority: 0.8 }] : []),
  ];
}

export const PRIVATE_CRAWL_PATHS = [
  '/dashboard', '/profile', '/analytics', '/sessions',
  '/forgot-password', '/reset-password', '/auth/', '/api/',
] as const;

/** Namespaced creator/share simulations are private, even if a source includes one. */
export function crawlableSimulations(simulations: readonly Simulation[]): Simulation[] {
  return [...new Map(simulations
    .filter(simulation => simulation.slug && !simulation.slug.includes(':'))
    .map(simulation => [simulation.slug, simulation])).values()];
}
