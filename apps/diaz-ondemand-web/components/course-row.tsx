import type { CourseCardModel } from '@/lib/student-ui';
import { Badge } from '@/components/ui/badge';
import { ListRow } from '@/components/ui/list';
import { Progress } from '@/components/ui/progress';

/** Program, lesson count, runtime and progress in the meta line; the tier as the badge. */
export function CourseRow({ course }: { course: CourseCardModel }) {
  const meta = [
    course.programTitle,
    `${course.lessonCount} lessons`,
    course.totalDurationLabel,
    course.progressPercent !== null ? `${course.progressPercent}% watched` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow
      href={course.href}
      meta={meta}
      title={course.title}
      trailing={
        course.accessLabel === 'Includes premium lessons' ? (
          <Badge label="Premium" variant="premium" />
        ) : (
          <Badge label="Free" />
        )
      }
    >
      {course.progressPercent !== null ? (
        <Progress
          ariaLabel={`${course.title} progress`}
          className="mt-100"
          value={course.progressPercent}
        />
      ) : null}
    </ListRow>
  );
}
