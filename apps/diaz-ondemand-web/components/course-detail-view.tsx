'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CourseDto, ProgramWithContentDto, ProgressDto } from '@diaz/shared';
import { buildRecommendation } from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { buildCourseProgress, buildLessonQueue, formatDuration, getAccessLabel } from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { EmptyState } from './empty-state';
import { LessonRow } from './lesson-row';
import { PageHeader } from './page-header';
import { PremiumBadge } from './premium-badge';
import { ProgressBar } from './progress-bar';

export function CourseDetailView({
  course,
  programTitle,
  programs,
}: {
  course: CourseDto;
  programTitle: string | null;
  programs: ProgramWithContentDto[];
}) {
  const apiFetch = useApiClient();
  const [progress, setProgress] = useState<ProgressDto[]>([]);
  const [progressError, setProgressError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProgressDto[]>('/progress')
      .then(setProgress)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          setProgress([]);
          return;
        }

        setProgressError('Progress could not be loaded right now.');
      });
  }, [apiFetch]);

  const courseProgress = buildCourseProgress(course, progress);
  const queue = buildLessonQueue(course, progress, courseProgress.inProgressLessonId ?? courseProgress.nextLessonId ?? '');
  const totalDuration = formatDuration((course.lessons ?? []).reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0));
  const primaryLessonId = courseProgress.continueLessonId ?? course.lessons?.[0]?.id ?? null;
  const primaryCtaLabel = courseProgress.percent > 0 ? 'Continue' : 'Start course';
  const recommendation = buildRecommendation(programs, course.id, progress);
  const curriculumLabels = [...new Set((course.lessons ?? []).flatMap((lesson) => {
    const curriculum = lesson.curriculum;
    if (!curriculum) {
      return [];
    }

    return [
      curriculum.position.split('-').join(' '),
      curriculum.track,
      ...(curriculum.skill ? [curriculum.skill] : []),
    ];
  }))];

  if (!course.lessons || course.lessons.length === 0) {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/library"
          ctaLabel="Back to library"
          description="This course has been published without lessons yet. Add lessons in admin, then students can begin progressing through it."
          title="No lessons in this course yet"
        />
      </AppShell>
    );
  }

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description={course.description ?? 'Structured lessons designed to keep your mat time focused, technical, and easy to resume.'}
        eyebrow={programTitle ? `${programTitle} / Course` : 'Course'}
        title={course.title}
        actions={
          primaryLessonId ? (
            <Link
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              href={`/lesson/${primaryLessonId}`}
            >
              {primaryCtaLabel}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)]">
        <section className="surface-panel space-y-8 p-8">
          <div className="flex flex-wrap items-center gap-3">
            <PremiumBadge label={getAccessLabel(course.lessons)} tone="premium" />
            <PremiumBadge label={`${course.lessons.length} lessons`} />
            {totalDuration ? <PremiumBadge label={totalDuration} /> : null}
            {curriculumLabels.slice(0, 3).map((label) => (
              <PremiumBadge key={label} label={label} />
            ))}
          </div>

          <div className="space-y-4">
            <ProgressBar label="Course progress" value={courseProgress.percent} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="surface-panel-muted p-4">
                <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Completed</p>
                <p className="mt-3 font-display text-4xl uppercase text-[var(--text)]">{courseProgress.completedLessons}</p>
              </div>
              <div className="surface-panel-muted p-4">
                <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Remaining</p>
                <p className="mt-3 font-display text-4xl uppercase text-[var(--text)]">
                  {Math.max(courseProgress.totalLessons - courseProgress.completedLessons, 0)}
                </p>
              </div>
              <div className="surface-panel-muted p-4">
                <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Next session</p>
                <p className="mt-3 text-sm leading-6 text-[var(--text)]">
                  {queue.find((item) => item.isNext)?.title ?? queue[0]?.title ?? 'Ready to begin'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="surface-panel-muted space-y-3 p-5">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Course flow</p>
              <p className="text-sm leading-7 text-[var(--text-muted)]">
                Work through each lesson in order, save your place automatically, and return to the next drill from the library or
                player.
              </p>
            </div>
            <div className="surface-panel-muted space-y-3 p-5">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Recommended next</p>
              <h3 className="font-display text-2xl uppercase leading-none text-[var(--text)]">
                {recommendation.title ?? 'Stay with this course'}
              </h3>
              <p className="text-sm leading-7 text-[var(--text-muted)]">
                {recommendation.reason === 'next_course'
                  ? 'You are ready to move into the next course in the program.'
                  : recommendation.reason === 'resume_lesson'
                    ? 'Resume the lesson already in progress.'
                    : 'Continue with the next technique in the guided path.'}
              </p>
              {recommendation.lessonId ? (
                <Link
                  className="inline-flex items-center rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
                  href={`/lesson/${recommendation.lessonId}`}
                >
                  Open recommendation
                </Link>
              ) : null}
            </div>
          </div>
          {progressError ? (
            <div className="surface-panel-muted p-4 text-sm text-[var(--danger)]">{progressError}</div>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">Lesson queue</h2>
            <p className="text-sm text-[var(--text-muted)]">Pick up where you left off or jump ahead.</p>
          </div>
          <div className="space-y-3">
            {queue.map((lesson) => (
              <LessonRow
                accessLabel={lesson.accessLabel}
                curriculumLabel={lesson.curriculumLabel}
                durationLabel={lesson.durationLabel}
                href={lesson.href}
                isCompleted={lesson.isCompleted}
                isCurrent={lesson.isCurrent}
                isNext={lesson.isNext}
                key={lesson.id}
                orderLabel={lesson.orderLabel}
                title={lesson.title}
              />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
