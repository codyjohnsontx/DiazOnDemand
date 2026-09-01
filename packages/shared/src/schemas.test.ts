import { describe, expect, it } from 'vitest';
import { AccessLevel, Discipline, VideoProvider } from './enums';
import { adminUpdateLessonSchema, lessonSummarySchema, videoSchema } from './schemas';
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
      videoProvider: VideoProvider.MUX,
      curriculum: {
        discipline: 'bjj',
        phase: 'fundamentals',
        track: 'guard-retention-defense',
        level: 'core',
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
      discipline: Discipline.BJJ,
      isFeaturedDemo: false,
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
              videoProvider: VideoProvider.MUX,
              curriculum: {
                discipline: 'bjj',
                phase: 'fundamentals',
                track: 'guard-retention-defense',
                level: 'core',
              },
            },
            {
              id: '33333333-3333-3333-3333-333333333332',
              courseId: '22222222-2222-2222-2222-222222222221',
              title: 'Lesson Two',
              orderIndex: 2,
              isPublished: true,
              accessLevel: AccessLevel.FREE,
              videoProvider: VideoProvider.MUX,
              curriculum: {
                discipline: 'bjj',
                phase: 'fundamentals',
                track: 'guard-retention-defense',
                level: 'core',
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
              videoProvider: VideoProvider.MUX,
              curriculum: {
                discipline: 'bjj',
                phase: 'fundamentals',
                track: 'guard-retention-offense',
                level: 'core',
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

describe('videoSchema', () => {
  it('rejects mux video payloads without a source', () => {
    expect(() =>
      videoSchema.parse({
        provider: VideoProvider.MUX,
        playbackUrl: null,
        muxAssetId: null,
        muxPlaybackId: null,
      }),
    ).toThrow();
  });

  // The entrance to Mux ingestion. Mux issues the playback id later, on
  // `video.asset.ready`, so a lesson has to be storable as the asset alone or
  // the webhook has no lesson to complete.
  it('accepts a mux video payload holding only an asset id', () => {
    const parsed = videoSchema.parse({
      provider: VideoProvider.MUX,
      playbackUrl: null,
      muxAssetId: 'PS02Wt6ZFsample00Asset00Id00000001',
      muxPlaybackId: null,
    });

    expect(parsed.muxAssetId).toBe('PS02Wt6ZFsample00Asset00Id00000001');
  });

  // The read path resolves a lesson awaiting its playback id to NONE, and that
  // lesson still holds the asset id it is waiting on. An asset id addresses no
  // video, so it is not one of the identifiers NONE forbids.
  it('accepts a NONE video payload carrying only a mux asset id', () => {
    const parsed = videoSchema.parse({
      provider: VideoProvider.NONE,
      playbackUrl: null,
      muxAssetId: 'PS02Wt6ZFsample00Asset00Id00000001',
      muxPlaybackId: null,
      youtubeVideoId: null,
      embedUrl: null,
    });

    expect(parsed.provider).toBe(VideoProvider.NONE);
  });

  it('accepts NONE video payloads without playback identifiers', () => {
    const parsed = videoSchema.parse({
      provider: VideoProvider.NONE,
      playbackUrl: null,
      muxPlaybackId: null,
      youtubeVideoId: null,
      embedUrl: null,
    });

    expect(parsed.provider).toBe(VideoProvider.NONE);
  });

  it('rejects youtube video payloads without a source', () => {
    expect(() =>
      videoSchema.parse({
        provider: VideoProvider.YOUTUBE,
        youtubeVideoId: null,
        embedUrl: null,
      }),
    ).toThrow();
  });

  it('rejects NONE video payloads when playback identifiers are present', () => {
    expect(() =>
      videoSchema.parse({
        provider: VideoProvider.NONE,
        playbackUrl: 'https://stream.mux.com/example.m3u8',
        youtubeVideoId: null,
      }),
    ).toThrow();
  });
});

// The stalled-upload query is `where: { muxAssetId: { not: null }, muxPlaybackId:
// null, youtubeVideoId: null }`, so "no identifier yet" has to be NULL and never
// an empty string, for every writer rather than only for the admin lesson editor.
// These go through the *partial* schema on purpose: it is what the admin PATCH
// parses, and the omitted-field case only exists there.
describe('adminUpdateLessonSchema normalises blank video identifiers', () => {
  // The important one. A PATCH that does not mention a column must leave it
  // alone - Prisma reads `undefined` as "do not update" - so turning an omitted
  // field into null would blank identifiers on every partial save.
  it('leaves an omitted identifier omitted rather than nulling it', () => {
    const parsed = adminUpdateLessonSchema.parse({ title: 'Frame Fundamentals' });

    expect(parsed).not.toHaveProperty('muxAssetId');
    expect(parsed).not.toHaveProperty('muxPlaybackId');
    expect(parsed).not.toHaveProperty('youtubeVideoId');
    expect(parsed.muxPlaybackId).toBeUndefined();
  });

  it('keeps an explicit null as null', () => {
    const parsed = adminUpdateLessonSchema.parse({
      muxAssetId: null,
      muxPlaybackId: null,
      youtubeVideoId: null,
    });

    expect(parsed.muxAssetId).toBeNull();
    expect(parsed.muxPlaybackId).toBeNull();
    expect(parsed.youtubeVideoId).toBeNull();
  });

  it('stores an empty or spaces-only identifier as null', () => {
    const parsed = adminUpdateLessonSchema.parse({
      muxAssetId: '',
      muxPlaybackId: '   ',
      youtubeVideoId: ' ',
    });

    expect(parsed.muxAssetId).toBeNull();
    expect(parsed.muxPlaybackId).toBeNull();
    expect(parsed.youtubeVideoId).toBeNull();
  });

  // A tab is *present* to the CHECK constraint, which trims U+0020 only, so it
  // is stored verbatim. Normalising it here would put this boundary back into
  // disagreement with the one layer that can refuse the write.
  it('keeps a real identifier, and a tab-only one, exactly as sent', () => {
    const parsed = adminUpdateLessonSchema.parse({
      muxAssetId: 'PS02Wt6ZFsample00Asset00Id00000001',
      muxPlaybackId: '\t',
      youtubeVideoId: 'M7lc1UVf-VE',
    });

    expect(parsed.muxAssetId).toBe('PS02Wt6ZFsample00Asset00Id00000001');
    expect(parsed.muxPlaybackId).toBe('\t');
    expect(parsed.youtubeVideoId).toBe('M7lc1UVf-VE');
  });
});
