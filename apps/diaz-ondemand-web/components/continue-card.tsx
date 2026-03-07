import Link from 'next/link';
import type { ContinueWatchingItem } from '@/lib/student-ui';
import { PosterSurface } from './poster-surface';
import { ProgressBar } from './progress-bar';

export function ContinueCard({ item }: { item: ContinueWatchingItem }) {
  const monogram = item.courseTitle
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return (
    <Link className="block" href={`/lesson/${item.lessonId}`}>
      <PosterSurface className="min-h-[240px]" monogram={monogram} seed={item.posterIndex}>
        <div className="flex h-full flex-col justify-between gap-8 p-5">
          <div className="space-y-3">
            <p className="font-display text-xs uppercase tracking-[0.24em] text-white/65">{item.programTitle}</p>
            <div className="space-y-2">
              <h3 className="font-display text-2xl uppercase leading-none tracking-[0.03em] text-[var(--text)]">
                {item.courseTitle}
              </h3>
              <p className="text-sm text-white/80">{item.lessonTitle}</p>
            </div>
          </div>
          <div className="space-y-3">
            <ProgressBar label="Resume lesson" value={item.progressPercent} />
            <span className="inline-flex text-xs uppercase tracking-[0.2em] text-white/70">Continue training</span>
          </div>
        </div>
      </PosterSurface>
    </Link>
  );
}
