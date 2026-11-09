'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  VideoProvider,
  createDefaultCurriculum,
  formatCurriculumLabel,
  getDisciplineLabel,
  hasUnplayableVideoIdentifier,
  programDisciplineToCurriculumDiscipline,
  type AdminProgramWithContentDto,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { LessonVideoStateBadge, LessonVideoStateNote } from '@/components/lesson-video-state';
import { SectionHeader } from '@/components/section-header';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { List, ListRow } from '@/components/ui/list';
import { useApiClient } from '@/lib/api-client';

const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  [VideoProvider.MUX]: 'Mux',
  [VideoProvider.YOUTUBE]: 'YouTube',
  [VideoProvider.NONE]: 'No video',
};

function getDefaultCurriculum(
  course: AdminProgramWithContentDto['courses'][number] | null,
  program: AdminProgramWithContentDto | null,
) {
  return (
    course?.lessons[0]?.curriculum ??
    createDefaultCurriculum(
      program ? programDisciplineToCurriculumDiscipline(program.discipline) : 'bjj',
    )
  );
}

export default function AdminCourseDetailPage() {
  const params = useParams<{ id: string }>();
  const courseId = params.id;
  const apiFetch = useApiClient();
  const [programs, setPrograms] = useState<AdminProgramWithContentDto[]>([]);
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const courseContext = useMemo(() => {
    for (const program of programs) {
      const found = program.courses.find((entry) => entry.id === courseId);
      if (found) {
        return { course: found, program };
      }
    }
    return null;
  }, [courseId, programs]);
  const course = courseContext?.course ?? null;
  const program = courseContext?.program ?? null;

  const load = useCallback(async () => {
    const data = await apiFetch<AdminProgramWithContentDto[]>('/admin/programs');
    setPrograms(data);
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const createLesson = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch('/admin/lessons', {
      method: 'POST',
      body: JSON.stringify({
        courseId,
        title: newLessonTitle,
        description: '',
        orderIndex: (course?.lessons.length ?? 0) + 1,
        isPublished: false,
        accessLevel: 'FREE',
        videoProvider: VideoProvider.NONE,
        curriculum: getDefaultCurriculum(course ?? null, program ?? null),
      }),
    });
    setNewLessonTitle('');
    setStatus('Lesson created.');
    await load();
  };

  const togglePublish = async () => {
    if (!course) return;
    await apiFetch(`/admin/courses/${course.id}/publish`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: !course.isPublished }),
    });
    setStatus(course.isPublished ? 'Course moved to draft.' : 'Course published.');
    await load();
  };

  const moveLesson = async (lessonId: string, direction: -1 | 1) => {
    if (!course) return;
    const sorted = [...course.lessons].sort((left, right) => left.orderIndex - right.orderIndex);
    const index = sorted.findIndex((lesson) => lesson.id === lessonId);
    const target = sorted[index + direction];

    if (!target || !sorted[index]) {
      return;
    }

    await Promise.all([
      apiFetch(`/admin/lessons/${sorted[index].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ orderIndex: target.orderIndex }),
      }),
      apiFetch(`/admin/lessons/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ orderIndex: sorted[index].orderIndex }),
      }),
    ]);
    setStatus('Lesson order updated.');
    await load();
  };

  if (!course) {
    return (
      <AppShell>
        <EmptyState
          description="The selected course could not be found."
          title="Course unavailable"
        />
      </AppShell>
    );
  }

  const publishedLessons = course.lessons.filter((lesson) => lesson.isPublished).length;

  const premiumLessons = course.lessons.filter((lesson) => lesson.accessLevel === 'PAID').length;
  const newLessonInputId = 'new-lesson-title';

  return (
    <AppShell>
      <div className="grid gap-600 xl:grid-cols-split">
        <Card className="flex flex-col gap-500 self-start">
          <div className="flex flex-col gap-300">
            <h1 className="type-display-500">{course.title}</h1>
            <div className="flex flex-wrap items-center gap-200">
              {program ? <Badge label={getDisciplineLabel(program.discipline)} /> : null}
              {program?.isFeaturedDemo ? <Badge label="Demo" /> : null}
              <Badge
                label={course.isPublished ? 'Published' : 'Draft'}
                variant={course.isPublished ? 'success' : 'neutral'}
              />
            </div>
            <p className="text-body-200 text-foreground-faint">
              {`${course.lessons.length} lessons · ${publishedLessons} published · ${premiumLessons} premium`}
            </p>
          </div>
          <CardActions>
            <Button onClick={togglePublish} variant="secondary">
              {course.isPublished ? 'Move to draft' : 'Publish course'}
            </Button>
          </CardActions>
          {status ? (
            <p aria-live="polite" className="text-body-200 text-foreground-success">
              {status}
            </p>
          ) : null}
        </Card>

        <section className="flex flex-col gap-400">
          <SectionHeader title="Lesson queue" />
          <form onSubmit={createLesson}>
            <Card className="flex flex-col gap-400">
              <Field htmlFor={newLessonInputId} label="New lesson">
                <Input
                  id={newLessonInputId}
                  placeholder="New lesson title"
                  value={newLessonTitle}
                  onChange={(event) => setNewLessonTitle(event.target.value)}
                />
              </Field>
              <CardActions>
                <Button type="submit" variant="primary">
                  Add lesson
                </Button>
              </CardActions>
            </Card>
          </form>

          <List>
            {[...course.lessons]
              .sort((left, right) => left.orderIndex - right.orderIndex)
              .map((lesson, index, sorted) => (
                <ListRow
                  badges={
                    <>
                      {/*
                        The provider badge names where the video comes from; the
                        state badge beside it says whether there is one. A lesson
                        with no source has nothing for the first to name, and two
                        "No video" badges in a row read as a rendering mistake.
                      */}
                      {lesson.videoProvider !== VideoProvider.NONE ? (
                        <Badge label={VIDEO_PROVIDER_LABELS[lesson.videoProvider]} />
                      ) : null}
                      {hasUnplayableVideoIdentifier(lesson) ? (
                        <Badge label="Video ID will not play" variant="critical" />
                      ) : null}
                      <LessonVideoStateBadge lesson={lesson} />
                      <Badge
                        label={lesson.accessLevel === 'PAID' ? 'Premium' : 'Free'}
                        variant={lesson.accessLevel === 'PAID' ? 'premium' : 'neutral'}
                      />
                      <Badge
                        label={lesson.isPublished ? 'Published' : 'Draft'}
                        variant={lesson.isPublished ? 'success' : 'neutral'}
                      />
                    </>
                  }
                  key={lesson.id}
                  meta={
                    lesson.curriculum
                      ? `${formatCurriculumLabel(lesson)} / ${lesson.curriculum.level}`
                      : 'Curriculum metadata not set'
                  }
                  stack
                  title={lesson.title}
                  trailing={
                    <>
                      <Button
                        disabled={index === 0}
                        onClick={() => void moveLesson(lesson.id, -1)}
                        size="sm"
                        variant="ghost"
                      >
                        Up
                      </Button>
                      <Button
                        disabled={index === sorted.length - 1}
                        onClick={() => void moveLesson(lesson.id, 1)}
                        size="sm"
                        variant="ghost"
                      >
                        Down
                      </Button>
                      <ButtonLink
                        href={`/admin/lessons/${lesson.id}`}
                        size="sm"
                        variant="secondary"
                      >
                        Edit
                      </ButtonLink>
                    </>
                  }
                >
                  {hasUnplayableVideoIdentifier(lesson) ? (
                    <p className="text-body-200 text-foreground-critical">
                      The stored video ID will not play. A published lesson with it shows the
                      not-filmed state.
                    </p>
                  ) : null}
                  <LessonVideoStateNote
                    className="text-body-200 text-foreground-faint"
                    lesson={lesson}
                  />
                </ListRow>
              ))}
          </List>
        </section>
      </div>
    </AppShell>
  );
}
