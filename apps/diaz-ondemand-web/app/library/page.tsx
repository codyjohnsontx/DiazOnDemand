import type { ProgramWithContentDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { LibraryView } from '@/components/library-view';
import { apiFetchServer } from '@/lib/api-server';

export default async function LibraryPage() {
  try {
    const programs = await apiFetchServer<ProgramWithContentDto[]>('/programs');
    return <LibraryView programs={programs} />;
  } catch (error) {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/subscribe"
          ctaLabel="View premium access"
          description={`The library could not be loaded right now. ${error instanceof Error ? error.message : 'Unknown error.'}`}
          title="Library unavailable"
        />
      </AppShell>
    );
  }
}
