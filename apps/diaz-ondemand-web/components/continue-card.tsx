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
    <Link className="block h-full" href={`/lesson/${item.lessonId}`}>
      <PosterSurface className="h-full min-h-[320px]" monogram={monogram} seed={item.posterIndex}>
        <div className="flex h-full flex-col justify-between">
          <div className="p-4">
            <div className="inline-flex rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/72">
              Continue watching
            </div>
          </div>

          <div className="space-y-4 rounded-t-[28px] border-t border-white/10 bg-[linear-gradient(180deg,rgba(8,9,11,0.18),rgba(8,9,11,0.92)_16%,rgba(8,9,11,0.98)_100%)] p-5">
            <ProgressBar label="Progress" value={item.progressPercent} />
            <div className="space-y-2">
              <p className="type-kicker text-white/60">{item.programTitle}</p>
              <h3 className="font-display text-[2rem] leading-[0.98] text-[var(--text)]">{item.courseTitle}</h3>
              <p className="text-base text-white/82">{item.lessonTitle}</p>
            </div>
            <span className="inline-flex text-xs uppercase tracking-[0.2em] text-white/68">Resume session</span>
          </div>
        </div>
      </PosterSurface>
    </Link>
  );
}
