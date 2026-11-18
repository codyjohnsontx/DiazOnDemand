import { Badge } from '@/components/ui/badge';
import { ListRow } from '@/components/ui/list';

/**
 * One lesson in a course queue. The order, tier and curriculum go in the meta line; the
 * two states a member acts on - up next, completed - are badges beside the title, and the
 * lesson being watched is the selected row.
 */
export function LessonRow({
  href,
  orderLabel,
  title,
  durationLabel,
  accessLabel,
  curriculumLabel,
  isCompleted,
  isCurrent,
  isNext,
}: {
  href: string;
  orderLabel: string;
  title: string;
  durationLabel: string | null;
  accessLabel: string;
  curriculumLabel?: string | null;
  isCompleted: boolean;
  isCurrent: boolean;
  isNext: boolean;
}) {
  return (
    <ListRow
      badges={
        <>
          {isNext ? <Badge label="Up next" /> : null}
          {isCompleted ? <Badge label="Completed" variant="success" /> : null}
        </>
      }
      href={href}
      meta={[`Lesson ${orderLabel}`, accessLabel, curriculumLabel].filter(Boolean).join(' · ')}
      selected={isCurrent}
      title={title}
      trailing={durationLabel ? <span className="text-body-200">{durationLabel}</span> : null}
    />
  );
}
