import Link from 'next/link';
import type { CourseCardModel } from '@/lib/student-ui';
import { PosterSurface } from './poster-surface';
import { PremiumBadge } from './premium-badge';
import { ProgressBar } from './progress-bar';

export function CourseCard({ course }: { course: CourseCardModel }) {
  const monogram = course.title
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return (
    <Link className="block h-full" href={course.href}>
      <PosterSurface className="h-full min-h-[320px]" monogram={monogram} seed={course.posterIndex}>
        <div className="flex h-full flex-col justify-between gap-8 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="font-display text-xs uppercase tracking-[0.24em] text-white/70">{course.programTitle}</p>
              <h3 className="font-display text-3xl uppercase leading-none tracking-[0.03em] text-[var(--text)]">
                {course.title}
              </h3>
            </div>
            <PremiumBadge
              label={course.accessLabel}
              tone={course.accessLabel === 'Includes premium lessons' ? 'premium' : 'accent'}
            />
          </div>

          <div className="space-y-5">
            {course.description ? <p className="max-w-sm text-sm leading-6 text-white/78">{course.description}</p> : null}
            <div className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.2em] text-white/60">
              <span>{course.lessonCount} lessons</span>
              {course.totalDurationLabel ? <span>{course.totalDurationLabel}</span> : null}
            </div>
            {course.nextLessonTitle ? (
              <div className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/72">
                Next up: {course.nextLessonTitle}
              </div>
            ) : null}
            {course.progressPercent !== null ? (
              <ProgressBar className="max-w-xs" label="Course progress" value={course.progressPercent} />
            ) : (
              <div className="text-xs uppercase tracking-[0.22em] text-white/55">Start course</div>
            )}
          </div>
        </div>
      </PosterSurface>
    </Link>
  );
}
