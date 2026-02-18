'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ProgramWithContentDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function AdminCourseDetailPage() {
  const params = useParams<{ id: string }>();
  const courseId = params.id;
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [newLessonTitle, setNewLessonTitle] = useState('');

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
      }),
    });
    setNewLessonTitle('');
    await load();
  };

  const togglePublish = async () => {
    if (!course) return;
    await apiFetch(`/admin/courses/${course.id}/publish`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: !course.isPublished }),
    });
    await load();
  };

  if (!course) {
    return <p>Loading course...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <button className="rounded border px-3 py-2 text-sm" onClick={togglePublish}>
          {course.isPublished ? 'Unpublish' : 'Publish'}
        </button>
      </div>

      <form className="flex gap-2" onSubmit={createLesson}>
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="New lesson title"
          value={newLessonTitle}
          onChange={(event) => setNewLessonTitle(event.target.value)}
        />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">
          Add lesson
        </button>
      </form>

      <ul className="space-y-2">
        {course.lessons.map((lesson) => (
          <li key={lesson.id} className="rounded border bg-white p-3">
            <div className="flex justify-between">
              <span>{lesson.title}</span>
              <Link href={`/admin/lessons/${lesson.id}`}>Edit</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
