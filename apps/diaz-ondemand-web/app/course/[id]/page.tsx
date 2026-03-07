import type { CourseDto, ProgramWithContentDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { CourseDetailView } from '@/components/course-detail-view';
import { EmptyState } from '@/components/empty-state';
import { apiFetchServer } from '@/lib/api-server';
import { findProgramForCourse } from '@/lib/student-ui';

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [course, programs] = await Promise.all([
      apiFetchServer<CourseDto>(`/courses/${id}`),
      apiFetchServer<ProgramWithContentDto[]>('/programs'),
    ]);
    const program = findProgramForCourse(programs, course.programId);

    return <CourseDetailView course={course} programTitle={program?.title ?? null} programs={programs} />;
  } catch (error) {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/library"
          ctaLabel="Back to library"
          description={`The course could not be loaded right now. ${error instanceof Error ? error.message : 'Unknown error.'}`}
          title="Course unavailable"
        />
      </AppShell>
    );
  }
}
