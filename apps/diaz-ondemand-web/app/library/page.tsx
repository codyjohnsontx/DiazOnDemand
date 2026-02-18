import Link from 'next/link';
import type { ProgramWithContentDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default async function LibraryPage() {
  const programs = await apiFetch<ProgramWithContentDto[]>('/programs');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Library</h1>
      {programs.map((program) => (
        <section key={program.id} className="rounded border bg-white p-4">
          <h2 className="text-xl font-medium">{program.title}</h2>
          <p className="text-sm text-gray-600">{program.description}</p>
          <div className="mt-4 space-y-3">
            {program.courses.map((course) => (
              <div key={course.id}>
                <h3 className="font-medium">{course.title}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {course.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex items-center justify-between rounded bg-gray-50 p-2">
                      <span>{lesson.title}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">{lesson.accessLevel}</span>
                        <Link href={`/lesson/${lesson.id}`}>Open</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
