import type { MetadataRoute } from 'next';

import { site } from '@/content/site';

const routes = ['', '/programs', '/schedule', '/coaches', '/pricing', '/contact', '/faq', '/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${site.url}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.7,
  }));
}
