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
      <PosterSurface className="h-full min-h-[360px]" monogram={monogram} seed={course.posterIndex}>
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <PremiumBadge label={course.disciplineLabel} />
              {course.isFeaturedDemo ? <PremiumBadge label="Demo" tone="accent" /> : null}
            </div>
            <PremiumBadge
              label={course.accessLabel}
              tone={course.accessLabel === 'Includes premium lessons' ? 'premium' : 'accent'}
            />
          </div>

          <div className="space-y-4 rounded-t-[28px] border-t border-white/10 bg-[linear-gradient(180deg,rgba(8,9,11,0.18),rgba(8,9,11,0.92)_16%,rgba(8,9,11,0.98)_100%)] p-5 sm:p-6">
            {course.progressPercent !== null ? (
              <ProgressBar label="Progress" value={course.progressPercent} />
            ) : (
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-white/60">
                <span>Ready to start</span>
                <span>{course.lessonCount} lessons</span>
              </div>
            )}

            <div className="space-y-2">
              <p className="type-kicker text-white/60">{course.programTitle}</p>
              <h3 className="font-display text-[2rem] leading-[0.98] text-[var(--text)]">{course.title}</h3>
            </div>

            <div className="space-y-3">
              {course.description ? <p className="type-meta text-white/78">{course.description}</p> : null}
              <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-white/58">
                <span>{course.lessonCount} lessons</span>
                {course.totalDurationLabel ? <span>{course.totalDurationLabel}</span> : null}
              </div>
            </div>

            {course.nextLessonTitle ? (
              <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
                <p className="type-kicker text-white/50">Up next</p>
                <p className="mt-2 text-base text-white/88">{course.nextLessonTitle}</p>
              </div>
            ) : null}
          </div>
        </div>
      </PosterSurface>
    </Link>
  );
}
