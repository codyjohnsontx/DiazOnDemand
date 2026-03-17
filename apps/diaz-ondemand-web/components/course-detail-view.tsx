'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CourseDto, Discipline, ProgramWithContentDto, ProgressDto } from '@diaz/shared';
import {
  buildRecommendation,
  getCurriculumPhaseLabel,
  getCurriculumSkillLabel,
  getCurriculumTrackLabel,
  getDisciplineLabel,
} from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { buildCourseProgress, buildLessonQueue, formatDuration, getAccessLabel } from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { EmptyState } from './empty-state';
import { LessonRow } from './lesson-row';
import { PosterSurface } from './poster-surface';
import { PremiumBadge } from './premium-badge';
import { ProgressBar } from './progress-bar';

export function CourseDetailView({
  course,
  programTitle,
  programDiscipline,
  isFeaturedDemo,
  programs,
}: {
  course: CourseDto;
  programTitle: string | null;
  programDiscipline: Discipline | null;
  isFeaturedDemo: boolean;
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
  const firstCurriculum = course.lessons?.find((lesson) => lesson.curriculum)?.curriculum ?? null;
  const curriculumLabels = [...new Set((course.lessons ?? []).flatMap((lesson) => {
    const curriculum = lesson.curriculum;
    if (!curriculum) {
      return [];
    }

    return [
      getCurriculumTrackLabel(curriculum),
      ...(curriculum.skill ? [getCurriculumSkillLabel(curriculum)] : []),
    ].filter((label): label is string => Boolean(label));
  }))];
  const nextLesson = queue.find((item) => item.isCurrent || item.isNext) ?? queue[0] ?? null;
  const monogram = course.title
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

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
    <AppShell className="space-y-10">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
        <section className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {programDiscipline ? <PremiumBadge label={getDisciplineLabel(programDiscipline)} /> : null}
              {isFeaturedDemo ? <PremiumBadge label="Featured demo" tone="accent" /> : null}
              <PremiumBadge label={getAccessLabel(course.lessons)} tone="premium" />
              {firstCurriculum ? (
                <PremiumBadge label={getCurriculumPhaseLabel(firstCurriculum.discipline, firstCurriculum.phase)} />
              ) : null}
            </div>
            <div className="space-y-3">
              <p className="type-kicker text-[var(--accent-strong)]">{programTitle ?? 'Course'}</p>
              <h1 className="type-title-lg text-[var(--text)] sm:text-[3.25rem]">{course.title}</h1>
              <p className="type-body max-w-2xl text-[var(--text-muted)]">
                {course.description ?? 'Structured lessons designed to keep your mat time focused, technical, and easy to resume.'}
              </p>
            </div>
          </div>

          <div className="surface-panel space-y-5 p-6">
            <ProgressBar label="Progress" value={courseProgress.percent} />

            <PosterSurface className="min-h-[420px]" monogram={monogram} seed={course.orderIndex}>
              <div className="flex h-full flex-col justify-end">
                <div className="space-y-4 rounded-t-[28px] border-t border-white/10 bg-[linear-gradient(180deg,rgba(8,9,11,0.18),rgba(8,9,11,0.92)_18%,rgba(8,9,11,0.98)_100%)] p-6">
                  <p className="type-kicker text-white/60">Up next</p>
                  <div className="space-y-2">
                    <h2 className="font-display text-[2rem] leading-[0.98] text-[var(--text)]">
                      {nextLesson?.title ?? recommendation.title ?? 'Ready to begin'}
                    </h2>
                    <p className="type-meta text-white/76">
                      {recommendation.reason === 'next_course'
                        ? 'You are ready to move into the next course in the program.'
                        : recommendation.reason === 'resume_lesson'
                          ? 'Resume the lesson already in progress.'
                          : 'Stay inside the guided path and keep working the current module.'}
                    </p>
                  </div>
                </div>
              </div>
            </PosterSurface>

            <div className="flex flex-wrap items-center gap-3">
              {primaryLessonId ? (
                <Link
                  className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-black transition-colors duration-200 hover:bg-white/90"
                  href={`/lesson/${primaryLessonId}`}
                >
                  {primaryCtaLabel}
                </Link>
              ) : null}
              {recommendation.lessonId ? (
                <Link
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                  href={`/lesson/${recommendation.lessonId}`}
                >
                  Open recommendation
                </Link>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="surface-panel-muted p-4">
                <p className="type-kicker text-[var(--text-muted)]">Completed</p>
                <p className="mt-3 font-display text-4xl leading-none text-[var(--text)]">{courseProgress.completedLessons}</p>
              </div>
              <div className="surface-panel-muted p-4">
                <p className="type-kicker text-[var(--text-muted)]">Remaining</p>
                <p className="mt-3 font-display text-4xl leading-none text-[var(--text)]">
                  {Math.max(courseProgress.totalLessons - courseProgress.completedLessons, 0)}
                </p>
              </div>
              <div className="surface-panel-muted p-4">
                <p className="type-kicker text-[var(--text-muted)]">Runtime</p>
                <p className="mt-3 text-base text-[var(--text)]">{totalDuration || `${course.lessons.length} lessons`}</p>
              </div>
            </div>
          </div>

          {curriculumLabels.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {curriculumLabels.slice(0, 4).map((label) => (
                <PremiumBadge key={label} label={label} />
              ))}
            </div>
          ) : null}

          {progressError ? <div className="surface-panel-muted p-4 text-sm text-[var(--danger)]">{progressError}</div> : null}
        </section>

        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className="type-title-lg text-[var(--text)]">Lesson breakdown</h2>
            <p className="text-base text-[var(--text-muted)]">Move through the course in order, or jump directly into a lesson.</p>
          </div>
          <div className="surface-panel space-y-2 p-4">
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
