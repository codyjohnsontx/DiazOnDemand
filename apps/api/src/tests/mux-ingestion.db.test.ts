/**
 * Database-backed tests for Mux ingestion: a lesson saved as "uploaded, still
 * encoding", and the `video.asset.ready` webhook that completes it.
 *
 * These run against a real Postgres for the same reason the billing ones do.
 * What made the awaiting state unstorable was a CHECK constraint,
 * `lesson_video_provider_consistency_chk`, which no mocked Prisma enforces - so
 * against the mocks the chain looked like it worked while every real save
 * answered 500 and every Mux delivery logged "No lesson matches Mux asset
 * <id>; skipping sync".
 *
 * Point TEST_DATABASE_URL at a throwaway database with the migrations applied;
 * see the header of billing-lifecycle.db.test.ts for the exact commands.
 * Without it the suite skips, except on CI where a skip would silently drop the
 * only coverage this constraint has.
 */
import { PrismaClient, VideoProvider } from '@diaz/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

  // The "never arrives" case: an upload that failed at Mux, a lost event, a
  // webhook nobody configured. Nothing times out and nothing alerts, so the
  // only thing that saves those lessons is being findable - which they are,
  // from the same three fields, with no status column to fall out of step.
  it('leaves an uncompleted lesson findable by the fields alone', async () => {
    const lesson = await createAwaitingLesson();

    const awaiting = await prismaClient!.lesson.findMany({
      where: {
        videoProvider: VideoProvider.MUX,
        muxAssetId: { not: null },
        muxPlaybackId: null,
      },
      select: { id: true },
    });

    expect(awaiting).toContainEqual({ id: lesson.id });
  });
});
