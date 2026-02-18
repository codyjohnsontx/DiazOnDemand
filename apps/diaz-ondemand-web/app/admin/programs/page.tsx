'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { ProgramWithContentDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function AdminProgramsPage() {
  const [programs, setPrograms] = useState<ProgramWithContentDto[]>([]);
  const [title, setTitle] = useState('');

  const load = async () => {
    const data = await apiFetch<ProgramWithContentDto[]>('/admin/programs');
    setPrograms(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await apiFetch('/admin/programs', {
      method: 'POST',
      body: JSON.stringify({ title, description: '', orderIndex: programs.length + 1, isPublished: false }),
    });
    setTitle('');
    await load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin Programs</h1>
      <form className="flex gap-2" onSubmit={onSubmit}>
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="New program title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">
          Create
        </button>
      </form>

      <ul className="space-y-2">
        {programs.map((program) => (
          <li key={program.id} className="rounded border bg-white p-3">
            <div className="flex items-center justify-between">
              <span>{program.title}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{program.isPublished ? 'Published' : 'Draft'}</span>
                <Link href={`/admin/programs/${program.id}`}>Manage</Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
