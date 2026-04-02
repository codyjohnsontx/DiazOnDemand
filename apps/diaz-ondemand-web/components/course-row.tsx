import Link from 'next/link';
import type { CourseCardModel } from '@/lib/student-ui';
import { PremiumBadge } from './premium-badge';
import { ProgressBar } from './progress-bar';

export function CourseRow({ course }: { course: CourseCardModel }) {
  return (
    <Link
      className="group flex items-center gap-4 rounded-[20px] border border-transparent px-4 py-4 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.04]"
      href={course.href}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 font-display text-sm tracking-[0.16em] text-white/55">
        {course.lessonCount}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-lg font-medium text-[var(--text)]">{course.title}</h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--text-muted)]">
          <span className="truncate">{course.programTitle}</span>
          <span className="text-white/25">/</span>
          <span>{course.disciplineLabel}</span>
        </div>
        {course.progressPercent !== null ? (
          <ProgressBar value={course.progressPercent} />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {course.accessLabel === 'Includes premium lessons' ? (
          <PremiumBadge label="Premium" tone="premium" />
        ) : null}
        {course.isFeaturedDemo ? (
          <PremiumBadge label="Demo" tone="accent" />
        ) : null}
        <span className="hidden text-sm text-white/55 sm:inline">
          {course.totalDurationLabel ?? `${course.lessonCount} lessons`}
        </span>
        <span className="text-xl text-white/45 transition-transform duration-300 group-hover:translate-x-1">
          &#9654;
        </span>
      </div>
    </Link>
  );
}
