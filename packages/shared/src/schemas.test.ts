import { describe, expect, it } from 'vitest';
import { AccessLevel } from './enums';
import { lessonSummarySchema } from './schemas';

describe('lessonSummarySchema', () => {
  it('accepts a valid lesson summary payload', () => {
    const parsed = lessonSummarySchema.parse({
      id: '33333333-3333-3333-3333-333333333331',
      courseId: '22222222-2222-2222-2222-222222222222',
      title: 'Frame Fundamentals',
      orderIndex: 1,
      isPublished: true,
      accessLevel: AccessLevel.FREE,
    });

    expect(parsed.title).toBe('Frame Fundamentals');
  });
});
