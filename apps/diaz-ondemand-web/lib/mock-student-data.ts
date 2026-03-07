import { AccessLevel, type CourseDto, type LessonDetailDto, type ProgramWithContentDto, type ProgressDto } from '@diaz/shared';

const programId = '11111111-1111-1111-1111-111111111111';
const courseId = '22222222-2222-2222-2222-222222222222';

const lessons = [
  {
    id: '33333333-3333-3333-3333-333333333331',
    courseId,
    title: 'Frame Fundamentals',
    description: 'Learn the first layer of guard retention with frames, elbow position, and safe distance management.',
    orderIndex: 1,
    isPublished: true,
    accessLevel: AccessLevel.FREE,
    muxPlaybackId: null,
    durationSeconds: 720,
    tags: [
      {
        id: '44444444-4444-4444-4444-444444444441',
        name: 'guard',
      },
    ],
  },
  {
    id: '33333333-3333-3333-3333-333333333332',
    courseId,
    title: 'Hip Escape to Guard Recovery',
    description: 'Connect your frames to hip movement and recover inside position before the pass settles.',
    orderIndex: 2,
    isPublished: true,
    accessLevel: AccessLevel.PAID,
    muxPlaybackId: null,
    durationSeconds: 930,
    tags: [
      {
        id: '44444444-4444-4444-4444-444444444442',
        name: 'mobility',
      },
    ],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    courseId,
    title: 'Leg Pummel Timing',
    description: 'Build the timing needed to reinsert your legs and stay ahead of pressure passing sequences.',
    orderIndex: 3,
    isPublished: true,
    accessLevel: AccessLevel.PAID,
    muxPlaybackId: null,
    durationSeconds: 840,
    tags: [
      {
        id: '44444444-4444-4444-4444-444444444443',
        name: 'advanced',
      },
    ],
  },
] satisfies LessonDetailDto[];

export const mockPrograms: ProgramWithContentDto[] = [
  {
    id: programId,
    title: 'Diaz Fundamentals',
    description: 'Core BJJ structure for students building dependable escapes, frames, and recovery habits.',
    orderIndex: 1,
    isPublished: true,
    courses: [
      {
        id: courseId,
        programId,
        title: 'Guard Retention 101',
        description: 'A first-step progression through frames, hip movement, and early guard recovery.',
        orderIndex: 1,
        isPublished: true,
        lessons: lessons.map(({ tags, ...lesson }) => lesson),
      },
    ],
  },
];

export const mockCourse: CourseDto = mockPrograms[0]!.courses[0]!;

export const mockProgress: ProgressDto[] = [
  {
    id: '55555555-5555-5555-5555-555555555551',
    userId: '66666666-6666-6666-6666-666666666661',
    lessonId: lessons[0]!.id,
    lastPositionSeconds: 265,
    completed: false,
    updatedAt: new Date().toISOString(),
  },
];

export function getMockLesson(id: string) {
  const lesson = lessons.find((entry) => entry.id === id) ?? lessons[0]!;

  return {
    ...lesson,
    playbackUrl: null,
    signedPlaybackToken: null,
  } satisfies LessonDetailDto;
}
