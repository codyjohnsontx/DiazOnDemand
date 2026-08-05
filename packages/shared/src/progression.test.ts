import { describe, expect, it } from 'vitest';
import { AccessLevel, VideoProvider } from './enums.js';
import { buildLessonQueue } from './progression.js';
import type { CourseDto, LessonSummary } from './schemas.js';

const courseId = '00000000-0000-4000-8000-000000000001';

function lesson(overrides: Partial<LessonSummary> & { id: string }): LessonSummary {
  return {
    courseId,
    title: 'Lesson',
    description: null,
    orderIndex: 1,
    isPublished: true,
    accessLevel: AccessLevel.PAID,
    videoProvider: VideoProvider.MUX,
    durationSeconds: 540,
    curriculum: null,
    ...overrides,
  };
}

function course(lessons: LessonSummary[]): CourseDto {
  return {
    id: courseId,
    programId: '00000000-0000-4000-8000-000000000002',
    title: 'Course',
    description: null,
    orderIndex: 1,
    isPublished: true,
    lessons,
  };
}

describe('buildLessonQueue', () => {
  it('labels the runtime of a lesson that has a video to run', () => {
    const [queued] = buildLessonQueue(
      course([lesson({ id: '00000000-0000-4000-8000-00000000000a' })]),
      [],
      '',
    );

    expect(queued?.durationLabel).toBe('9m');
  });

  it('drops the runtime of a lesson the read path resolved to no video', () => {
    // The seeded catalog keeps `durationSeconds` on lessons that were never
    // filmed, as the planned length. A member must not be shown it as a runtime:
    // an exact "9m" next to "This lesson has not been filmed" is the same small
    // dishonesty the not-filmed state exists to remove.
    const [queued] = buildLessonQueue(
      course([
        lesson({
          id: '00000000-0000-4000-8000-00000000000b',
          videoProvider: VideoProvider.NONE,
          durationSeconds: 540,
        }),
      ]),
      [],
      '',
    );

    expect(queued?.durationLabel).toBeNull();
  });

  it('keeps the runtime for a YouTube demonstration clip', () => {
    const [queued] = buildLessonQueue(
      course([
        lesson({
          id: '00000000-0000-4000-8000-00000000000c',
          videoProvider: VideoProvider.YOUTUBE,
          durationSeconds: 3600,
        }),
      ]),
      [],
      '',
    );

    expect(queued?.durationLabel).toBe('1h');
  });
});
