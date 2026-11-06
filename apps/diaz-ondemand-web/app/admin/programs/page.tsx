'use client';

import Link from 'next/link';
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
import { PremiumBadge } from '@/components/premium-badge';
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
    <AppShell className="space-y-8">
      <PageHeader
        actions={
          role === Role.ADMIN || role === Role.COACH ? (
            <Link
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
              href="/admin/journal"
            >
              Journal
            </Link>
          ) : undefined
        }
        title="Programs"
      />

      {error ? (
        <EmptyState description={error} title="Admin unavailable" />
      ) : (
        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <form className="surface-panel space-y-5 p-6" onSubmit={onSubmit}>
            <h2 className="type-title-lg text-[var(--text)]">New program</h2>
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={titleInputId}>
                Program title
              </label>
              <input
                id={titleInputId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
                placeholder="New program title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="type-kicker text-[var(--text-muted)]" htmlFor={disciplineSelectId}>
                Discipline
              </label>
              <select
                id={disciplineSelectId}
                className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
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
              </select>
            </div>
            <label
              className="flex items-center gap-3 text-sm text-[var(--text-muted)]"
              htmlFor={featuredDemoId}
            >
              <input
                id={featuredDemoId}
                checked={form.isFeaturedDemo}
                className="h-4 w-4 rounded border-white/10 bg-[var(--surface-2)]"
                onChange={(event) =>
                  setForm((current) => ({ ...current, isFeaturedDemo: event.target.checked }))
                }
                type="checkbox"
              />
              Featured demo program
            </label>
            {formError ? (
              <p
                aria-atomic="true"
                aria-live="assertive"
                className="text-sm text-[var(--danger)]"
                role="alert"
              >
                {formError}
              </p>
            ) : null}
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:opacity-60"
              disabled={submitting || !form.title.trim()}
              type="submit"
            >
              {submitting ? 'Creating...' : 'Create program'}
            </button>
          </form>

          <div className="surface-panel space-y-4 p-6">
            <div className="flex items-end justify-between gap-4">
              <h2 className="type-title-lg text-[var(--text)]">{programs.length} programs</h2>
              <PremiumBadge label="Operations view" />
            </div>
            {programs.length === 0 ? (
              <EmptyState
                ctaHref="/admin/programs"
                ctaLabel="Create the first program"
                title="No programs yet"
              />
            ) : (
              <div className="space-y-3">
                {programs.map((program) => (
                  <div
                    className="surface-panel-muted flex items-center justify-between gap-4 p-4"
                    key={program.id}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-2xl leading-tight text-[var(--text)]">
                          {program.title}
                        </h3>
                        <PremiumBadge label={getDisciplineLabel(program.discipline)} />
                        {program.isFeaturedDemo ? (
                          <PremiumBadge label="Demo" tone="accent" />
                        ) : null}
                        <PremiumBadge
                          label={program.isPublished ? 'Published' : 'Draft'}
                          tone={program.isPublished ? 'accent' : 'neutral'}
                        />
                      </div>
                      <p className="text-sm text-[var(--text-muted)]">
                        {program.courses.length} courses,{' '}
                        {program.courses.reduce((sum, course) => sum + course.lessons.length, 0)}{' '}
                        lessons
                      </p>
                    </div>
                    <Link
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                      href={`/admin/programs/${program.id}`}
                    >
                      Manage
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}
