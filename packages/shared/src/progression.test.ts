import { describe, expect, it } from 'vitest';
import { AccessLevel, VideoProvider } from './enums.js';
import {
  LESSON_COMPLETION_MARGIN_SECONDS,
  buildLessonQueue,
  getResumePositionSeconds,
} from './progression.js';
import type { CourseDto, LessonSummary, ProgressDto } from './schemas.js';

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

describe('getResumePositionSeconds', () => {
  const lessonId = '00000000-0000-4000-8000-00000000000a';

  function progress(overrides: Partial<ProgressDto>): ProgressDto {
    return {
      id: '00000000-0000-4000-8000-0000000000aa',
      userId: '00000000-0000-4000-8000-0000000000ab',
      lessonId,
      lastPositionSeconds: 0,
      completed: false,
      updatedAt: new Date('2026-09-11T00:00:00Z'),
      ...overrides,
    };
  }

  it('resumes at the saved position of a lesson stopped part way through', () => {
    // The reproduced defect: 38 seconds saved into a 134-second video, and
    // Resume started playback at 0.
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: 134 }),
        progress({ lastPositionSeconds: 38 }),
      ),
    ).toBe(38);
  });

  it('starts from the beginning when there is no saved progress', () => {
    expect(
      getResumePositionSeconds(lesson({ id: lessonId, durationSeconds: 134 }), undefined),
    ).toBe(0);
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: 134 }),
        progress({ lastPositionSeconds: 0 }),
      ),
    ).toBe(0);
  });

  it('starts from the beginning for a lesson marked complete', () => {
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: 134 }),
        progress({ lastPositionSeconds: 60, completed: true }),
      ),
    ).toBe(0);
  });

  it('starts from the beginning when the saved position is at or past the end', () => {
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: 134 }),
        progress({ lastPositionSeconds: 134 }),
      ),
    ).toBe(0);
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: 134 }),
        progress({ lastPositionSeconds: 500 }),
      ),
    ).toBe(0);
  });

  it('starts from the beginning inside the completion margin, and resumes just outside it', () => {
    const duration = 134;
    const insideMargin = duration - LESSON_COMPLETION_MARGIN_SECONDS;
    const outsideMargin = insideMargin - 1;

    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: duration }),
        progress({ lastPositionSeconds: insideMargin }),
      ),
    ).toBe(0);
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: duration }),
        progress({ lastPositionSeconds: outsideMargin }),
      ),
    ).toBe(outsideMargin);
  });

  it('resumes at the saved position when the lesson has no stored duration', () => {
    expect(
      getResumePositionSeconds(
        lesson({ id: lessonId, durationSeconds: null }),
        progress({ lastPositionSeconds: 38 }),
      ),
    ).toBe(38);
  });
});
