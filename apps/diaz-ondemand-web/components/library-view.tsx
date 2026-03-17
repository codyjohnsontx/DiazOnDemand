'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { buildRecommendation, Discipline, getDisciplineLabel, type ProgramWithContentDto, type ProgressDto } from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { buildContinueWatching, buildCourseCardModel } from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { ContinueCard } from './continue-card';
import { CourseCard } from './course-card';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';
import { SectionHeader } from './section-header';

function Rail({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-5">{children}</div>
    </div>
  );
}

export function LibraryView({ programs }: { programs: ProgramWithContentDto[] }) {
  const apiFetch = useApiClient();
  const [progress, setProgress] = useState<ProgressDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState<'all' | Discipline>('all');

  useEffect(() => {
    apiFetch<ProgressDto[]>('/progress')
      .then((nextProgress) => {
        setProgress(nextProgress);
        setError(null);
      })
      .catch((requestError) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setProgress([]);
          setError(null);
          return;
        }

        setError('Progress could not be loaded right now.');
      });
  }, [apiFetch]);

  const deferredDiscipline = useDeferredValue(disciplineFilter);
  const featuredPrograms = programs.filter((program) => program.isFeaturedDemo);
  const trainingPrograms = programs.filter((program) => !program.isFeaturedDemo);
  const disciplineOrder = Object.values(Discipline);
  const filteredPrograms = trainingPrograms.filter((program) =>
    deferredDiscipline === 'all' ? true : program.discipline === deferredDiscipline,
  );
  const continueWatching = buildContinueWatching(filteredPrograms, progress).filter(
    (item) => item.progressPercent < 100,
  );
  const courseCards = filteredPrograms.flatMap((program) =>
    program.courses.map((course) => buildCourseCardModel(program, course, progress)),
  );
  const newestCourses = courseCards.slice(0, 6);
  const firstProgram = filteredPrograms.find((program) => program.courses.length > 0) ?? null;
  const firstCourse = firstProgram?.courses[0] ?? null;
  const recommendation = firstCourse ? buildRecommendation(filteredPrograms, firstCourse.id, progress) : null;

  return (
    <AppShell className="space-y-16">
      <div className="space-y-6">
        <PageHeader
          description="A guided on-demand library built around disciplined progression, repeatable modules, and quick return-to-training paths."
          eyebrow="Student Library"
          title="Train On Demand"
        />
        <div className="flex flex-wrap gap-2">
          {(['all', ...disciplineOrder] as const).map((discipline) => (
            <button
              aria-pressed={deferredDiscipline === discipline}
              key={discipline}
              className={[
                'rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition-colors duration-200',
                deferredDiscipline === discipline
                  ? 'border-[var(--progress)]/40 bg-[var(--progress)]/12 text-[var(--text)]'
                  : 'border-white/10 bg-white/5 text-[var(--text-muted)]',
              ].join(' ')}
              onClick={() => startTransition(() => setDisciplineFilter(discipline))}
              type="button"
            >
              {discipline === 'all' ? 'All disciplines' : getDisciplineLabel(discipline)}
            </button>
          ))}
        </div>
      </div>

      {programs.length === 0 ? (
        <EmptyState
          ctaHref="/subscribe"
          ctaLabel="View premium access"
          description="Published programs have not been added yet. Once content is live, this library becomes your home base for drilling and course progress."
          title="Library coming online"
        />
      ) : null}

      {featuredPrograms.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader detail="Instructor walkthrough" eyebrow="Featured demo" title="Showcase click-through" />
          <Rail>
            {featuredPrograms.flatMap((program) =>
              program.courses.map((course) => (
                <div className="w-[320px] shrink-0 sm:w-[360px]" key={course.id}>
                  <CourseCard course={buildCourseCardModel(program, course, progress)} />
                </div>
              )),
            )}
          </Rail>
        </section>
      ) : null}

      {filteredPrograms.length > 0 && recommendation?.lessonId ? (
        <section className="surface-panel grid gap-6 overflow-hidden p-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <p className="type-kicker text-[var(--text-muted)]">Recommended next</p>
            <h2 className="type-title-xl max-w-3xl text-[var(--text)]">{recommendation.title}</h2>
            <p className="type-body max-w-2xl text-[var(--text-muted)]">
              {recommendation.reason === 'resume_lesson'
                ? 'Pick up where you left off and keep the current lesson moving.'
                : recommendation.reason === 'next_course'
                  ? 'You have completed the current course. Move into the next section of the curriculum path.'
                  : 'This is the clearest next step in the guided path based on your progress.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                className="inline-flex items-center rounded-full bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-black transition-colors duration-200 hover:bg-white/90"
                href={`/lesson/${recommendation.lessonId}`}
              >
                Open lesson
              </Link>
              {recommendation.courseId ? (
                <Link
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                  href={`/course/${recommendation.courseId}`}
                >
                  View course
                </Link>
              ) : null}
            </div>
          </div>
          <div className="surface-panel-muted space-y-4 p-5">
            <p className="type-kicker text-[var(--text-muted)]">Library snapshot</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="type-kicker text-[var(--text-muted)]">Programs</p>
                <p className="mt-3 font-display text-4xl leading-none text-[var(--text)]">{filteredPrograms.length}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="type-kicker text-[var(--text-muted)]">Courses</p>
                <p className="mt-3 font-display text-4xl leading-none text-[var(--text)]">{courseCards.length}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="type-kicker text-[var(--text-muted)]">In progress</p>
                <p className="mt-3 font-display text-4xl leading-none text-[var(--text)]">{continueWatching.length}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                <p className="type-kicker text-[var(--text-muted)]">Filter</p>
                <p className="mt-3 text-base text-[var(--text)]">
                  {deferredDiscipline === 'all' ? 'All disciplines' : getDisciplineLabel(deferredDiscipline)}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {trainingPrograms.length > 0 && continueWatching.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader detail={`${continueWatching.length} active lessons`} eyebrow="Progress first" title="Continue watching" />
          <Rail>
            {continueWatching.slice(0, 8).map((item) => (
              <div className="w-[320px] shrink-0 sm:w-[360px]" key={item.lessonId}>
                <ContinueCard item={item} />
              </div>
            ))}
          </Rail>
        </section>
      ) : null}

      {trainingPrograms.length > 0 && newestCourses.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader detail={`${newestCourses.length} structured modules`} eyebrow="Explore curriculum" title="New courses" />
          <Rail>
            {newestCourses.map((course) => (
              <div className="w-[320px] shrink-0 sm:w-[360px]" key={course.id}>
                <CourseCard course={course} />
              </div>
            ))}
          </Rail>
        </section>
      ) : null}

      {error ? (
        <div className="surface-panel-muted p-4 text-sm text-[var(--danger)]" role="alert">
          {error}
        </div>
      ) : null}

      {(deferredDiscipline === 'all' ? disciplineOrder : [deferredDiscipline]).map((discipline) => {
        const programsForDiscipline = filteredPrograms.filter((program) => program.discipline === discipline);

        if (programsForDiscipline.length === 0) {
          return null;
        }

        return (
          <section className="space-y-5" key={discipline}>
            <SectionHeader
              detail={`${programsForDiscipline.reduce((count, program) => count + program.courses.length, 0)} courses`}
              eyebrow="Discipline"
              title={getDisciplineLabel(discipline)}
            />
            <div className="space-y-8">
              {programsForDiscipline.map((program) => {
                const courses = program.courses.map((course) => buildCourseCardModel(program, course, progress));

                return (
                  <div className="space-y-5" key={program.id}>
                    <SectionHeader
                      detail={program.description ?? `${courses.length} structured courses`}
                      eyebrow="Program"
                      title={program.title}
                    />
                    <Rail>
                      {courses.map((course) => (
                        <div className="w-[320px] shrink-0 sm:w-[360px]" key={course.id}>
                          <CourseCard course={course} />
                        </div>
                      ))}
                    </Rail>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </AppShell>
  );
}
