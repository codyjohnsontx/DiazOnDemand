import Link from 'next/link';
import { PremiumBadge } from './premium-badge';

export function LessonRow({
  href,
  orderLabel,
  title,
  durationLabel,
  accessLabel,
  curriculumLabel,
  isCompleted,
  isCurrent,
  isNext,
}: {
  href: string;
  orderLabel: string;
  title: string;
  durationLabel: string | null;
  accessLabel: string;
  curriculumLabel?: string | null;
  isCompleted: boolean;
  isCurrent: boolean;
  isNext: boolean;
}) {
  return (
    <Link
      className={[
        'group flex items-center gap-4 rounded-[20px] border px-4 py-4 transition-all duration-300',
        isCurrent
          ? 'border-white/15 bg-white/[0.08] shadow-[0_16px_36px_rgba(0,0,0,0.28)]'
          : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.04]',
      ].join(' ')}
      href={href}
    >
      <div
        className={[
          'font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm tracking-[0.16em]',
          isCurrent ? 'border-[var(--progress)]/40 bg-[var(--progress)]/12 text-[var(--progress)]' : 'border-white/10 text-white/55',
        ].join(' ')}
      >
        {isCompleted ? 'OK' : orderLabel}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-medium text-[var(--text)]">{title}</h3>
          {isNext ? <PremiumBadge label="Up next" tone="accent" /> : null}
          {isCompleted ? <PremiumBadge label="Completed" tone="accent" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
          <span>{accessLabel}</span>
          {curriculumLabel ? <span>{curriculumLabel}</span> : null}
          {durationLabel ? <span>{durationLabel}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {durationLabel ? <span className="text-sm text-white/55">{durationLabel}</span> : null}
        <span className="text-xl text-white/45 transition-transform duration-300 group-hover:translate-x-1">▶</span>
      </div>
    </Link>
  );
}
