'use client';

import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { buildRecommendation, type ProgramWithContentDto, type ProgressDto } from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { buildContinueWatching, buildCourseCardModel } from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { ContinueCard } from './continue-card';
import { CourseCard } from './course-card';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';
import { SectionHeader } from './section-header';

export function LibraryView({ programs }: { programs: ProgramWithContentDto[] }) {
  const apiFetch = useApiClient();
  const [progress, setProgress] = useState<ProgressDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    position: 'all',
    track: 'all',
    access: 'all',
  });

  useEffect(() => {
    apiFetch<ProgressDto[]>('/progress')
      .then(setProgress)
      .catch((requestError) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setProgress([]);
          return;
        }

        setError('Progress could not be loaded right now.');
      });
  }, [apiFetch]);

  const continueWatching = buildContinueWatching(programs, progress);
  const startHere = programs.flatMap((program) =>
    program.courses.map((course) => buildCourseCardModel(program, course, progress)),
  );
  const deferredFilters = useDeferredValue(filters);
  const positions = [
    ...new Set(
      programs.flatMap((program) =>
        program.courses.flatMap((course) =>
          course.lessons
            .map((lesson) => lesson.curriculum?.position)
            .filter((position): position is NonNullable<typeof position> => Boolean(position)),
        ),
      ),
    ),
  ];
  const tracks = [
    ...new Set(
      programs.flatMap((program) =>
        program.courses.flatMap((course) =>
          course.lessons
            .map((lesson) => lesson.curriculum?.track)
            .filter((track): track is NonNullable<typeof track> => Boolean(track)),
        ),
      ),
    ),
  ];
  const filteredPrograms = programs
    .map((program) => ({
      ...program,
      courses: program.courses.filter((course) =>
        course.lessons.some((lesson) => {
          if (deferredFilters.position !== 'all' && lesson.curriculum?.position !== deferredFilters.position) {
            return false;
          }
          if (deferredFilters.track !== 'all' && lesson.curriculum?.track !== deferredFilters.track) {
            return false;
          }
          if (deferredFilters.access !== 'all' && lesson.accessLevel !== deferredFilters.access) {
            return false;
          }
          return true;
        }),
      ),
    }))
    .filter((program) => program.courses.length > 0);
  const firstProgram = programs[0] ?? null;
  const firstCourse = firstProgram?.courses[0] ?? null;
  const recommendation = firstCourse ? buildRecommendation(programs, firstCourse.id, progress) : null;

  return (
    <AppShell className="space-y-14">
      <PageHeader
        description="Structured BJJ courses, premium lessons, and a guided path that keeps your training moving between sessions."
        eyebrow="Student Library"
        title="Train On Demand"
      />

      {programs.length === 0 ? (
        <EmptyState
          ctaHref="/subscribe"
          ctaLabel="View premium access"
          description="Published programs have not been added yet. Once content is live, this library becomes your home base for drilling and course progress."
          title="Library coming online"
        />
      ) : null}

      {programs.length > 0 && recommendation?.lessonId ? (
        <section className="surface-panel grid gap-6 overflow-hidden p-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Recommended next</p>
            <h2 className="font-display text-5xl uppercase leading-none tracking-[0.03em] text-[var(--text)]">
              {recommendation.title}
            </h2>
            <p className="max-w-2xl text-base leading-7 text-[var(--text-muted)]">
              {recommendation.reason === 'resume_lesson'
                ? 'Pick up where you left off and keep the current lesson moving.'
                : recommendation.reason === 'next_course'
                  ? 'You have completed the current course. Move into the next section of the fundamentals path.'
                  : 'This is the clearest next step in the guided path based on your progress.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
                href={`/lesson/${recommendation.lessonId}`}
              >
                Open lesson
              </Link>
              {recommendation.courseId ? (
                <Link
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                  href={`/course/${recommendation.courseId}`}
                >
                  View course
                </Link>
              ) : null}
            </div>
          </div>
          <div className="surface-panel-muted space-y-4 p-5">
            <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Refine the library</p>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {['all', ...positions].map((position) => (
                  <button
                    key={position}
                    className={['rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition-colors duration-200', deferredFilters.position === position ? 'border-[var(--progress)]/40 bg-[var(--progress)]/12 text-[var(--text)]' : 'border-white/10 bg-white/5 text-[var(--text-muted)]'].join(' ')}
                    onClick={() => startTransition(() => setFilters((prev) => ({ ...prev, position: position ?? 'all' })))}
                    type="button"
                  >
                    {position === 'all' ? 'All positions' : position.replaceAll('-', ' ')}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {['all', ...tracks].map((track) => (
                  <button
                    key={track}
                    className={['rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition-colors duration-200', deferredFilters.track === track ? 'border-[var(--progress)]/40 bg-[var(--progress)]/12 text-[var(--text)]' : 'border-white/10 bg-white/5 text-[var(--text-muted)]'].join(' ')}
                    onClick={() => startTransition(() => setFilters((prev) => ({ ...prev, track: track ?? 'all' })))}
                    type="button"
                  >
                    {track === 'all' ? 'All tracks' : track}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {['all', 'FREE', 'PAID'].map((access) => (
                  <button
                    key={access}
                    className={['rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition-colors duration-200', deferredFilters.access === access ? 'border-[var(--progress)]/40 bg-[var(--progress)]/12 text-[var(--text)]' : 'border-white/10 bg-white/5 text-[var(--text-muted)]'].join(' ')}
                    onClick={() => startTransition(() => setFilters((prev) => ({ ...prev, access })))}
                    type="button"
                  >
                    {access === 'all' ? 'All access' : access === 'PAID' ? 'Premium' : 'Free'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {programs.length > 0 && continueWatching.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader detail={`${continueWatching.length} active lessons`} eyebrow="Progress first" title="Continue watching" />
          <div className="grid gap-5 lg:grid-cols-3">
            {continueWatching.slice(0, 3).map((item) => (
              <ContinueCard item={item} key={item.lessonId} />
            ))}
          </div>
        </section>
      ) : null}

      {programs.length > 0 && continueWatching.length === 0 ? (
        <section className="space-y-5">
          <SectionHeader detail={`${startHere.length} published courses`} eyebrow="First session" title="Start here" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {startHere.slice(0, 3).map((course) => (
              <CourseCard course={course} key={course.id} />
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="surface-panel-muted p-4 text-sm text-[var(--danger)]">{error}</div>
      ) : null}

      {filteredPrograms.map((program) => {
        const courses = program.courses.map((course) => buildCourseCardModel(program, course, progress));

        return (
          <section className="space-y-5" key={program.id}>
            <SectionHeader
              detail={program.description ?? `${courses.length} structured courses`}
              eyebrow="Program"
              title={program.title}
            />
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {courses.map((course) => (
                <CourseCard course={course} key={course.id} />
              ))}
            </div>
          </section>
        );
      })}
    </AppShell>
  );
}
