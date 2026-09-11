import { AccessLevel } from './enums.js';
import { formatCurriculumMetadataLabel } from './curriculum.js';
import { hasPlayableVideo } from './video-source.js';
import type { CourseDto, LessonSummary, ProgramWithContentDto, ProgressDto } from './schemas.js';

type CourseWithLessons = ProgramWithContentDto['courses'][number] | CourseDto;

export type CourseProgressModel = {
  percent: number;
  completedLessons: number;
  totalLessons: number;
  continueLessonId: string | null;
  nextLessonId: string | null;
  inProgressLessonId: string | null;
};

export type LessonQueueItem = {
  id: string;
  href: string;
  orderLabel: string;
  title: string;
  durationLabel: string | null;
  accessLabel: string;
  isCompleted: boolean;
  isCurrent: boolean;
  isNext: boolean;
  curriculumLabel: string | null;
};

export type RecommendationModel = {
  lessonId: string | null;
  courseId: string | null;
  programId: string | null;
  title: string | null;
  description: string | null;
  reason: 'resume_lesson' | 'next_lesson' | 'next_course' | 'start_course' | 'none';
};

const STARTED_LESSON_FALLBACK_PERCENT = 35;

/**
 * How close to the end a saved position has to be before the lesson counts as
 * finished. The web player saves `completed: true` once fewer than this many
 * seconds remain, and `getResumePositionSeconds` starts such a lesson from the
 * beginning, so the two rules have to share the number or a position saved as
 * "complete" would resume at the credits.
 */
export const LESSON_COMPLETION_MARGIN_SECONDS = 10;

function sortLessons(lessons: LessonSummary[]) {
  return [...lessons].sort((left, right) => left.orderIndex - right.orderIndex);
}

function sortCourses(program: ProgramWithContentDto) {
  return [...program.courses].sort((left, right) => left.orderIndex - right.orderIndex);
}

function toTimestamp(value: ProgressDto['updatedAt']) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatMinutes(totalMinutes: number) {
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${Math.max(1, totalMinutes)}m`;
}

export function formatDuration(totalSeconds?: number | null) {
  if (!totalSeconds || totalSeconds <= 0) {
    return null;
  }

  return formatMinutes(Math.round(totalSeconds / 60));
}

export function createProgressMap(progress: ProgressDto[]) {
  return new Map(progress.map((entry) => [entry.lessonId, entry]));
}

export function getPosterIndex(seed: string, totalThemes = 6) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) % totalThemes;
}

export function getAccessLabel(lessons: LessonSummary[]) {
  return lessons.some((lesson) => lesson.accessLevel === AccessLevel.PAID)
    ? 'Includes premium lessons'
    : 'Free course';
}

export function getLessonProgressPercent(lesson: LessonSummary, progress?: ProgressDto) {
  if (!progress) {
    return 0;
  }

  if (progress.completed) {
    return 100;
  }

  if (lesson.durationSeconds && lesson.durationSeconds > 0) {
    return Math.max(
      4,
      Math.min(99, Math.round((progress.lastPositionSeconds / lesson.durationSeconds) * 100)),
    );
  }

  return progress.lastPositionSeconds > 0 ? STARTED_LESSON_FALLBACK_PERCENT : 0;
}

/**
 * Where playback should start when a member returns to a lesson. Every route
 * back to a lesson - the Resume link, the course queue, a pasted URL - lands on
 * the same page, so the page asks this once per lesson load and hands the
 * answer to the player as its start time. The saved record is the only input:
 * no timestamp travels in the URL.
 *
 * Starts from the beginning when there is nothing to resume: no record, a
 * record marked complete, or a position inside the last
 * `LESSON_COMPLETION_MARGIN_SECONDS` of the stored duration. A lesson whose
 * duration is unknown resumes at the saved position, because the save path
 * already marks it complete when it reached the end.
 */
export function getResumePositionSeconds(lesson: LessonSummary, progress?: ProgressDto) {
  if (!progress || progress.completed) {
    return 0;
  }

  const position = Math.floor(progress.lastPositionSeconds);

  if (!Number.isFinite(position) || position <= 0) {
    return 0;
  }

  if (
    lesson.durationSeconds &&
    lesson.durationSeconds > 0 &&
    position >= lesson.durationSeconds - LESSON_COMPLETION_MARGIN_SECONDS
  ) {
    return 0;
  }

  return position;
}

export function formatCurriculumLabel(lesson: LessonSummary) {
  if (!lesson.curriculum) {
    return null;
  }

  return formatCurriculumMetadataLabel(lesson.curriculum);
}

export function buildCourseProgress(course: CourseWithLessons, progress: ProgressDto[]): CourseProgressModel {
  const lessons = sortLessons(course.lessons ?? []);

  if (lessons.length === 0) {
    return {
      percent: 0,
      completedLessons: 0,
      totalLessons: 0,
      continueLessonId: null,
      nextLessonId: null,
      inProgressLessonId: null,
    };
  }

  const progressMap = createProgressMap(progress);
  const lessonStates = lessons.map((lesson) => {
    const entry = progressMap.get(lesson.id);

    return {
      lesson,
      progress: entry,
      percent: getLessonProgressPercent(lesson, entry),
      updatedAt: entry ? toTimestamp(entry.updatedAt) : 0,
    };
  });

  const completedLessons = lessonStates.filter((entry) => entry.progress?.completed).length;
  const totalPercent = Math.round(
    lessonStates.reduce((sum, entry) => sum + entry.percent, 0) / Math.max(1, lessons.length),
  );
  const inProgress = [...lessonStates]
    .filter((entry) => entry.progress && !entry.progress.completed && entry.percent > 0)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const firstIncomplete = lessonStates.find((entry) => !entry.progress?.completed) ?? null;

  return {
    percent: totalPercent,
    completedLessons,
    totalLessons: lessons.length,
    continueLessonId: inProgress[0]?.lesson.id ?? firstIncomplete?.lesson.id ?? lessons[0]?.id ?? null,
    nextLessonId: firstIncomplete?.lesson.id ?? null,
    inProgressLessonId: inProgress[0]?.lesson.id ?? null,
  };
}

export function buildLessonQueue(
  course: CourseWithLessons,
  progress: ProgressDto[],
  currentLessonId: string,
): LessonQueueItem[] {
  const progressMap = createProgressMap(progress);
  const courseProgress = buildCourseProgress(course, progress);

  return sortLessons(course.lessons ?? []).map((lesson) => ({
    id: lesson.id,
    href: `/lesson/${lesson.id}`,
    orderLabel: lesson.orderIndex.toString().padStart(2, '0'),
    title: lesson.title,
    durationLabel: hasPlayableVideo(lesson) ? formatDuration(lesson.durationSeconds) : null,
    accessLabel: lesson.accessLevel === AccessLevel.PAID ? 'Premium' : 'Free',
    isCompleted: Boolean(progressMap.get(lesson.id)?.completed),
    isCurrent: lesson.id === currentLessonId,
    isNext: lesson.id === courseProgress.nextLessonId && lesson.id !== currentLessonId,
    curriculumLabel: formatCurriculumLabel(lesson),
  }));
}

export function findProgramForCourse(programs: ProgramWithContentDto[], programId: string) {
  return programs.find((program) => program.id === programId) ?? null;
}

export function buildRecommendation(
  programs: ProgramWithContentDto[],
  courseId: string,
  progress: ProgressDto[],
): RecommendationModel {
  for (const program of programs) {
    const courses = sortCourses(program);
    const currentCourseIndex = courses.findIndex((course) => course.id === courseId);

    if (currentCourseIndex === -1) {
      continue;
    }

    const currentCourse = courses[currentCourseIndex];
    if (!currentCourse) {
      continue;
    }

    const currentProgress = buildCourseProgress(currentCourse, progress);

    if (currentProgress.inProgressLessonId) {
      const lesson = currentCourse.lessons?.find((entry) => entry.id === currentProgress.inProgressLessonId) ?? null;

      return {
        lessonId: lesson?.id ?? null,
        courseId: currentCourse.id,
        programId: program.id,
        title: lesson?.title ?? null,
        description: lesson?.description ?? null,
        reason: 'resume_lesson',
      };
    }

    if (currentProgress.nextLessonId) {
      const lesson = currentCourse.lessons?.find((entry) => entry.id === currentProgress.nextLessonId) ?? null;

      return {
        lessonId: lesson?.id ?? null,
        courseId: currentCourse.id,
        programId: program.id,
        title: lesson?.title ?? null,
        description: lesson?.description ?? null,
        reason: currentProgress.percent > 0 ? 'next_lesson' : 'start_course',
      };
    }

    const nextCourse = courses[currentCourseIndex + 1] ?? null;
    if (nextCourse) {
      return {
        lessonId: nextCourse.lessons?.[0]?.id ?? null,
        courseId: nextCourse.id,
        programId: program.id,
        title: nextCourse.title,
        description: nextCourse.description ?? null,
        reason: 'next_course',
      };
    }
  }

  return {
    lessonId: null,
    courseId: null,
    programId: null,
    title: null,
    description: null,
    reason: 'none',
  };
}
