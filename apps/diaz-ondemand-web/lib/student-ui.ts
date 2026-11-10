export {
  buildCourseProgress,
  buildLessonQueue,
  createProgressMap,
  findProgramForCourse,
  formatCurriculumLabel,
  formatDuration,
  getCurriculumPhaseLabel,
  getDisciplineLabel,
  getAccessLabel,
  getLessonProgressPercent,
  type CourseProgressModel,
  type LessonQueueItem,
} from '@diaz/shared';

import type { ProgramWithContentDto, ProgressDto } from '@diaz/shared';
import {
  AccessLevel,
  buildCourseProgress,
  formatDuration,
  getDisciplineLabel,
  getLessonProgressPercent,
  hasPlayableVideo,
} from '@diaz/shared';

export type CourseCardModel = {
  id: string;
  href: string;
  title: string;
  programTitle: string;
  disciplineLabel: string;
  isFeaturedDemo: boolean;
  description: string | null;
  lessonCount: number;
  totalDurationLabel: string | null;
  accessLabel: string;
  progressPercent: number | null;
  nextLessonTitle: string | null;
};

export type ContinueWatchingItem = {
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  programTitle: string;
  progressPercent: number;
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
    disciplineLabel: getDisciplineLabel(program.discipline),
    isFeaturedDemo: program.isFeaturedDemo,
    description: course.description ?? null,
    lessonCount: course.lessons.length,
    totalDurationLabel,
    accessLabel,
    progressPercent: courseProgress.percent > 0 ? courseProgress.percent : null,
    nextLessonTitle,
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
      const rightDate =
        right.updatedAt instanceof Date ? right.updatedAt : new Date(right.updatedAt);
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
      } satisfies ContinueWatchingItem;
    })
    .filter((entry): entry is ContinueWatchingItem => entry !== null);
}

export type LibraryLessonEntry = {
  program: ProgramWithContentDto;
  course: ProgramWithContentDto['courses'][number];
  lesson: ProgramWithContentDto['courses'][number]['lessons'][number];
};

/**
 * Whether the visitor has started anything. A record with nothing watched
 * (position 0, not complete) counts as nothing started, which is the same
 * reading `buildContinueWatching` gives it.
 */
export function hasStartedAnyLesson(progress: ProgressDto[]) {
  return progress.some((entry) => entry.completed || entry.lastPositionSeconds > 0);
}

/**
 * The lesson the Library's Up next card leads with for a visitor who has
 * started nothing: a signed-out visitor, or a member with no progress of their
 * own. It is the first free lesson of the featured demo programs that
 * actually plays, in catalogue order, so "Open lesson" lands on a video rather
 * than on a not-yet-filmed training lesson.
 *
 * Answers null for a member with progress of their own, who keeps the
 * recommendation built from that progress, and null when no featured program
 * carries a playable free lesson, so the card falls back to the same
 * recommendation rather than hiding.
 */
export function findShowcaseUpNext(
  programs: ProgramWithContentDto[],
  progress: ProgressDto[],
): LibraryLessonEntry | null {
  if (hasStartedAnyLesson(progress)) {
    return null;
  }

  const byOrder = <T extends { orderIndex: number }>(items: T[]) =>
    [...items].sort((left, right) => left.orderIndex - right.orderIndex);

  for (const program of byOrder(programs.filter((program) => program.isFeaturedDemo))) {
    for (const course of byOrder(program.courses)) {
      const lesson = byOrder(course.lessons).find(
        (candidate) =>
          candidate.isPublished &&
          candidate.accessLevel === AccessLevel.FREE &&
          hasPlayableVideo(candidate),
      );

      if (lesson) {
        return { program, course, lesson };
      }
    }
  }

  return null;
}
