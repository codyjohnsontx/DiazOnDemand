'use client';

import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import {
  buildRecommendation,
  Discipline,
  getDisciplineLabel,
  type ProgramWithContentDto,
  type ProgressDto,
} from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { buildContinueWatching, buildCourseCardModel, formatDuration } from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { ContinueRow } from './continue-row';
import { CourseRow } from './course-row';
import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';
import { SectionHeader } from './section-header';
import { ButtonLink } from './ui/button';
import { Card, CardActions } from './ui/card';
import { Chip, ChipGroup } from './ui/chip';
import { List } from './ui/list';
import { Progress } from './ui/progress';

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
  const firstProgram = filteredPrograms.find((program) => program.courses.length > 0) ?? null;
  const firstCourse = firstProgram?.courses[0] ?? null;
  const recommendation = firstCourse
    ? buildRecommendation(filteredPrograms, firstCourse.id, progress)
    : null;
  // The lesson the recommendation points at, so the card can carry its facts: the course
  // and program it sits in, its runtime, its description and how far along it is.
  const recommended = recommendation?.lessonId
    ? filteredPrograms
        .flatMap((program) =>
          program.courses.flatMap((course) =>
            course.lessons.map((lesson) => ({ program, course, lesson })),
          ),
        )
        .find((entry) => entry.lesson.id === recommendation.lessonId)
    : undefined;
  const recommendedProgress = recommended
    ? continueWatching.find((item) => item.lessonId === recommended.lesson.id)
    : undefined;

  return (
    <AppShell>
      <PageHeader
        actions={
          <ChipGroup label="Filter by discipline">
            {(['all', ...disciplineOrder] as const).map((discipline) => (
              <Chip
                key={discipline}
                onClick={() => startTransition(() => setDisciplineFilter(discipline))}
                pressed={disciplineFilter === discipline}
              >
                {discipline === 'all' ? 'All disciplines' : getDisciplineLabel(discipline)}
              </Chip>
            ))}
          </ChipGroup>
        }
        title="Train On Demand"
      />

      {programs.length === 0 ? (
        <EmptyState
          ctaHref="/subscribe"
          ctaLabel="View premium access"
          title="Library coming online"
        />
      ) : null}

      {filteredPrograms.length > 0 && recommendation?.lessonId ? (
        <section className="flex flex-col gap-400">
          <SectionHeader title="Up next" />
          <Card
            className="flex flex-col gap-600 md:flex-row md:items-end md:justify-between md:gap-800"
            variant="emphasis"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-200">
              <h3 className="type-display-400">{recommendation.title ?? 'Ready to begin'}</h3>
              {recommended ? (
                <p className="text-body-200 text-foreground-faint">
                  {[
                    recommended.course.title,
                    recommended.program.title,
                    formatDuration(recommended.lesson.durationSeconds),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              {recommended?.lesson.description ? (
                <p className="max-w-reading text-body-300">{recommended.lesson.description}</p>
              ) : null}
              {recommendedProgress ? (
                <Progress
                  className="mt-300"
                  label="Progress"
                  value={recommendedProgress.progressPercent}
                />
              ) : null}
            </div>
            <CardActions className="shrink-0">
              <ButtonLink href={`/lesson/${recommendation.lessonId}`} size="lg" variant="primary">
                Open lesson
              </ButtonLink>
              {recommendation.courseId ? (
                <ButtonLink
                  href={`/course/${recommendation.courseId}`}
                  size="lg"
                  variant="secondary"
                >
                  View course
                </ButtonLink>
              ) : null}
            </CardActions>
          </Card>
        </section>
      ) : null}

      {featuredPrograms.length > 0 ? (
        <section className="flex flex-col gap-400">
          <SectionHeader title="Showcase click-through" />
          <List>
            {featuredPrograms.flatMap((program) =>
              program.courses.map((course) => (
                <CourseRow
                  course={buildCourseCardModel(program, course, progress)}
                  key={course.id}
                />
              )),
            )}
          </List>
        </section>
      ) : null}

      {trainingPrograms.length > 0 && continueWatching.length > 0 ? (
        <section className="flex flex-col gap-400">
          <SectionHeader
            detail={`${continueWatching.length} active lessons`}
            title="Continue watching"
          />
          <List>
            {continueWatching.slice(0, 8).map((item) => (
              <ContinueRow item={item} key={item.lessonId} />
            ))}
          </List>
        </section>
      ) : null}

      {error ? (
        <p className="text-body-200 text-foreground-critical" role="alert">
          {error}
        </p>
      ) : null}

      {(deferredDiscipline === 'all' ? disciplineOrder : [deferredDiscipline]).map((discipline) => {
        const programsForDiscipline = filteredPrograms.filter(
          (program) => program.discipline === discipline,
        );

        if (programsForDiscipline.length === 0) {
          return (
            <section className="flex flex-col gap-400" key={discipline}>
              <SectionHeader title={getDisciplineLabel(discipline)} />
              <p className="max-w-reading text-body-300 text-foreground-faint">
                No published programs are available for {getDisciplineLabel(discipline)} yet. Try
                another discipline or check back after new content is published.
              </p>
            </section>
          );
        }

        return (
          <section className="flex flex-col gap-400" key={discipline}>
            <SectionHeader
              detail={`${programsForDiscipline.reduce((count, program) => count + program.courses.length, 0)} courses`}
              title={getDisciplineLabel(discipline)}
            />
            <div className="flex flex-col gap-800">
              {programsForDiscipline.map((program) => {
                const courses = program.courses.map((course) =>
                  buildCourseCardModel(program, course, progress),
                );

                return (
                  <div className="flex flex-col gap-300" key={program.id}>
                    <SectionHeader as="h3" detail={program.description} title={program.title} />
                    <List>
                      {courses.map((course) => (
                        <CourseRow course={course} key={course.id} />
                      ))}
                    </List>
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
