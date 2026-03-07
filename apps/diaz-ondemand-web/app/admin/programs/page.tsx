'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { ProgramWithContentDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

export default function AdminProgramsPage() {
  const apiFetch = useApiClient();
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await apiFetch('/admin/programs', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: '',
          orderIndex: programs.length + 1,
          isPublished: false,
        }),
      });
      setTitle('');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="Manage program order, publish state, and where instructors branch into structured course trees."
        eyebrow="Admin"
        title="Programs"
      />

      {error ? (
        <EmptyState description={error} title="Admin unavailable" />
      ) : (
        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <form className="surface-panel space-y-5 p-6" onSubmit={onSubmit}>
            <div className="space-y-2">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Create program</p>
              <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">New program</h2>
            </div>
            <input
              className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
              placeholder="New program title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:opacity-60"
              disabled={submitting || !title.trim()}
              type="submit"
            >
              {submitting ? 'Creating...' : 'Create program'}
            </button>
          </form>

          <div className="surface-panel space-y-4 p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Program list</p>
                <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">
                  {programs.length} programs
                </h2>
              </div>
              <PremiumBadge label="Operations view" />
            </div>
            {programs.length === 0 ? (
              <EmptyState
                ctaHref="/admin/programs"
                ctaLabel="Create the first program"
                description="Start with a fundamentals program, then add courses and lessons inside it."
                title="No programs yet"
              />
            ) : (
              <div className="space-y-3">
                {programs.map((program) => (
                  <div className="surface-panel-muted flex items-center justify-between gap-4 p-4" key={program.id}>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-2xl uppercase tracking-[0.03em] text-[var(--text)]">
                          {program.title}
                        </h3>
                        <PremiumBadge label={program.isPublished ? 'Published' : 'Draft'} tone={program.isPublished ? 'accent' : 'neutral'} />
                      </div>
                      <p className="text-sm text-[var(--text-muted)]">
                        {program.courses.length} courses, {program.courses.reduce((sum, course) => sum + course.lessons.length, 0)} lessons
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
