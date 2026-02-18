import Link from 'next/link';

import { site } from '@/content/site';

export function AnnouncementBar() {
  const announcement = site.announcement;

  if (!announcement.enabled) return null;

  return (
    <div className="bg-ink px-4 py-2 text-center text-sm text-sand">
      <span>{announcement.message}</span>{' '}
      <Link className="font-semibold text-[#f5d8b9] underline decoration-[#f5d8b9]/50 underline-offset-4" href={announcement.link}>
        {announcement.linkLabel}
      </Link>
    </div>
  );
}
