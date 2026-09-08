/**
 * Database-backed tests for the writes that have to satisfy the `Lesson` CHECK
 * constraint: a lesson saved as "uploaded, still encoding", the
 * `video.asset.ready` webhook that completes it, and the admin FREE -> PAID
 * transition that retires a publicly-served playback id.
 *
 * These run against a real Postgres for the same reason the billing ones do.
 * What made the awaiting state unstorable was a CHECK constraint,
 * `lesson_video_provider_consistency_chk`, which no mocked Prisma enforces - so
 * against the mocks the chain looked like it worked while every real save
 * answered 500 and every Mux delivery logged "No lesson matches Mux asset
 * <id>; skipping sync". The paid-access clear is in the same position: it takes
 * an identifier off a row the constraint has an opinion about, and only the
 * database can say whether what is left is storable.
 *
 * Point TEST_DATABASE_URL at a throwaway database with the migrations applied;
 * see the header of billing-lifecycle.db.test.ts for the exact commands.
 * Without it the suite skips, except on CI where a skip would silently drop the
 * only coverage this constraint has.
 */
import { AccessLevel, PrismaClient, VideoProvider } from '@diaz/db';
import { isAwaitingMuxPlayback } from '@diaz/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminService } from '../admin/admin.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl && process.env.CI) {
  throw new Error(
    'TEST_DATABASE_URL is required on CI: these Mux ingestion tests must not silently skip.',
  );
}

const prismaClient = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['error'] })
  : null;

const prisma = { client: prismaClient } as unknown as PrismaService;

const PUBLIC_PLAYBACK_ID = 'DS00Spx1CV902MCtPj5WknGlR102V5HFkDe';

/**
 * A fresh asset id per test. `syncMuxAsset` looks a lesson up by asset id alone,
 * so a shared one would let a row left behind by another test - or by whatever
 * else lives in the database this suite is pointed at - answer instead of the
 * lesson under test.
 */
let assetCounter = 0;

function nextAssetId() {
  assetCounter += 1;
  return `mux00ingestion00test00asset0000000${assetCounter}`;
}

beforeAll(async () => {
  await prismaClient?.$connect();
});

afterAll(async () => {
  await prismaClient?.$disconnect();
});

describe.skipIf(!prismaClient)('Mux ingestion (database-backed)', () => {
  const service = new WebhooksService(prisma);

  async function createCourse() {
    const program = await prismaClient!.program.create({
      data: { title: 'mux-ingestion-test program', orderIndex: 0 },
    });

    return prismaClient!.course.create({
      data: { programId: program.id, title: 'mux-ingestion-test course', orderIndex: 0 },
    });
  }

  /** A lesson in the state an upload leaves behind: the asset, and no playback id. */
  async function createAwaitingLesson(overrides: Record<string, unknown> = {}) {
    const course = await createCourse();

    return prismaClient!.lesson.create({
      data: {
        courseId: course.id,
        title: 'mux-ingestion-test lesson',
        orderIndex: 0,
        videoProvider: VideoProvider.MUX,
        muxAssetId: nextAssetId(),
        ...overrides,
      },
    });
  }

  function assetReady(assetId: string) {
    return {
      type: 'video.asset.ready',
      data: {
        id: assetId,
        duration: 723.4,
        playback_ids: [{ id: PUBLIC_PLAYBACK_ID, policy: 'public' }],
      },
    };
  }

  afterEach(async () => {
    await prismaClient!.lesson.deleteMany({ where: { title: 'mux-ingestion-test lesson' } });
    await prismaClient!.course.deleteMany({ where: { title: 'mux-ingestion-test course' } });
    await prismaClient!.program.deleteMany({ where: { title: 'mux-ingestion-test program' } });
  });

  // The entrance. Before the constraint was widened this insert failed with
  // `lesson_video_provider_consistency_chk`, which is why nothing in the
  // database was ever waiting for an asset.
  it('stores a lesson as a Mux video with an asset id and no playback id', async () => {
    const lesson = await createAwaitingLesson();

    expect(lesson.videoProvider).toBe(VideoProvider.MUX);
    expect(lesson.muxAssetId).toMatch(/^mux00ingestion00test00asset/);
    expect(lesson.muxPlaybackId).toBeNull();
  });

  // The widening is narrow on purpose: a MUX lesson pointing at nothing at all
  // is still refused, because that is a misconfigured row rather than one
  // waiting for something.
  it('still refuses a Mux lesson holding neither identifier', async () => {
    const course = await createCourse();

    await expect(
      prismaClient!.lesson.create({
        data: {
          courseId: course.id,
          title: 'mux-ingestion-test lesson',
          orderIndex: 0,
          videoProvider: VideoProvider.MUX,
        },
      }),
    ).rejects.toThrow(/lesson_video_provider_consistency_chk/);
  });

  it('completes the awaiting lesson when the asset is ready', async () => {
    const lesson = await createAwaitingLesson();

    await service.handleMuxWebhook(assetReady(lesson.muxAssetId!));

    const synced = await prismaClient!.lesson.findUniqueOrThrow({ where: { id: lesson.id } });

    expect(synced.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
    expect(synced.durationSeconds).toBe(723);
    expect(synced.videoProvider).toBe(VideoProvider.MUX);
  });

  // A lesson can be parked with the asset id before anyone decides it is a Mux
  // lesson, so the webhook writes the provider too - otherwise it would leave
  // a playback id no read path ever consults.
  it('sets the provider on a lesson that was not marked as Mux yet', async () => {
    const lesson = await createAwaitingLesson({ videoProvider: VideoProvider.NONE });

    await service.handleMuxWebhook(assetReady(lesson.muxAssetId!));

    const synced = await prismaClient!.lesson.findUniqueOrThrow({ where: { id: lesson.id } });

    expect(synced.videoProvider).toBe(VideoProvider.MUX);
    expect(synced.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
  });

  // Mux retries, so the same event arrives more than once. The second one has
  // to leave the row alone rather than merely rewrite the same values -
  // `updatedAt` is the witness that no write happened at all.
  it('changes nothing on a redelivery of the same event', async () => {
    const lesson = await createAwaitingLesson();

    await service.handleMuxWebhook(assetReady(lesson.muxAssetId!));
    const afterFirst = await prismaClient!.lesson.findUniqueOrThrow({ where: { id: lesson.id } });

    await service.handleMuxWebhook(assetReady(lesson.muxAssetId!));
    const afterSecond = await prismaClient!.lesson.findUniqueOrThrow({ where: { id: lesson.id } });

    expect(afterSecond).toEqual(afterFirst);
  });

  // The reason `isStoredIdentifierAbsent` exists, proved against the real
  // constraint rather than argued. Postgres TRIM() strips U+0020 only, so a
  // tab-only youtubeVideoId is PRESENT to
  // `lesson_video_provider_consistency_chk` - the row stores as YOUTUBE, and
  // setting videoProvider to MUX beside it is rejected. JavaScript's own trim()
  // reads that same tab as blank, and the guard that used it waved the write
  // straight into the violation, which Mux then retries forever.
  it('refuses a tab-only YouTube id rather than letting the constraint reject the write', async () => {
    const course = await createCourse();
    const assetId = nextAssetId();
    const lesson = await prismaClient!.lesson.create({
      data: {
        courseId: course.id,
        title: 'mux-ingestion-test lesson',
        orderIndex: 0,
        videoProvider: VideoProvider.YOUTUBE,
        youtubeVideoId: '\t',
        muxAssetId: assetId,
      },
    });

    // The database accepted the tab as a real YouTube id, which is the whole
    // premise: this row exists.
    expect(lesson.youtubeVideoId).toBe('\t');
    // Field by field rather than the whole row: Prisma's VideoProvider and the
    // one in @diaz/shared are distinct types to TypeScript, and this predicate
    // does not read the provider anyway.
    expect(
      isAwaitingMuxPlayback({
        muxAssetId: lesson.muxAssetId,
        muxPlaybackId: lesson.muxPlaybackId,
        youtubeVideoId: lesson.youtubeVideoId,
      }),
    ).toBe(false);

    await expect(service.handleMuxWebhook(assetReady(assetId))).rejects.toThrow(
      /still holds a YouTube video id/,
    );

    // And the refusal is not merely tidy - the write it prevented is one the
    // constraint rejects, so without it the delivery fails on a database error
    // and Mux retries it forever.
    await expect(
      prismaClient!.lesson.update({
        where: { id: lesson.id },
        data: { videoProvider: VideoProvider.MUX, muxPlaybackId: PUBLIC_PLAYBACK_ID },
      }),
    ).rejects.toThrow(/lesson_video_provider_consistency_chk/);
  });

  // The "never arrives" case: an upload that failed at Mux, an event delivered
  // before any lesson held the asset id, a webhook nobody configured. Nothing
  // times out and nothing alerts, so the only thing that saves those lessons is
  // being findable - which they are, from the same fields `isAwaitingMuxPlayback`
  // reads, with no status column to fall out of step.
  //
  // The query does not ask about the provider, because `syncMuxAsset` does not
  // either: it matches on the asset id alone and writes MUX itself. A row that
  // lost its provider - re-running the seed writes exactly that shape - is still
  // a row the webhook will complete, so it is still one of these.
  it('leaves an uncompleted lesson findable by the fields alone', async () => {
    const lesson = await createAwaitingLesson();
    const withoutProvider = await createAwaitingLesson({ videoProvider: VideoProvider.NONE });

    const awaiting = await prismaClient!.lesson.findMany({
      where: {
        muxAssetId: { not: null },
        muxPlaybackId: null,
        youtubeVideoId: null,
      },
      select: { id: true },
    });

    expect(awaiting).toContainEqual({ id: lesson.id });
    expect(awaiting).toContainEqual({ id: withoutProvider.id });
  });

  /**
   * The other write that has to respect this constraint, and the leak it closes.
   *
   * A FREE lesson publishes its playback id to anonymous callers of `/programs`,
   * and a FREE lesson's asset must carry a public playback policy - `syncMuxAsset`
   * refuses any other - so that id plays at `stream.mux.com/<id>.m3u8` for anyone
   * who read the catalogue, forever. Flipping the lesson to PAID stops the API
   * publishing it and takes nothing back.
   */
  describe('the FREE -> PAID access transition', () => {
    const admin = new AdminService(prisma);

    async function createFreeMuxLesson(overrides: Record<string, unknown> = {}) {
      const course = await createCourse();

      return prismaClient!.lesson.create({
        data: {
          courseId: course.id,
          title: 'mux-ingestion-test lesson',
          orderIndex: 0,
          accessLevel: AccessLevel.FREE,
          videoProvider: VideoProvider.MUX,
          muxAssetId: nextAssetId(),
          muxPlaybackId: PUBLIC_PLAYBACK_ID,
          ...overrides,
        },
      });
    }

    /** The body the lesson editor PATCHes: every field, including the id it loaded. */
    function editorSave(
      lesson: { title: string; videoProvider: string; muxAssetId: string | null; muxPlaybackId: string | null },
      overrides: Record<string, unknown> = {},
    ) {
      return {
        title: lesson.title,
        accessLevel: AccessLevel.PAID,
        videoProvider: lesson.videoProvider as VideoProvider,
        muxAssetId: lesson.muxAssetId,
        muxPlaybackId: lesson.muxPlaybackId,
        youtubeVideoId: null,
        ...overrides,
      };
    }

    // The premise, measured rather than assumed. Postgres stores a PAID lesson
    // still holding its public playback id without a murmur, so nothing under
    // the service refuses the carry-over and the guard is the only thing that
    // can.
    it('is a row Postgres accepts, so nothing below the guard refuses the carry-over', async () => {
      const lesson = await createFreeMuxLesson();

      const carried = await prismaClient!.lesson.update({
        where: { id: lesson.id },
        data: { accessLevel: AccessLevel.PAID },
      });

      expect(carried.accessLevel).toBe(AccessLevel.PAID);
      expect(carried.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
    });

    it('clears the playback id and leaves a row the constraint accepts', async () => {
      const lesson = await createFreeMuxLesson();

      const saved = await admin.updateLesson(lesson.id, editorSave(lesson));

      expect(saved.muxPlaybackIdClearedForPaidAccess).toBe(true);
      expect(saved.accessLevel).toBe(AccessLevel.PAID);
      expect(saved.muxPlaybackId).toBeNull();
      // The asset id survives, so the lesson lands in the state the
      // "Waiting for Mux" badge already describes rather than nowhere.
      expect(saved.muxAssetId).toBe(lesson.muxAssetId);
      expect(saved.videoProvider).toBe(VideoProvider.MUX);
      expect(
        isAwaitingMuxPlayback({
          muxAssetId: saved.muxAssetId,
          muxPlaybackId: saved.muxPlaybackId,
          youtubeVideoId: saved.youtubeVideoId,
        }),
      ).toBe(true);
    });

    // A MUX row must hold a playback id or an asset id. Clearing the only
    // identifier a lesson has would violate the constraint, so the row becomes
    // the honest not-filmed state instead of a failed save.
    it('drops the provider to NONE when the lesson has no asset id to fall back on', async () => {
      const lesson = await createFreeMuxLesson({ muxAssetId: null });

      const saved = await admin.updateLesson(lesson.id, editorSave(lesson));

      expect(saved.muxPlaybackId).toBeNull();
      expect(saved.videoProvider).toBe(VideoProvider.NONE);
      expect(saved.muxPlaybackIdClearedForPaidAccess).toBe(true);
    });

    // The reverse transition, and the ordinary save, both against the real
    // constraint: a premium lesson that never published its id keeps it.
    it('leaves the reverse PAID -> FREE transition alone', async () => {
      const lesson = await createFreeMuxLesson({ accessLevel: AccessLevel.PAID });

      const saved = await admin.updateLesson(
        lesson.id,
        editorSave(lesson, { accessLevel: AccessLevel.FREE }),
      );

      expect(saved.accessLevel).toBe(AccessLevel.FREE);
      expect(saved.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
      expect(saved.muxPlaybackIdClearedForPaidAccess).toBe(false);
    });

    it('leaves a lesson that was premium from the start alone', async () => {
      const lesson = await createFreeMuxLesson({ accessLevel: AccessLevel.PAID });

      const saved = await admin.updateLesson(lesson.id, editorSave(lesson));

      expect(saved.muxPlaybackId).toBe(PUBLIC_PLAYBACK_ID);
      expect(saved.muxPlaybackIdClearedForPaidAccess).toBe(false);
    });

    // The clear is only half a rotation. The other half is that the same asset
    // cannot be reattached: it is public, the lesson is now paid, and
    // `syncMuxAsset` fails the delivery in the Mux dashboard naming the remedy.
    it('refuses to re-attach the same public asset to the now-paid lesson', async () => {
      const lesson = await createFreeMuxLesson();
      await admin.updateLesson(lesson.id, editorSave(lesson));

      await expect(service.handleMuxWebhook(assetReady(lesson.muxAssetId!))).rejects.toThrow(
        /has a public playback id/,
      );

      const after = await prismaClient!.lesson.findUniqueOrThrow({ where: { id: lesson.id } });

      expect(after.muxPlaybackId).toBeNull();
    });
  });
});
