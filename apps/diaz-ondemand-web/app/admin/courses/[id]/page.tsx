'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ProgramWithContentDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PremiumBadge } from '@/components/premium-badge';
import { useApiClient } from '@/lib/api-client';

export default function AdminCourseDetailPage() {
  const params = useParams<{ id: string }>();
  const courseId = params.id;
  const apiFetch = useApiClient();
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const course = useMemo(() => {
    for (const program of programs) {
      const found = program.courses.find((entry) => entry.id === courseId);
      if (found) return found;
    }
    return null;
  }, [courseId, programs]);

  const load = async () => {
    const data = await apiFetch<ProgramWithContentDto[]>('/admin/programs');
    setPrograms(data);
  };

  useEffect(() => {
    void load();
  }, []);

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
        curriculum: course?.lessons[0]?.curriculum ?? {
          block: 'fundamentals',
          position: 'guard-retention',
          track: 'defense',
        },
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
        <EmptyState description="The selected course could not be found." title="Course unavailable" />
      </AppShell>
    );
  }

  const publishedLessons = course.lessons.filter((lesson) => lesson.isPublished).length;

  return (
    <AppShell className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="surface-panel space-y-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Course summary</p>
              <h1 className="font-display text-4xl uppercase tracking-[0.03em] text-[var(--text)]">{course.title}</h1>
            </div>
            <PremiumBadge label={course.isPublished ? 'Published' : 'Draft'} tone={course.isPublished ? 'accent' : 'neutral'} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-panel-muted p-4">
              <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Lessons</p>
              <p className="mt-3 font-display text-4xl uppercase text-[var(--text)]">{course.lessons.length}</p>
            </div>
            <div className="surface-panel-muted p-4">
              <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Published</p>
              <p className="mt-3 font-display text-4xl uppercase text-[var(--text)]">{publishedLessons}</p>
            </div>
            <div className="surface-panel-muted p-4">
              <p className="font-display text-xs uppercase tracking-[0.24em] text-[var(--text-muted)]">Premium</p>
              <p className="mt-3 font-display text-4xl uppercase text-[var(--text)]">
                {course.lessons.filter((lesson) => lesson.accessLevel === 'PAID').length}
              </p>
            </div>
          </div>
          <button
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
            onClick={togglePublish}
            type="button"
          >
            {course.isPublished ? 'Move to draft' : 'Publish course'}
          </button>
          {status ? <p className="text-sm text-[var(--progress)]">{status}</p> : null}
        </section>

        <section className="space-y-5">
          <form className="surface-panel space-y-4 p-6" onSubmit={createLesson}>
            <div className="space-y-2">
              <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Add lesson</p>
              <h2 className="font-display text-3xl uppercase tracking-[0.03em] text-[var(--text)]">Lesson queue</h2>
            </div>
            <input
              className="w-full rounded-[20px] border border-white/10 bg-[var(--surface-2)] px-4 py-3 text-[var(--text)]"
              placeholder="New lesson title"
              value={newLessonTitle}
              onChange={(event) => setNewLessonTitle(event.target.value)}
            />
            <button
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              type="submit"
            >
              Add lesson
            </button>
          </form>

          <div className="space-y-3">
            {[...course.lessons]
              .sort((left, right) => left.orderIndex - right.orderIndex)
              .map((lesson, index, sorted) => (
                <div className="surface-panel-muted flex items-center justify-between gap-4 p-4" key={lesson.id}>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-2xl uppercase tracking-[0.03em] text-[var(--text)]">{lesson.title}</h3>
                      <PremiumBadge label={lesson.accessLevel === 'PAID' ? 'Premium' : 'Free'} tone={lesson.accessLevel === 'PAID' ? 'premium' : 'accent'} />
                      <PremiumBadge label={lesson.isPublished ? 'Published' : 'Draft'} tone={lesson.isPublished ? 'accent' : 'neutral'} />
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">
                      {lesson.curriculum
                        ? `${lesson.curriculum.position.replaceAll('-', ' ')} / ${lesson.curriculum.track}`
                        : 'Curriculum metadata not set'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-full border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)] disabled:opacity-35"
                      disabled={index === 0}
                      onClick={() => void moveLesson(lesson.id, -1)}
                      type="button"
                    >
                      Up
                    </button>
                    <button
                      className="rounded-full border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)] disabled:opacity-35"
                      disabled={index === sorted.length - 1}
                      onClick={() => void moveLesson(lesson.id, 1)}
                      type="button"
                    >
                      Down
                    </button>
                    <Link
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
                      href={`/admin/lessons/${lesson.id}`}
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
