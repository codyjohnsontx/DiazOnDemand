'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AccessLevel, ProgramWithContentDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function AdminLessonDetailPage() {
  const params = useParams<{ id: string }>();
  const lessonId = params.id;
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    accessLevel: 'FREE' as AccessLevel,
    muxPlaybackId: '',
  });

  const lesson = useMemo(() => {
    for (const program of programs) {
      for (const course of program.courses) {
        const found = course.lessons.find((entry) => entry.id === lessonId);
        if (found) return found;
      }
    }
    return null;
  }, [lessonId, programs]);

  const load = async () => {
    const data = await apiFetch<ProgramWithContentDto[]>('/admin/programs');
    setPrograms(data);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!lesson) return;
    setForm({
      title: lesson.title,
      description: lesson.description ?? '',
      accessLevel: lesson.accessLevel,
      muxPlaybackId: lesson.muxPlaybackId ?? '',
    });
  }, [lesson]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch(`/admin/lessons/${lessonId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...form,
      }),
    });
    await load();
  };

  const togglePublish = async () => {
    if (!lesson) return;
    await apiFetch(`/admin/lessons/${lesson.id}/publish`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: !lesson.isPublished }),
    });
    await load();
  };

  if (!lesson) {
    return <p>Loading lesson...</p>;
  }

  return (
    <form className="space-y-4 rounded border bg-white p-6" onSubmit={onSave}>
      <h1 className="text-2xl font-semibold">Edit Lesson</h1>
      <input
        className="w-full rounded border px-3 py-2"
        value={form.title}
        onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
      />
      <textarea
        className="w-full rounded border px-3 py-2"
        rows={4}
        value={form.description}
        onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
      />
      <select
        className="w-full rounded border px-3 py-2"
        value={form.accessLevel}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, accessLevel: event.target.value as AccessLevel }))
        }
      >
        <option value="FREE">FREE</option>
        <option value="PAID">PAID</option>
      </select>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Mux playback ID"
        value={form.muxPlaybackId}
        onChange={(event) => setForm((prev) => ({ ...prev, muxPlaybackId: event.target.value }))}
      />

      <div className="flex gap-2">
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">
          Save
        </button>
        <button className="rounded border px-4 py-2" onClick={togglePublish} type="button">
          {lesson.isPublished ? 'Unpublish' : 'Publish'}
        </button>
      </div>
    </form>
  );
}
