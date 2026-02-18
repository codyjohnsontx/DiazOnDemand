import type { Metadata } from 'next';

import { site } from '@/content/site';

const defaultImage = '/og-default.svg';

export function pageMetadata({
  title,
  description,
  path = '/',
}: {
  title: string;
  description: string;
  path?: string;
}): Metadata {
  const fullTitle = `${title} | ${site.name}`;
  const url = new URL(path, site.url).toString();

  return {
    title: fullTitle,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: site.name,
      type: 'website',
      images: [{ url: defaultImage, alt: `${site.name} preview` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [defaultImage],
    },
  };
}
