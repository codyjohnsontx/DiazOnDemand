import Link from 'next/link';
import type { ContinueWatchingItem } from '@/lib/student-ui';
import { ProgressBar } from './progress-bar';

export function ContinueRow({ item }: { item: ContinueWatchingItem }) {
  const clamped = Math.max(0, Math.min(100, Math.round(item.progressPercent)));

  return (
    <Link
      className="group flex items-center gap-4 rounded-[20px] border border-transparent px-4 py-4 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.04]"
      href={`/lesson/${item.lessonId}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--progress)]/40 bg-[var(--progress)]/8 font-display text-xs tracking-[0.08em] text-[var(--progress)]">
        {clamped}%
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-lg font-medium text-[var(--text)]">{item.lessonTitle}</h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--text-muted)]">
          <span className="truncate">{item.courseTitle}</span>
          <span className="text-white/25">/</span>
          <span>{item.programTitle}</span>
        </div>
        <ProgressBar value={item.progressPercent} />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[var(--progress)] sm:inline">
          Resume
        </span>
        <span className="text-xl text-[var(--progress)]/60 transition-transform duration-300 group-hover:translate-x-1">
          &#9654;
        </span>
      </div>
    </Link>
  );
}
