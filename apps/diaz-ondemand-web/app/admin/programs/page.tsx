'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  Discipline,
  Role,
  getDisciplineLabel,
  type MeDto,
  type ProgramWithContentDto,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SectionHeader } from '@/components/section-header';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { List, ListRow } from '@/components/ui/list';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

const DEFAULT_PROGRAM_FORM = {
  title: '',
  discipline: Discipline.BJJ,
  isFeaturedDemo: false,
};

export default function AdminProgramsPage() {
  const apiFetch = useApiClient();
  const featuredDemoId = 'is-featured-demo';
  const titleInputId = 'program-title';
  const disciplineSelectId = 'program-discipline';
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [form, setForm] = useState(DEFAULT_PROGRAM_FORM);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [role, setRole] = useState<Role | null>(null);

  const load = async () => {
    try {
      const data = await apiFetch<ProgramWithContentDto[]>('/admin/programs');
      setPrograms(data);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 403
          ? 'You do not have admin access for this area.'
          : 'Programs could not be loaded right now.',
      );
    }
  };

  useEffect(() => {
    void load();
    // Mount-only load, kept as-is: load is a new closure on every render, so listing it would
    // re-run this effect after every render, and since load sets state that is an endless fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiFetch<MeDto>('/me')
      .then((me) => setRole(me.role))
      .catch(() => setRole(null));
  }, [apiFetch]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const normalizedTitle = form.title.trim();

    try {
      await apiFetch('/admin/programs', {
        method: 'POST',
        body: JSON.stringify({
          title: normalizedTitle,
          description: '',
          orderIndex: programs.length + 1,
          discipline: form.discipline,
          isFeaturedDemo: form.isFeaturedDemo,
          isPublished: false,
        }),
      });
      setForm(DEFAULT_PROGRAM_FORM);
      await load();
    } catch (requestError) {
      setFormError(
        requestError instanceof ApiError && requestError.status === 403
          ? 'You do not have admin access to create programs.'
          : 'Program could not be created right now. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        actions={
          role === Role.ADMIN ? (
            <ButtonLink href="/admin/members" variant="secondary">
              Members
            </ButtonLink>
          ) : undefined
        }
        title="Programs"
      />

      {error ? (
        <EmptyState description={error} title="Admin unavailable" />
      ) : (
        <section className="grid gap-600 xl:grid-cols-split">
          <form className="flex flex-col gap-500" onSubmit={onSubmit}>
            <Card className="flex flex-col gap-500">
              <h2 className="type-display-500">New program</h2>
              <Field htmlFor={titleInputId} label="Program title">
                <Input
                  id={titleInputId}
                  placeholder="New program title"
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </Field>
              <Field htmlFor={disciplineSelectId} label="Discipline">
                <Select
                  id={disciplineSelectId}
                  value={form.discipline}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      discipline: event.target.value as Discipline,
                    }))
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
                checked={form.isFeaturedDemo}
                id={featuredDemoId}
                label="Featured demo program"
                onChange={(event) =>
                  setForm((current) => ({ ...current, isFeaturedDemo: event.target.checked }))
                }
              />
              {formError ? (
                <p
                  aria-atomic="true"
                  aria-live="assertive"
                  className="text-body-200 text-foreground-critical"
                  role="alert"
                >
                  {formError}
                </p>
              ) : null}
              <CardActions>
                <Button disabled={submitting || !form.title.trim()} type="submit" variant="primary">
                  {submitting ? 'Creating...' : 'Create program'}
                </Button>
              </CardActions>
            </Card>
          </form>

          <div className="flex flex-col gap-400">
            <SectionHeader
              detail={<Badge label="Operations view" />}
              title={`${programs.length} programs`}
            />
            {programs.length === 0 ? (
              <EmptyState
                ctaHref="/admin/programs"
                ctaLabel="Create the first program"
                title="No programs yet"
              />
            ) : (
              <List>
                {programs.map((program) => (
                  <ListRow
                    badges={
                      <>
                        <Badge label={getDisciplineLabel(program.discipline)} />
                        {program.isFeaturedDemo ? <Badge label="Demo" /> : null}
                        <Badge
                          label={program.isPublished ? 'Published' : 'Draft'}
                          variant={program.isPublished ? 'success' : 'neutral'}
                        />
                      </>
                    }
                    key={program.id}
                    meta={`${program.courses.length} courses, ${program.courses.reduce((sum, course) => sum + course.lessons.length, 0)} lessons`}
                    stack
                    title={program.title}
                    trailing={
                      <ButtonLink
                        href={`/admin/programs/${program.id}`}
                        size="sm"
                        variant="secondary"
                      >
                        Manage
                      </ButtonLink>
                    }
                  />
                ))}
              </List>
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}
