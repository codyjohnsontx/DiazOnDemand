'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Discipline, getDisciplineLabel, type ProgramWithContentDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { SectionHeader } from '@/components/section-header';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { List, ListRow } from '@/components/ui/list';
import { useApiClient } from '@/lib/api-client';

export default function AdminProgramDetailPage() {
  const params = useParams<{ id: string }>();
  const programId = params.id;
  const apiFetch = useApiClient();
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    discipline: Discipline.BJJ,
    isFeaturedDemo: false,
  });
  const [status, setStatus] = useState<string | null>(null);

  const program = useMemo(
    () => programs.find((entry) => entry.id === programId) ?? null,
    [programId, programs],
  );

  const load = async () => {
    const data = await apiFetch<ProgramWithContentDto[]>('/admin/programs');
    setPrograms(data);
  };

  useEffect(() => {
    void load();
    // Mount-only load, kept as-is: load is a new closure on every render, so listing it would
    // re-run this effect after every render, and since load sets state that is an endless fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!program) {
      return;
    }

    setDraft({
      title: program.title,
      description: program.description ?? '',
      discipline: program.discipline,
      isFeaturedDemo: program.isFeaturedDemo,
    });
  }, [program]);

  const createCourse = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch('/admin/courses', {
      method: 'POST',
      body: JSON.stringify({
        programId,
        title: newCourseTitle,
        description: '',
        orderIndex: (program?.courses.length ?? 0) + 1,
        isPublished: false,
      }),
    });
    setNewCourseTitle('');
    setStatus('Course created.');
    await load();
  };

  const saveProgram = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch(`/admin/programs/${programId}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    });
    setStatus('Program details saved.');
    await load();
  };

  const togglePublish = async () => {
    if (!program) return;
    await apiFetch(`/admin/programs/${program.id}/publish`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: !program.isPublished }),
    });
    setStatus(program.isPublished ? 'Program moved to draft.' : 'Program published.');
    await load();
  };

  if (!program) {
    return (
      <AppShell>
        <EmptyState
          description="The selected program could not be found."
          title="Program unavailable"
        />
      </AppShell>
    );
  }

  const titleInputId = 'program-title';
  const descriptionInputId = 'program-description';
  const disciplineSelectId = 'program-discipline';
  const featuredDemoId = 'program-featured-demo';
  const newCourseInputId = 'new-course-title';

  return (
    <AppShell>
      <div className="grid gap-600 xl:grid-cols-split">
        <form onSubmit={saveProgram}>
          <Card className="flex flex-col gap-500">
            <div className="flex flex-col gap-300">
              <h1 className="type-display-500">{program.title}</h1>
              <div className="flex flex-wrap items-center gap-200">
                <Badge label={getDisciplineLabel(program.discipline)} />
                {program.isFeaturedDemo ? <Badge label="Demo" /> : null}
                <Badge
                  label={program.isPublished ? 'Published' : 'Draft'}
                  variant={program.isPublished ? 'success' : 'neutral'}
                />
              </div>
            </div>

            <Field htmlFor={titleInputId} label="Program title">
              <Input
                id={titleInputId}
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              />
            </Field>
            <Field htmlFor={descriptionInputId} label="Program description">
              <Textarea
                id={descriptionInputId}
                rows={6}
                value={draft.description}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, description: event.target.value }))
                }
              />
            </Field>
            <Field htmlFor={disciplineSelectId} label="Discipline">
              <Select
                id={disciplineSelectId}
                value={draft.discipline}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, discipline: event.target.value as Discipline }))
                }
              >
                {Object.values(Discipline).map((discipline) => (
                  <option key={discipline} value={discipline}>
                    {getDisciplineLabel(discipline)}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox
              checked={draft.isFeaturedDemo}
              id={featuredDemoId}
              label="Featured demo program"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, isFeaturedDemo: event.target.checked }))
              }
            />
            <CardActions>
              <Button type="submit" variant="primary">
                Save program
              </Button>
              <Button onClick={togglePublish} variant="secondary">
                {program.isPublished ? 'Move to draft' : 'Publish program'}
              </Button>
            </CardActions>
            {status ? (
              <p aria-live="polite" className="text-body-200 text-foreground-success">
                {status}
              </p>
            ) : null}
          </Card>
        </form>

        <section className="flex flex-col gap-400">
          <SectionHeader title="Course list" />
          <form onSubmit={createCourse}>
            <Card className="flex flex-col gap-400">
              <Field htmlFor={newCourseInputId} label="New course">
                <Input
                  id={newCourseInputId}
                  placeholder="New course title"
                  value={newCourseTitle}
                  onChange={(event) => setNewCourseTitle(event.target.value)}
                />
              </Field>
              <CardActions>
                <Button type="submit" variant="secondary">
                  Add course
                </Button>
              </CardActions>
            </Card>
          </form>

          <List>
            {program.courses.map((course) => (
              <ListRow
                badges={
                  <>
                    {program.isFeaturedDemo ? <Badge label="Demo track" /> : null}
                    <Badge
                      label={course.isPublished ? 'Published' : 'Draft'}
                      variant={course.isPublished ? 'success' : 'neutral'}
                    />
                  </>
                }
                key={course.id}
                meta={`${course.lessons.length} lessons in this course`}
                stack
                title={course.title}
                trailing={
                  <ButtonLink href={`/admin/courses/${course.id}`} size="sm" variant="secondary">
                    Manage lessons
                  </ButtonLink>
                }
              />
            ))}
          </List>
        </section>
      </div>
    </AppShell>
  );
}
