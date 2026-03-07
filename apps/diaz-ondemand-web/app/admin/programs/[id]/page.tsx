'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ProgramWithContentDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';

export default function AdminProgramDetailPage() {
  const params = useParams<{ id: string }>();
  const programId = params.id;
  const apiFetch = useApiClient();
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [draft, setDraft] = useState({ title: '', description: '' });
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
  }, []);

  useEffect(() => {
    if (!program) {
      return;
    }

    setDraft({
      title: program.title,
      description: program.description ?? '',
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
        <EmptyState description="The selected program could not be found." title="Program unavailable" />
      </AppShell>
    );
  }

  return (
    <AppShell className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form className="surface-panel space-y-5 p-6" onSubmit={saveProgram}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Program settings</p>
              <h1 className="font-display text-4xl uppercase tracking-[0.03em] text-[var(--text)]">{program.title}</h1>
            </div>
            <PremiumBadge label={program.isPublished ? 'Published' : 'Draft'} tone={program.isPublished ? 'accent' : 'neutral'} />
          </div>

          <input
            className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
          />
          <textarea
            className="min-h-[180px] w-full rounded-[24px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
            rows={6}
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
          <div className="flex flex-wrap gap-3">
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              type="submit"
            >
              Save program
            </button>
            <button
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
              onClick={togglePublish}
              type="button"
            >
              {program.isPublished ? 'Move to draft' : 'Publish program'}
            </button>
          </div>
          {status ? <p className="text-sm text-[var(--progress)]">{status}</p> : null}
        </form>

        <section className="space-y-5">
          <form className="surface-panel space-y-4 p-6" onSubmit={createCourse}>
            <div className="space-y-2">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Add course</p>
              <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">Course list</h2>
            </div>
            <input
              className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
              placeholder="New course title"
              value={newCourseTitle}
              onChange={(event) => setNewCourseTitle(event.target.value)}
            />
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              type="submit"
            >
              Add course
            </button>
          </form>

          <div className="space-y-3">
            {program.courses.map((course) => (
              <div className="surface-panel-muted flex items-center justify-between gap-4 p-4" key={course.id}>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-2xl uppercase tracking-[0.03em] text-[var(--text)]">{course.title}</h3>
                    <PremiumBadge label={course.isPublished ? 'Published' : 'Draft'} tone={course.isPublished ? 'accent' : 'neutral'} />
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">{course.lessons.length} lessons in this course</p>
                </div>
                <Link
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                  href={`/admin/courses/${course.id}`}
                >
                  Manage lessons
                </Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
