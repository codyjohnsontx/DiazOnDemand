import {
  AccessLevel,
  Discipline,
  VideoProvider,
  buildRecommendation,
  type ProgramWithContentDto,
  type ProgressDto,
} from '@diaz/shared';
import { describe, expect, it } from 'vitest';
import { findShowcaseUpNext, hasStartedAnyLesson } from '../lib/student-ui';

type Program = ProgramWithContentDto;
type Course = Program['courses'][number];
type Lesson = Course['lessons'][number];

const ids = {
  showcaseProgram: '00000000-0000-4000-8000-000000008000',
  showcaseCourse: '00000000-0000-4000-8000-000000008100',
  showcaseLesson1: '00000000-0000-4000-8000-000000008201',
  showcaseLesson2: '00000000-0000-4000-8000-000000008202',
  trainingProgram: '00000000-0000-4000-8000-000000001000',
  trainingCourse: '00000000-0000-4000-8000-000000001100',
  trainingLesson1: '00000000-0000-4000-8000-000000001201',
  trainingLesson2: '00000000-0000-4000-8000-000000001202',
  bjjProgram: '00000000-0000-4000-8000-000000002000',
  bjjCourse: '00000000-0000-4000-8000-000000002100',
  bjjLesson1: '00000000-0000-4000-8000-000000002201',
  user: '00000000-0000-4000-8000-000000000099',
};

function lesson(id: string, courseId: string, overrides: Partial<Lesson> = {}): Lesson {
  return {
    id,
    courseId,
    title: `Lesson ${id.slice(-2)}`,
    description: null,
    orderIndex: Number(id.slice(-1)),
    isPublished: true,
    accessLevel: AccessLevel.FREE,
    videoProvider: VideoProvider.YOUTUBE,
    youtubeVideoId: 'M7lc1UVf-VE',
    durationSeconds: 360,
    curriculum: null,
    ...overrides,
  };
}

function program(
  id: string,
  courseId: string,
  lessons: Lesson[],
  overrides: Partial<Program> = {},
): Program {
  return {
    id,
    title: `Program ${id.slice(-2)}`,
    description: null,
    orderIndex: 1,
    discipline: Discipline.HAGANAH,
    isFeaturedDemo: false,
    isPublished: true,
    courses: [
      {
        id: courseId,
        programId: id,
        title: `Course ${courseId.slice(-2)}`,
        description: null,
        orderIndex: 1,
        isPublished: true,
        lessons,
      },
    ],
    ...overrides,
  };
}

// The seeded catalogue in miniature: a featured demo track whose free lessons play, and
// a training program whose first lesson has not been filmed.
const showcase = program(
  ids.showcaseProgram,
  ids.showcaseCourse,
  [
    lesson(ids.showcaseLesson1, ids.showcaseCourse, { title: 'Verbal Boundary and Ready Stance' }),
    lesson(ids.showcaseLesson2, ids.showcaseCourse, { title: 'Burst Movement to Exit' }),
  ],
  { isFeaturedDemo: true, orderIndex: 0 },
);
const training = program(ids.trainingProgram, ids.trainingCourse, [
  lesson(ids.trainingLesson1, ids.trainingCourse, {
    title: 'Frame Fundamentals',
    videoProvider: VideoProvider.NONE,
    youtubeVideoId: null,
  }),
  lesson(ids.trainingLesson2, ids.trainingCourse, {
    title: 'Hip Escape Recovery Chain',
    accessLevel: AccessLevel.PAID,
    videoProvider: VideoProvider.NONE,
    youtubeVideoId: null,
  }),
]);
const catalogue = [showcase, training];

function progressOn(lessonId: string, overrides: Partial<ProgressDto> = {}): ProgressDto {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    userId: ids.user,
    lessonId,
    lastPositionSeconds: 120,
    completed: false,
    updatedAt: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

describe('findShowcaseUpNext', () => {
  it('leads a visitor with no progress to the first playable free showcase lesson', () => {
    // Signed out, the progress request answers 401 and the view holds an empty list;
    // signed in with nothing started, the list is empty too. Both read the same.
    const entry = findShowcaseUpNext(catalogue, [], 'all');

    expect(entry?.lesson.id).toBe(ids.showcaseLesson1);
    expect(entry?.lesson.title).toBe('Verbal Boundary and Ready Stance');
    expect(entry?.course.id).toBe(ids.showcaseCourse);
    expect(entry?.program.id).toBe(ids.showcaseProgram);
  });

  it('leaves a member with progress of their own on their own recommendation', () => {
    const progress = [progressOn(ids.trainingLesson1)];

    expect(findShowcaseUpNext(catalogue, progress, 'all')).toBeNull();

    // What the card falls through to, unchanged: the lesson they were in the middle of.
    const own = buildRecommendation([training], ids.trainingCourse, progress);
    expect(own.lessonId).toBe(ids.trainingLesson1);
    expect(own.reason).toBe('resume_lesson');
  });

  it('treats a record with nothing watched as nothing started', () => {
    const untouched = [progressOn(ids.trainingLesson1, { lastPositionSeconds: 0 })];

    expect(hasStartedAnyLesson(untouched)).toBe(false);
    expect(findShowcaseUpNext(catalogue, untouched, 'all')?.lesson.id).toBe(ids.showcaseLesson1);
  });

  it('skips a showcase lesson that does not play or is not free', () => {
    const [first, second] = showcase.courses[0]!.lessons;
    const partlyPlayable: Program = {
      ...showcase,
      courses: [
        {
          ...showcase.courses[0]!,
          lessons: [
            { ...first!, videoProvider: VideoProvider.NONE, youtubeVideoId: null },
            { ...second!, accessLevel: AccessLevel.PAID },
            lesson('00000000-0000-4000-8000-000000008203', ids.showcaseCourse),
          ],
        },
      ],
    };

    expect(findShowcaseUpNext([partlyPlayable, training], [], 'all')?.lesson.id).toBe(
      '00000000-0000-4000-8000-000000008203',
    );
  });

  it('answers null when no featured program carries a playable free lesson', () => {
    const unfilmedShowcase: Program = {
      ...showcase,
      courses: showcase.courses.map((course) => ({
        ...course,
        lessons: course.lessons.map((entry) => ({
          ...entry,
          videoProvider: VideoProvider.NONE,
          youtubeVideoId: null,
        })),
      })),
    };

    expect(findShowcaseUpNext([unfilmedShowcase, training], [], 'all')).toBeNull();
    expect(findShowcaseUpNext([training], [], 'all')).toBeNull();
  });

  it('keeps a member whose only progress is on the showcase track in that track', () => {
    // Resumes the showcase lesson they left part way through.
    const started = [progressOn(ids.showcaseLesson1, { lastPositionSeconds: 30 })];
    expect(findShowcaseUpNext(catalogue, started, 'all')?.lesson.id).toBe(ids.showcaseLesson1);

    // Advances to the next showcase lesson once that one is complete.
    const finishedFirst = [progressOn(ids.showcaseLesson1, { completed: true })];
    expect(findShowcaseUpNext(catalogue, finishedFirst, 'all')?.lesson.id).toBe(
      ids.showcaseLesson2,
    );

    // Resumes a started later lesson ahead of an untouched earlier one.
    const startedSecond = [progressOn(ids.showcaseLesson2, { lastPositionSeconds: 45 })];
    expect(findShowcaseUpNext(catalogue, startedSecond, 'all')?.lesson.id).toBe(
      ids.showcaseLesson2,
    );
  });

  it('hands back to the training recommendation once every showcase lesson is done', () => {
    const allDone = [
      progressOn(ids.showcaseLesson1, { completed: true }),
      progressOn(ids.showcaseLesson2, { completed: true }),
    ];

    expect(findShowcaseUpNext(catalogue, allDone, 'all')).toBeNull();
  });
});

describe('findShowcaseUpNext under a discipline filter', () => {
  const bjj = program(
    ids.bjjProgram,
    ids.bjjCourse,
    [lesson(ids.bjjLesson1, ids.bjjCourse, { title: 'Closed Guard Posture' })],
    { discipline: Discipline.BJJ, orderIndex: 2 },
  );
  const withBjj = [...catalogue, bjj];

  it('leads with the showcase track under the discipline it belongs to', () => {
    expect(findShowcaseUpNext(withBjj, [], Discipline.HAGANAH)?.lesson.id).toBe(
      ids.showcaseLesson1,
    );
  });

  it('answers null under another discipline, so that discipline recommends its own lesson', () => {
    expect(findShowcaseUpNext(withBjj, [], Discipline.BJJ)).toBeNull();

    const own = buildRecommendation([bjj], ids.bjjCourse, []);
    expect(own.lessonId).toBe(ids.bjjLesson1);
  });

  it('still leads with the showcase track when its discipline has no training programs', () => {
    expect(findShowcaseUpNext([showcase, bjj], [], Discipline.HAGANAH)?.lesson.id).toBe(
      ids.showcaseLesson1,
    );
  });

  it('counts only training progress inside the discipline in view', () => {
    const bjjProgress = [progressOn(ids.bjjLesson1)];

    expect(findShowcaseUpNext(withBjj, bjjProgress, Discipline.HAGANAH)?.lesson.id).toBe(
      ids.showcaseLesson1,
    );
    expect(findShowcaseUpNext(withBjj, bjjProgress, 'all')).toBeNull();
  });
});
