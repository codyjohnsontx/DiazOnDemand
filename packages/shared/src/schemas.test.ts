import { describe, expect, it } from 'vitest';
import { AccessLevel } from './enums';
import { lessonSummarySchema } from './schemas';
import { buildRecommendation } from './progression';

describe('lessonSummarySchema', () => {
  it('accepts a valid lesson summary payload', () => {
    const parsed = lessonSummarySchema.parse({
      id: '33333333-3333-3333-3333-333333333331',
      courseId: '22222222-2222-2222-2222-222222222222',
      title: 'Frame Fundamentals',
      orderIndex: 1,
      isPublished: true,
      accessLevel: AccessLevel.FREE,
      curriculum: {
        block: 'fundamentals',
        position: 'guard-retention',
        track: 'defense',
      },
    });

    expect(parsed.title).toBe('Frame Fundamentals');
  });
});

describe('buildRecommendation', () => {
  const programs = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Fundamentals',
      description: null,
      orderIndex: 1,
      isPublished: true,
      courses: [
        {
          id: '22222222-2222-2222-2222-222222222221',
          programId: '11111111-1111-1111-1111-111111111111',
          title: 'Course One',
          description: null,
          orderIndex: 1,
          isPublished: true,
          lessons: [
            {
              id: '33333333-3333-3333-3333-333333333331',
              courseId: '22222222-2222-2222-2222-222222222221',
              title: 'Lesson One',
              orderIndex: 1,
              isPublished: true,
              accessLevel: AccessLevel.FREE,
              curriculum: {
                block: 'fundamentals',
                position: 'guard-retention',
                track: 'defense',
              },
            },
            {
              id: '33333333-3333-3333-3333-333333333332',
              courseId: '22222222-2222-2222-2222-222222222221',
              title: 'Lesson Two',
              orderIndex: 2,
              isPublished: true,
              accessLevel: AccessLevel.FREE,
              curriculum: {
                block: 'fundamentals',
                position: 'guard-retention',
                track: 'defense',
              },
            },
          ],
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          programId: '11111111-1111-1111-1111-111111111111',
          title: 'Course Two',
          description: null,
          orderIndex: 2,
          isPublished: true,
          lessons: [
            {
              id: '33333333-3333-3333-3333-333333333333',
              courseId: '22222222-2222-2222-2222-222222222222',
              title: 'Lesson Three',
              orderIndex: 1,
              isPublished: true,
              accessLevel: AccessLevel.FREE,
              curriculum: {
                block: 'fundamentals',
                position: 'guard-retention',
                track: 'offense',
              },
            },
          ],
        },
      ],
    },
  ] as const;

  it('recommends the in-progress lesson first', () => {
    const result = buildRecommendation(programs as never, '22222222-2222-2222-2222-222222222221', [
      {
        id: '44444444-4444-4444-4444-444444444441',
        userId: '55555555-5555-5555-5555-555555555555',
        lessonId: '33333333-3333-3333-3333-333333333331',
        lastPositionSeconds: 32,
        completed: false,
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(result.reason).toBe('resume_lesson');
    expect(result.lessonId).toBe('33333333-3333-3333-3333-333333333331');
  });

  it('recommends the next course once the current course is complete', () => {
    const result = buildRecommendation(programs as never, '22222222-2222-2222-2222-222222222221', [
      {
        id: '44444444-4444-4444-4444-444444444441',
        userId: '55555555-5555-5555-5555-555555555555',
        lessonId: '33333333-3333-3333-3333-333333333331',
        lastPositionSeconds: 120,
        completed: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: '44444444-4444-4444-4444-444444444442',
        userId: '55555555-5555-5555-5555-555555555555',
        lessonId: '33333333-3333-3333-3333-333333333332',
        lastPositionSeconds: 120,
        completed: true,
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(result.reason).toBe('next_course');
    expect(result.courseId).toBe('22222222-2222-2222-2222-222222222222');
  });
});
