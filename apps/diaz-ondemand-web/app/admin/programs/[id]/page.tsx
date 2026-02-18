'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ProgramWithContentDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function AdminProgramDetailPage() {
  const params = useParams<{ id: string }>();
  const programId = params.id;
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');

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
    await load();
  };

  const togglePublish = async () => {
    if (!program) return;
    await apiFetch(`/admin/programs/${program.id}/publish`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: !program.isPublished }),
    });
    await load();
  };

  if (!program) {
    return <p>Loading program...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{program.title}</h1>
        <button className="rounded border px-3 py-2 text-sm" onClick={togglePublish}>
          {program.isPublished ? 'Unpublish' : 'Publish'}
        </button>
      </div>

      <form className="flex gap-2" onSubmit={createCourse}>
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="New course title"
          value={newCourseTitle}
          onChange={(event) => setNewCourseTitle(event.target.value)}
        />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">
          Add course
        </button>
      </form>

      <ul className="space-y-2">
        {program.courses.map((course) => (
          <li key={course.id} className="rounded border bg-white p-3">
            <div className="flex justify-between">
              <span>{course.title}</span>
              <Link href={`/admin/courses/${course.id}`}>Manage lessons</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
