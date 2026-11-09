'use client';

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
import {
  buildCourseProgress,
  buildLessonQueue,
  formatDuration,
  getAccessLabel,
} from '@/lib/student-ui';
import { AppShell } from './app-shell';
import { EmptyState } from './empty-state';
import { LessonRow } from './lesson-row';
import { SectionHeader } from './section-header';
import { Badge } from './ui/badge';
import { ButtonLink } from './ui/button';
import { Card, CardActions } from './ui/card';
import { List } from './ui/list';
import { Progress } from './ui/progress';

export function CourseDetailView({
  course,
  programDiscipline,
  isFeaturedDemo,
  programs,
}: {
  course: CourseDto;
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
  const queue = buildLessonQueue(
    course,
    progress,
    courseProgress.inProgressLessonId ?? courseProgress.nextLessonId ?? '',
  );
  const totalDuration = formatDuration(
    (course.lessons ?? []).reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0),
  );
  const primaryLessonId = courseProgress.continueLessonId ?? course.lessons?.[0]?.id ?? null;
  const primaryCtaLabel = courseProgress.percent > 0 ? 'Continue' : 'Start course';
  const recommendation = buildRecommendation(programs, course.id, progress);
  const firstCurriculum = course.lessons?.find((lesson) => lesson.curriculum)?.curriculum ?? null;
  const curriculumLabels = [
    ...new Set(
      (course.lessons ?? []).flatMap((lesson) => {
        const curriculum = lesson.curriculum;
        if (!curriculum) {
          return [];
        }

        return [
          getCurriculumTrackLabel(curriculum),
          ...(curriculum.skill ? [getCurriculumSkillLabel(curriculum)] : []),
        ].filter((label): label is string => Boolean(label));
      }),
    ),
  ];
  const nextLesson = queue.find((item) => item.isCurrent || item.isNext) ?? queue[0] ?? null;

  if (!course.lessons || course.lessons.length === 0) {
    return (
      <AppShell>
        <EmptyState ctaHref="/library" ctaLabel="Back to library" title="No lessons yet" />
      </AppShell>
    );
  }

  const accessLabel = getAccessLabel(course.lessons);
  const headerMeta = [
    programDiscipline ? getDisciplineLabel(programDiscipline) : null,
    firstCurriculum
      ? getCurriculumPhaseLabel(firstCurriculum.discipline, firstCurriculum.phase)
      : null,
    `${course.lessons.length} lessons`,
    totalDuration,
  ]
    .filter(Boolean)
    .join(' · ');
  const remaining = Math.max(courseProgress.totalLessons - courseProgress.completedLessons, 0);

  return (
    <AppShell>
      <div className="grid gap-800 xl:grid-cols-split">
        <section className="flex flex-col gap-600">
          <div className="flex flex-col gap-400">
            <div className="flex flex-wrap items-center gap-200">
              <Badge
                label={accessLabel}
                variant={accessLabel === 'Free course' ? 'neutral' : 'premium'}
              />
              {isFeaturedDemo ? <Badge label="Featured demo" /> : null}
            </div>
            <div className="flex flex-col gap-300">
              <h1 className="type-display-700">{course.title}</h1>
              <p className="text-body-200 text-foreground-faint">{headerMeta}</p>
              {course.description ? (
                <p className="max-w-reading text-body-300 text-foreground-faint">
                  {course.description}
                </p>
              ) : null}
            </div>
          </div>

          <Card className="flex flex-col gap-600" variant="emphasis">
            <div className="flex flex-col gap-200">
              <p className="type-kicker">Up next</p>
              <h2 className="type-display-400">
                {nextLesson?.title ?? recommendation.title ?? 'Ready to begin'}
              </h2>
              <p className="text-body-200 text-foreground-faint">
                {`${courseProgress.completedLessons} completed · ${remaining} remaining`}
              </p>
              <Progress className="mt-300" label="Progress" value={courseProgress.percent} />
            </div>
            <CardActions>
              {primaryLessonId ? (
                <ButtonLink href={`/lesson/${primaryLessonId}`} size="lg" variant="primary">
                  {primaryCtaLabel}
                </ButtonLink>
              ) : null}
              {recommendation.lessonId ? (
                <ButtonLink
                  href={`/lesson/${recommendation.lessonId}`}
                  size="lg"
                  variant="secondary"
                >
                  Open recommendation
                </ButtonLink>
              ) : null}
            </CardActions>
          </Card>

          {curriculumLabels.length > 0 ? (
            <div className="flex flex-wrap gap-200">
              {curriculumLabels.slice(0, 4).map((label) => (
                <Badge key={label} label={label} />
              ))}
            </div>
          ) : null}

          {progressError ? (
            <p className="text-body-200 text-foreground-critical" role="alert">
              {progressError}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-400">
          <SectionHeader title="Lesson breakdown" />
          <List>
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
          </List>
        </section>
      </div>
    </AppShell>
  );
}
