'use client';

import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { buildRecommendation, Discipline, getDisciplineLabel, type ProgramWithContentDto, type ProgressDto } from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { buildContinueWatching, buildCourseCardModel } from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { ContinueRow } from './continue-row';
import { CourseRow } from './course-row';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';
import { SectionHeader } from './section-header';

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
              aria-pressed={disciplineFilter === discipline}
              key={discipline}
              className={[
                'rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition-colors duration-200',
                disciplineFilter === discipline
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

      {filteredPrograms.length > 0 && recommendation?.lessonId ? (
        <section className="space-y-4">
          <SectionHeader eyebrow="Recommended next" title={recommendation.title ?? 'Ready to begin'} />
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
        </section>
      ) : null}

      {featuredPrograms.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader detail="Instructor walkthrough" eyebrow="Featured demo" title="Showcase click-through" />
          <div className="space-y-1">
            {featuredPrograms.flatMap((program) =>
              program.courses.map((course) => (
                <CourseRow course={buildCourseCardModel(program, course, progress)} key={course.id} />
              )),
            )}
          </div>
        </section>
      ) : null}

      {trainingPrograms.length > 0 && continueWatching.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader detail={`${continueWatching.length} active lessons`} eyebrow="Progress first" title="Continue watching" />
          <div className="space-y-1">
            {continueWatching.slice(0, 8).map((item) => (
              <ContinueRow item={item} key={item.lessonId} />
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}

      {(deferredDiscipline === 'all' ? disciplineOrder : [deferredDiscipline]).map((discipline) => {
        const programsForDiscipline = filteredPrograms.filter((program) => program.discipline === discipline);

        if (programsForDiscipline.length === 0) {
          return (
            <section className="space-y-5" key={discipline}>
              <SectionHeader
                detail="No published programs available"
                eyebrow="Discipline"
                title={getDisciplineLabel(discipline)}
              />
              <p className="type-body text-[var(--text-muted)]">
                No published programs are available for {getDisciplineLabel(discipline)} yet.
                Try another discipline or check back after new content is published.
              </p>
            </section>
          );
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
                  <div className="space-y-3" key={program.id}>
                    <SectionHeader
                      detail={program.description ?? `${courses.length} structured courses`}
                      eyebrow="Program"
                      title={program.title}
                    />
                    <div className="space-y-1">
                      {courses.map((course) => (
                        <CourseRow course={course} key={course.id} />
                      ))}
                    </div>
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
