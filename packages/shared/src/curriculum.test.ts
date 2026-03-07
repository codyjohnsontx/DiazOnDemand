import { describe, expect, it } from 'vitest';
import {
  createFundamentalsCurriculumTags,
  curriculumTagSchema,
  parseFundamentalsCurriculumTags,
  fundamentalsPositionKeys,
  fundamentalsTrackKeys,
} from './curriculum';

describe('curriculumTagSchema', () => {
  it('accepts valid fundamentals taxonomy tags', () => {
    const parsed = curriculumTagSchema.parse('position:guard-retention');
    expect(parsed).toBe('position:guard-retention');
  });

  it('rejects unknown keys', () => {
    expect(() => curriculumTagSchema.parse('subset:guard-retention')).toThrow();
  });

  it('rejects invalid formats', () => {
    expect(() => curriculumTagSchema.parse('position_guard-retention')).toThrow();
  });
});

describe('createFundamentalsCurriculumTags', () => {
  it('returns required block/position/track tags and optional skill', () => {
    const tags = createFundamentalsCurriculumTags({
      position: fundamentalsPositionKeys[0],
      track: fundamentalsTrackKeys[0],
      skill: 'retention',
    });

    expect(tags).toContain('block:fundamentals');
    expect(tags).toContain('position:guard-retention');
    expect(tags).toContain('track:defense');
    expect(tags).toContain('skill:retention');
  });
});

describe('parseFundamentalsCurriculumTags', () => {
  it('returns a structured curriculum object from valid tags', () => {
    const curriculum = parseFundamentalsCurriculumTags([
      'block:fundamentals',
      'position:guard-passing',
      'track:offense',
      'skill:passing',
    ]);

    expect(curriculum).toEqual({
      block: 'fundamentals',
      position: 'guard-passing',
      track: 'offense',
      skill: 'passing',
    });
  });

  it('returns null when required tags are missing', () => {
    expect(parseFundamentalsCurriculumTags(['track:defense'])).toBeNull();
  });
});
