export {
  buildCourseProgress,
  buildLessonQueue,
  createProgressMap,
  findProgramForCourse,
  formatCurriculumLabel,
  formatDuration,
  getAccessLabel,
  getLessonProgressPercent,
  getPosterIndex,
  type CourseProgressModel,
  type LessonQueueItem,
} from '@diaz/shared';

import type { ProgramWithContentDto, ProgressDto } from '@diaz/shared';
import {
  buildCourseProgress,
  formatDuration,
  getLessonProgressPercent,
  getPosterIndex,
} from '@diaz/shared';

export type CourseCardModel = {
  id: string;
  href: string;
  title: string;
  programTitle: string;
  description: string | null;
  lessonCount: number;
  totalDurationLabel: string | null;
  accessLabel: string;
  progressPercent: number | null;
  nextLessonTitle: string | null;
  posterIndex: number;
};

export type ContinueWatchingItem = {
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  programTitle: string;
  progressPercent: number;
  posterIndex: number;
};

export function buildCourseCardModel(
  program: ProgramWithContentDto,
  course: ProgramWithContentDto['courses'][number],
  progress: ProgressDto[],
) {
  const totalDurationSeconds = (course.lessons ?? []).reduce(
    (sum, lesson) => sum + (lesson.durationSeconds ?? 0),
    0,
  );
  const courseProgress = buildCourseProgress(course, progress);
  const accessLabel = course.lessons.some((lesson) => lesson.accessLevel === 'PAID')
    ? 'Includes premium lessons'
    : 'Free course';
  const totalDurationLabel = formatDuration(totalDurationSeconds);
  const nextLessonTitle =
    course.lessons.find((lesson) => lesson.id === courseProgress.inProgressLessonId)?.title ??
    course.lessons.find((lesson) => lesson.id === courseProgress.nextLessonId)?.title ??
    null;

  return {
    id: course.id,
    href: `/course/${course.id}`,
    title: course.title,
    programTitle: program.title,
    description: course.description ?? null,
    lessonCount: course.lessons.length,
    totalDurationLabel,
    accessLabel,
    progressPercent: courseProgress.percent > 0 ? courseProgress.percent : null,
    nextLessonTitle,
    posterIndex: getPosterIndex(`${program.id}:${course.id}:${course.title}`),
  } satisfies CourseCardModel;
}

export function buildContinueWatching(programs: ProgramWithContentDto[], progress: ProgressDto[]) {
  const lessonLookup = new Map<
    string,
    {
      lesson: ProgramWithContentDto['courses'][number]['lessons'][number];
      courseTitle: string;
      programTitle: string;
    }
  >();

  for (const program of programs) {
    for (const course of program.courses) {
      for (const lesson of course.lessons) {
        lessonLookup.set(lesson.id, {
          lesson,
          courseTitle: course.title,
          programTitle: program.title,
        });
      }
    }
  }

  return [...progress]
    .filter((entry) => entry.completed || entry.lastPositionSeconds > 0)
    .sort((left, right) => {
      const leftDate = left.updatedAt instanceof Date ? left.updatedAt : new Date(left.updatedAt);
      const rightDate = right.updatedAt instanceof Date ? right.updatedAt : new Date(right.updatedAt);
      return rightDate.getTime() - leftDate.getTime();
    })
    .map((entry) => {
      const match = lessonLookup.get(entry.lessonId);

      if (!match) {
        return null;
      }

      return {
        lessonId: match.lesson.id,
        lessonTitle: match.lesson.title,
        courseTitle: match.courseTitle,
        programTitle: match.programTitle,
        progressPercent: getLessonProgressPercent(match.lesson, entry),
        posterIndex: getPosterIndex(`${match.programTitle}:${match.courseTitle}:${match.lesson.title}`),
      } satisfies ContinueWatchingItem;
    })
    .filter((entry): entry is ContinueWatchingItem => entry !== null);
}
