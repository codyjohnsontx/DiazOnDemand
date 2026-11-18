import type { ContinueWatchingItem } from '@/lib/student-ui';
import { ListRow } from '@/components/ui/list';
import { Progress } from '@/components/ui/progress';

export function ContinueRow({ item }: { item: ContinueWatchingItem }) {
  const clamped = Math.max(0, Math.min(100, Math.round(item.progressPercent)));

  return (
    <ListRow
      href={`/lesson/${item.lessonId}`}
      meta={`${item.courseTitle} · ${item.programTitle} · ${clamped}% watched`}
      title={item.lessonTitle}
      trailing={<span className="text-body-200 font-semibold text-foreground-primary">Resume</span>}
    >
      <Progress
        ariaLabel={`${item.lessonTitle} progress`}
        className="mt-100"
        value={item.progressPercent}
      />
    </ListRow>
  );
}
