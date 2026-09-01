import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EntitlementTier, isAwaitingMuxPlayback, Role, VideoProvider } from '@diaz/shared';
import { EntitlementTier as DbEntitlementTier } from '@diaz/db';
import {
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
  planRevocation,
  releasesRevocation,
} from '../billing/subscription-revocation.js';
import {
  isEntitlementActive,
  isLiveStripeSubscription,
  resolveEntitlementTier,
  resolveStripeEntitlement,
} from '../common/entitlement.js';
import { ContentService } from '../content/content.service.js';
import {
  mapAdminLessonSummary,
  mapLessonDetail,
  mapLessonSummary,
} from '../content/lesson-presentation.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import { MeService } from '../me/me.service.js';
import { ProgressService } from '../progress/progress.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

type MockPrismaClient = Partial<{
  lesson: {
    findFirst: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  };
  program: { findMany: ReturnType<typeof vi.fn> };
  course: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  progress: { upsert: ReturnType<typeof vi.fn> };
  favorite: {
    upsert?: ReturnType<typeof vi.fn>;
    deleteMany?: ReturnType<typeof vi.fn>;
  };
  subscription: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
  };
  entitlement: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
  };
  stripeWebhookEvent: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst?: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}>;

function createPrismaService(client: MockPrismaClient): PrismaService {
  return { client } as unknown as PrismaService;
}

function muxSignature(secret: string, body: string, timestampSeconds: number) {
  const digest = createHmac('sha256', secret)
    .update(`${timestampSeconds}.`)
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');

  return `t=${timestampSeconds},v1=${digest}`;
}

async function withMuxSecret<T>(secret: string | undefined, run: () => T | Promise<T>) {
  const previous = process.env.MUX_WEBHOOK_SECRET;

  if (secret === undefined) {
    delete process.env.MUX_WEBHOOK_SECRET;
  } else {
    process.env.MUX_WEBHOOK_SECRET = secret;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.MUX_WEBHOOK_SECRET;
    } else {
      process.env.MUX_WEBHOOK_SECRET = previous;
    }
  }
}

const LOCAL_DB = 'postgresql://postgres:postgres@localhost:5432/diaz_ondemand';
const DEPLOYED_DB = 'postgresql://app:secret@db.example.com:5432/diaz_ondemand';

/**
 * Runs `run` with DATABASE_URL set to a given host, because that - not
 * NODE_ENV - is what decides whether an unsigned PAID playback url is allowed.
 * See isUnsignedPaidPlaybackAllowed in apps/api/src/config/env.ts.
 */
async function withDatabaseUrl<T>(databaseUrl: string | undefined, run: () => T | Promise<T>) {
  const previous = process.env.DATABASE_URL;

  if (databaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = databaseUrl;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  }
}

async function withNodeEnv<T>(nodeEnv: string | undefined, run: () => T | Promise<T>) {
  const previous = process.env.NODE_ENV;

  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
}

const paidCatalogueLesson = {
  id: 'lesson-paid',
  courseId: 'course-1',
  title: 'Paid Lesson',
  description: null,
  orderIndex: 1,
  isPublished: true,
  accessLevel: 'PAID' as const,
  videoProvider: 'MUX',
  muxAssetId: 'asset-paid',
  muxPlaybackId: 'paidPlaybackId00000000000000000001',
  durationSeconds: 120,
  tags: [],
};

const freeCatalogueLesson = {
  ...paidCatalogueLesson,
  id: 'lesson-free',
  title: 'Free Lesson',
  orderIndex: 0,
  accessLevel: 'FREE' as const,
  muxAssetId: 'asset-free',
  muxPlaybackId: 'freePlaybackId00000000000000000001',
};

const paidYoutubeCatalogueLesson = {
  ...paidCatalogueLesson,
  id: 'lesson-paid-youtube',
  title: 'Paid YouTube Lesson',
  videoProvider: 'YOUTUBE',
  muxAssetId: null,
  muxPlaybackId: null,
  youtubeVideoId: 'paidYoutube',
};

const freeYoutubeCatalogueLesson = {
  ...paidYoutubeCatalogueLesson,
  id: 'lesson-free-youtube',
  title: 'Free YouTube Lesson',
  orderIndex: 0,
  accessLevel: 'FREE' as const,
  youtubeVideoId: 'freeYoutube',
};

describe('ContentService', () => {
  it('rejects paid lesson playback without premium entitlement', async () => {
    const service = new ContentService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'lesson-1',
            courseId: 'course-1',
            title: 'Paid Lesson',
            description: null,
            orderIndex: 0,
            isPublished: true,
            accessLevel: 'PAID',
            videoProvider: 'MUX',
            muxPlaybackId: 'muxPlaybackId000000000000000000001',
            durationSeconds: 120,
            tags: [],
          }),
        },
      }),
    );

    await expect(service.getLesson('lesson-1', null)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('returns paid lesson playback for premium users', async () => {
    const service = new ContentService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'lesson-1',
            courseId: 'course-1',
            title: 'Paid Lesson',
            description: null,
            orderIndex: 0,
            isPublished: true,
            accessLevel: 'PAID',
            videoProvider: 'MUX',
            muxPlaybackId: 'muxPlaybackId000000000000000000001',
            durationSeconds: 120,
            tags: [],
          }),
        },
      }),
    );

    const lesson = await withDatabaseUrl(LOCAL_DB, () =>
      service.getLesson('lesson-1', {
        id: 'user-1',
        clerkUserId: 'clerk-1',
        role: Role.STUDENT,
        entitlementTier: EntitlementTier.PREMIUM,
      }),
    );

    expect(lesson.video.playbackUrl).toBe('https://stream.mux.com/muxPlaybackId000000000000000000001.m3u8');
  });

  it('keeps missing lessons as not found errors', async () => {
    const service = new ContentService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );

    await expect(service.getLesson('missing', null)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  // /programs, /programs/:id and /courses/:id take no authentication at all, so
  // anything on those payloads is public. A provider identifier on a paid lesson
  // is the address of the video, not a name for it.
  describe('the unauthenticated catalogue', () => {
    function catalogueService(lessons: object[] = [freeCatalogueLesson, paidCatalogueLesson]) {
      const course = {
        id: 'course-1',
        programId: 'program-1',
        title: 'Course',
        description: null,
        orderIndex: 0,
        isPublished: true,
        lessons,
      };

      return new ContentService(
        createPrismaService({
          program: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'program-1',
                title: 'Program',
                description: null,
                orderIndex: 0,
                discipline: 'BJJ',
                isFeaturedDemo: false,
                isPublished: true,
                courses: [course],
              },
            ]),
          },
          course: { findFirst: vi.fn().mockResolvedValue(course) },
        }),
      );
    }

    it('withholds the playback id of a paid lesson from /programs', async () => {
      const [program] = await catalogueService().listPrograms();
      const lessons = program!.courses[0]!.lessons;

      expect(lessons.find((lesson) => lesson.accessLevel === 'PAID')?.muxPlaybackId).toBeNull();
    });

    it('withholds the playback id of a paid lesson from /courses/:id', async () => {
      const course = await catalogueService().getCourse('course-1');

      expect(
        course.lessons.find((lesson) => lesson.accessLevel === 'PAID')?.muxPlaybackId,
      ).toBeNull();
    });

    it('still lists the paid lesson itself, so it can be advertised', async () => {
      const course = await catalogueService().getCourse('course-1');
      const paid = course.lessons.find((lesson) => lesson.accessLevel === 'PAID');

      expect(paid).toMatchObject({ id: 'lesson-paid', title: 'Paid Lesson', durationSeconds: 120 });
    });

    it('keeps serving the playback id of a free lesson', async () => {
      const course = await catalogueService().getCourse('course-1');
      const free = course.lessons.find((lesson) => lesson.accessLevel === 'FREE');

      expect(free?.muxPlaybackId).toBe('freePlaybackId00000000000000000001');
    });

    // PAID + YOUTUBE is saveable today: createLesson and updateLesson in
    // apps/api/src/admin/admin.service.ts constrain accessLevel and
    // videoProvider independently. So a YouTube video id has to be withheld by
    // the same rule as the Mux playback id, not by the seed data happening to
    // make every YouTube lesson free.
    const youtubeCatalogue = () =>
      catalogueService([freeYoutubeCatalogueLesson, paidYoutubeCatalogueLesson]);

    it('withholds the video id of a paid YouTube lesson from /programs', async () => {
      const [program] = await youtubeCatalogue().listPrograms();
      const lessons = program!.courses[0]!.lessons;

      expect(
        lessons.find((lesson) => lesson.id === 'lesson-paid-youtube')?.youtubeVideoId,
      ).toBeNull();
    });

    it('withholds the video id of a paid YouTube lesson from /courses/:id', async () => {
      const course = await youtubeCatalogue().getCourse('course-1');

      expect(
        course.lessons.find((lesson) => lesson.id === 'lesson-paid-youtube')?.youtubeVideoId,
      ).toBeNull();
    });

    it('keeps serving the video id of a free YouTube lesson', async () => {
      const course = await youtubeCatalogue().getCourse('course-1');

      expect(
        course.lessons.find((lesson) => lesson.id === 'lesson-free-youtube')?.youtubeVideoId,
      ).toBe('freeYoutube');
    });
  });
});

describe('ProgressService', () => {
  it('upserts progress by user and lesson', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'progress-1' });
    const service = new ProgressService(
      createPrismaService({
        progress: { upsert },
      }),
    );

    await expect(service.upsert('user-1', 'lesson-1', 42, false)).resolves.toEqual({
      id: 'progress-1',
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_lessonId: { userId: 'user-1', lessonId: 'lesson-1' } },
      update: {
        lastPositionSeconds: 42,
        completed: false,
      },
      create: {
        userId: 'user-1',
        lessonId: 'lesson-1',
        lastPositionSeconds: 42,
        completed: false,
      },
    });
  });
});

describe('FavoritesService', () => {
  it('adds favorites idempotently with an upsert', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'favorite-1' });
    const service = new FavoritesService(
      createPrismaService({
        favorite: { upsert },
      }),
    );

    await expect(service.add('user-1', 'lesson-1')).resolves.toEqual({ id: 'favorite-1' });
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_lessonId: { userId: 'user-1', lessonId: 'lesson-1' } },
      update: {},
      create: { userId: 'user-1', lessonId: 'lesson-1' },
    });
  });

  it('removes favorites by user and lesson without throwing on missing rows', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = new FavoritesService(
      createPrismaService({
        favorite: { deleteMany },
      }),
    );

    await expect(service.remove('user-1', 'lesson-1')).resolves.toEqual({ count: 0 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', lessonId: 'lesson-1' },
    });
  });
});

describe('WebhooksService', () => {
  /**
   * These use mocked Prisma and only cover the shape of the writes. The
   * lifecycle itself - resubscribe, double subscription, refunds, out-of-order
   * events - is covered against a real database in billing-lifecycle.db.test.ts,
   * because every one of those defects was a constraint violation a mock cannot
   * raise.
   */
  type StoredSubscription = {
    status: string;
    currentPeriodEnd: Date | null;
    revokedAt: Date | null;
  };

  function createWebhooksService(
    options: {
      storedSubscriptions?: StoredSubscription[];
      alreadyProcessed?: boolean;
      existingEntitlement?: { tier: string; validUntil: Date | null; source: string } | null;
    } = {},
  ) {
    const subscriptionUpsert = vi.fn().mockResolvedValue({});
    const entitlementUpsert = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        stripeWebhookEvent: {
          findUnique: vi
            .fn()
            .mockResolvedValue(options.alreadyProcessed ? { status: 'PROCESSED' } : null),
          findFirst: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({}),
        },
        subscription: {
          upsert: subscriptionUpsert,
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue(options.storedSubscriptions ?? []),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        entitlement: {
          upsert: entitlementUpsert,
          // No existing entitlement: nothing manual to protect.
          findUnique: vi.fn().mockResolvedValue(options.existingEntitlement ?? null),
        },
      }),
    );

    return { service, subscriptionUpsert, entitlementUpsert };
  }

  function subscriptionEvent(type: string, object: Record<string, unknown>) {
    return {
      id: `evt_${type}`,
      type,
      created: 1_800_000_000,
      data: { object },
    } as unknown as Parameters<WebhooksService['handleStripeEvent']>[0];
  }

  it('records the subscription and syncs premium entitlements for active Stripe subscriptions', async () => {
    const currentPeriodEnd = 1_900_000_000;
    const { service, subscriptionUpsert, entitlementUpsert } = createWebhooksService({
      storedSubscriptions: [
        { status: 'active', currentPeriodEnd: new Date(currentPeriodEnd * 1000), revokedAt: null },
      ],
    });

    await service.handleStripeEvent(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        current_period_end: currentPeriodEnd,
        metadata: { userId: 'user-1' },
        items: { data: [{ price: { id: 'price_monthly' } }] },
      }),
    );

    expect(subscriptionUpsert).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_123' },
      update: expect.objectContaining({
        userId: 'user-1',
        stripeCustomerId: 'cus_123',
        status: 'active',
        currentPeriodEnd: new Date(currentPeriodEnd * 1000),
        planId: 'price_monthly',
        lastEventAt: new Date(1_800_000_000 * 1000),
      }),
      create: expect.objectContaining({
        stripeSubscriptionId: 'sub_123',
        userId: 'user-1',
      }),
    });
    expect(entitlementUpsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: { tier: 'PREMIUM', validUntil: new Date(currentPeriodEnd * 1000), source: 'STRIPE' },
      create: {
        userId: 'user-1',
        tier: 'PREMIUM',
        validUntil: new Date(currentPeriodEnd * 1000),
        source: 'STRIPE',
      },
    });
  });

  it('downgrades entitlements for inactive Stripe subscriptions', async () => {
    const { service, entitlementUpsert } = createWebhooksService({
      storedSubscriptions: [{ status: 'canceled', currentPeriodEnd: null, revokedAt: null }],
    });

    await service.handleStripeEvent(
      subscriptionEvent('customer.subscription.deleted', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        current_period_end: null,
        metadata: { userId: 'user-1' },
        items: { data: [] },
      }),
    );

    expect(entitlementUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ tier: 'FREE', validUntil: null }),
        create: expect.objectContaining({ tier: 'FREE', validUntil: null }),
      }),
    );
  });

  it('ignores subscription events without user metadata', async () => {
    const { service, subscriptionUpsert, entitlementUpsert } = createWebhooksService();

    await service.handleStripeEvent(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        current_period_end: null,
        metadata: {},
        items: { data: [] },
      }),
    );

    expect(subscriptionUpsert).not.toHaveBeenCalled();
    expect(entitlementUpsert).not.toHaveBeenCalled();
  });

  it('does not write over a live manual grant', async () => {
    const { service, entitlementUpsert } = createWebhooksService({
      storedSubscriptions: [{ status: 'canceled', currentPeriodEnd: null, revokedAt: null }],
      existingEntitlement: { tier: 'PREMIUM', validUntil: null, source: 'MANUAL' },
    });

    await service.handleStripeEvent(
      subscriptionEvent('customer.subscription.deleted', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        current_period_end: null,
        metadata: { userId: 'user-1' },
        items: { data: [] },
      }),
    );

    expect(entitlementUpsert).not.toHaveBeenCalled();
  });

  it('normalises an expanded customer object rather than stringifying it', async () => {
    const { service, subscriptionUpsert } = createWebhooksService();

    await service.handleStripeEvent(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_123',
        customer: { id: 'cus_expanded', object: 'customer' },
        status: 'active',
        current_period_end: null,
        metadata: { userId: 'user-1' },
        items: { data: [] },
      }),
    );

    expect(subscriptionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ stripeCustomerId: 'cus_expanded' }),
      }),
    );
  });

  it('skips a Stripe event it has already processed', async () => {
    const { service, subscriptionUpsert } = createWebhooksService({ alreadyProcessed: true });

    await service.handleStripeEvent(
      subscriptionEvent('customer.subscription.created', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        current_period_end: null,
        metadata: { userId: 'user-1' },
        items: { data: [] },
      }),
    );

    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });
});

describe('entitlement resolution', () => {
  const now = new Date('2026-07-29T00:00:00.000Z');
  const future = new Date('2026-08-29T00:00:00.000Z');
  const past = new Date('2026-06-29T00:00:00.000Z');

  it('keeps premium access while the entitlement is unexpired', () => {
    expect(isEntitlementActive({ tier: DbEntitlementTier.PREMIUM, validUntil: future }, now)).toBe(
      true,
    );
  });

  it('treats a null validUntil as never expiring', () => {
    expect(isEntitlementActive({ tier: DbEntitlementTier.PREMIUM, validUntil: null }, now)).toBe(
      true,
    );
  });

  it('drops premium access once validUntil has passed', () => {
    expect(isEntitlementActive({ tier: DbEntitlementTier.PREMIUM, validUntil: past }, now)).toBe(
      false,
    );
  });

  it('never grants access for a free tier, even with a future validUntil', () => {
    expect(isEntitlementActive({ tier: DbEntitlementTier.FREE, validUntil: future }, now)).toBe(
      false,
    );
  });

  it('treats a missing entitlement as free', () => {
    expect(isEntitlementActive(null, now)).toBe(false);
    expect(isEntitlementActive(undefined, now)).toBe(false);
  });

  it('maps active entitlements to PREMIUM and lapsed ones to FREE', () => {
    expect(
      resolveEntitlementTier({ tier: DbEntitlementTier.PREMIUM, validUntil: future }, now),
    ).toBe(EntitlementTier.PREMIUM);
    expect(resolveEntitlementTier({ tier: DbEntitlementTier.PREMIUM, validUntil: past }, now)).toBe(
      EntitlementTier.FREE,
    );
  });

  describe('isLiveStripeSubscription', () => {
    it('grants access only for an unrevoked subscription in a paying status', () => {
      expect(isLiveStripeSubscription({ status: 'active', revokedAt: null })).toBe(true);
      expect(isLiveStripeSubscription({ status: 'trialing', revokedAt: null })).toBe(true);
      expect(isLiveStripeSubscription({ status: 'past_due', revokedAt: null })).toBe(true);
      expect(isLiveStripeSubscription({ status: 'canceled', revokedAt: null })).toBe(false);
      expect(isLiveStripeSubscription({ status: 'active', revokedAt: past })).toBe(false);
    });
  });

  describe('resolveStripeEntitlement', () => {
    it('takes the furthest period end across every granting subscription', () => {
      expect(
        resolveStripeEntitlement([
          { status: 'active', currentPeriodEnd: past, revokedAt: null },
          { status: 'active', currentPeriodEnd: future, revokedAt: null },
        ]),
      ).toEqual({ tier: DbEntitlementTier.PREMIUM, validUntil: future });
    });

    it('does not let a subscription with no period end override a sibling that has one', () => {
      // A missing current_period_end means UNKNOWN, never "forever". Reading it
      // as no-expiry would hand out a free lifetime membership.
      expect(
        resolveStripeEntitlement([
          { status: 'active', currentPeriodEnd: future, revokedAt: null },
          { status: 'active', currentPeriodEnd: null, revokedAt: null },
        ]),
      ).toEqual({ tier: DbEntitlementTier.PREMIUM, validUntil: future });
    });

    it('leaves validUntil open only while every granting subscription lacks an end date', () => {
      expect(
        resolveStripeEntitlement([{ status: 'active', currentPeriodEnd: null, revokedAt: null }]),
      ).toEqual({ tier: DbEntitlementTier.PREMIUM, validUntil: null });
    });

    it('drops to FREE once the dateless subscription stops being live', () => {
      expect(
        resolveStripeEntitlement([{ status: 'canceled', currentPeriodEnd: null, revokedAt: null }]),
      ).toEqual({ tier: DbEntitlementTier.FREE, validUntil: null });
      expect(
        resolveStripeEntitlement([{ status: 'active', currentPeriodEnd: null, revokedAt: past }]),
      ).toEqual({ tier: DbEntitlementTier.FREE, validUntil: null });
    });
  });

  describe('subscription revocation', () => {
    it('records a reason and a date together so a revocation can always be explained', () => {
      const now = new Date('2026-07-29T12:00:00.000Z');

      expect(
        planRevocation({ revokedAt: null, revokedReason: null }, REVOKE_REASON_REFUND, now),
      ).toEqual({ revokedAt: now, revokedReason: REVOKE_REASON_REFUND });
    });

    it('upgrades a refund revocation to a chargeback but never the other way', () => {
      const now = new Date('2026-07-29T12:00:00.000Z');
      const refunded = { revokedAt: past, revokedReason: REVOKE_REASON_REFUND };
      const chargedBack = { revokedAt: past, revokedReason: REVOKE_REASON_CHARGEBACK };

      expect(planRevocation(refunded, REVOKE_REASON_CHARGEBACK, now)).toEqual({
        revokedAt: now,
        revokedReason: REVOKE_REASON_CHARGEBACK,
      });
      expect(planRevocation(chargedBack, REVOKE_REASON_REFUND, now)).toBeNull();
      expect(planRevocation(refunded, REVOKE_REASON_REFUND, now)).toBeNull();
    });

    describe('releasesRevocation', () => {
      const revokedAt = new Date('2026-07-01T00:00:00.000Z');
      const refunded = {
        revokedAt,
        revokedReason: REVOKE_REASON_REFUND,
        currentPeriodEnd: future,
      };
      const renewal = {
        status: 'active',
        currentPeriodEnd: new Date('2026-09-29T00:00:00.000Z'),
        stripeCreatedAt: now,
      };

      it('releases a refund revocation when the paid period moves forward', () => {
        expect(releasesRevocation(refunded, renewal)).toBe(true);
      });

      it('holds when the period did not move, whatever the status says', () => {
        // cancel_at_period_end, a card update and a plan change all look like this.
        expect(releasesRevocation(refunded, { ...renewal, currentPeriodEnd: future })).toBe(false);
        expect(releasesRevocation(refunded, { ...renewal, currentPeriodEnd: past })).toBe(false);
        expect(releasesRevocation(refunded, { ...renewal, currentPeriodEnd: null })).toBe(false);
      });

      it('holds for a chargeback however genuine the renewal looks', () => {
        expect(
          releasesRevocation(
            { ...refunded, revokedReason: REVOKE_REASON_CHARGEBACK },
            renewal,
          ),
        ).toBe(false);
      });

      it('holds for an event Stripe generated before the revocation', () => {
        expect(releasesRevocation(refunded, { ...renewal, stripeCreatedAt: past })).toBe(false);
      });

      it('holds when the subscription is not live', () => {
        expect(releasesRevocation(refunded, { ...renewal, status: 'canceled' })).toBe(false);
      });

      it('holds when the row was never revoked', () => {
        expect(
          releasesRevocation({ ...refunded, revokedAt: null, revokedReason: null }, renewal),
        ).toBe(false);
      });
    });
  });
});

describe('MeService', () => {
  function createMeService(
    entitlement: { tier: string; validUntil: Date | null } | null,
    subscriptions: Array<{
      status: string;
      currentPeriodEnd: Date | null;
      revokedAt: Date | null;
    }> = [],
  ) {
    return new MeService(
      createPrismaService({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            clerkUserId: 'clerk-1',
            role: 'STUDENT',
            entitlement,
            subscriptions,
          }),
        },
      }),
    );
  }

  it('reports a lapsed premium entitlement as free', async () => {
    const service = createMeService({
      tier: 'PREMIUM',
      validUntil: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(service.getMeByClerkId('clerk-1')).resolves.toMatchObject({
      entitlementTier: EntitlementTier.FREE,
    });
  });

  it('keeps an unexpired premium entitlement', async () => {
    const service = createMeService({ tier: 'PREMIUM', validUntil: null });

    await expect(service.getMeByClerkId('clerk-1')).resolves.toMatchObject({
      entitlementTier: EntitlementTier.PREMIUM,
    });
  });

  it('reports no active subscription and no period end for a revoked member', async () => {
    // A chargeback leaves the Stripe row reading "active" with a future period
    // end. Showing that next to a FREE entitlement reads as a contradiction.
    const service = createMeService({ tier: 'FREE', validUntil: null }, [
      {
        status: 'active',
        currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
        revokedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);

    await expect(service.getMeByClerkId('clerk-1')).resolves.toMatchObject({
      entitlementTier: EntitlementTier.FREE,
      subscriptionStatus: null,
      currentPeriodEnd: null,
    });
  });

  it('still reports an unrevoked subscription', async () => {
    const service = createMeService({ tier: 'PREMIUM', validUntil: null }, [
      {
        status: 'active',
        currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
        revokedAt: null,
      },
    ]);

    await expect(service.getMeByClerkId('clerk-1')).resolves.toMatchObject({
      subscriptionStatus: 'active',
      currentPeriodEnd: '2026-08-31T00:00:00.000Z',
    });
  });
});

describe('WebhooksService Mux signature verification', () => {
  const secret = 'mux-signing-secret';
  const body = JSON.stringify({ type: 'video.asset.ready', data: { id: 'asset-1' } });
  const payload = Buffer.from(body, 'utf8');

  function createService() {
    return new WebhooksService(createPrismaService({}));
  }

  it('accepts a correctly signed payload', async () => {
    await withMuxSecret(secret, () => {
      const signature = muxSignature(secret, body, Math.floor(Date.now() / 1000));

      expect(() => createService().verifyMuxSignature(payload, signature)).not.toThrow();
    });
  });

  it('rejects a payload tampered with after signing', async () => {
    await withMuxSecret(secret, () => {
      const signature = muxSignature(secret, body, Math.floor(Date.now() / 1000));
      const tampered = Buffer.from(body.replace('asset-1', 'asset-2'), 'utf8');

      expect(() => createService().verifyMuxSignature(tampered, signature)).toThrow(
        /signature mismatch/,
      );
    });
  });

  it('rejects a signature produced with a different secret', async () => {
    await withMuxSecret(secret, () => {
      const signature = muxSignature('not-the-secret', body, Math.floor(Date.now() / 1000));

      expect(() => createService().verifyMuxSignature(payload, signature)).toThrow(
        /signature mismatch/,
      );
    });
  });

  it('rejects a replay outside the timestamp tolerance', async () => {
    await withMuxSecret(secret, () => {
      const signature = muxSignature(secret, body, Math.floor(Date.now() / 1000) - 600);

      expect(() => createService().verifyMuxSignature(payload, signature)).toThrow(/tolerance/);
    });
  });

  it('rejects a malformed signature header', async () => {
    await withMuxSecret(secret, () => {
      expect(() => createService().verifyMuxSignature(payload, 'garbage')).toThrow(/Malformed/);
    });
  });

  it('refuses to verify when no signing secret is configured', async () => {
    await withMuxSecret(undefined, () => {
      const signature = muxSignature(secret, body, Math.floor(Date.now() / 1000));

      expect(() => createService().verifyMuxSignature(payload, signature)).toThrow(
        /not configured/,
      );
    });
  });
});

describe('Mux signed playback tokens', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const paidLesson = {
    id: 'lesson-1',
    courseId: 'course-1',
    title: 'Paid Lesson',
    description: null,
    orderIndex: 0,
    isPublished: true,
    accessLevel: 'PAID' as const,
    videoProvider: 'MUX',
    muxPlaybackId: 'playbackAbc00000000000000000000001',
    durationSeconds: 120,
    tags: [],
  };

  function withSigningKey<T>(keyId: string | undefined, key: string | undefined, run: () => T): T {
    const previous = {
      id: process.env.MUX_SIGNING_KEY_ID,
      key: process.env.MUX_SIGNING_KEY_PRIVATE,
    };
    const set = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };

    set('MUX_SIGNING_KEY_ID', keyId);
    set('MUX_SIGNING_KEY_PRIVATE', key);

    try {
      return run();
    } finally {
      set('MUX_SIGNING_KEY_ID', previous.id);
      set('MUX_SIGNING_KEY_PRIVATE', previous.key);
    }
  }

  function tokenFrom(playbackUrl: string | null | undefined) {
    const token = new URL(playbackUrl ?? '').searchParams.get('token');
    if (!token) throw new Error('no token on playback url');
    const [header, payload, signature] = token.split('.');
    return {
      raw: token,
      header: JSON.parse(Buffer.from(header!, 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')),
      signature: signature!,
      signedData: `${header}.${payload}`,
    };
  }

  it('signs with RS256 using the signing key id, and the signature verifies', () => {
    const detail = withSigningKey('signing-key-1', Buffer.from(privateKey).toString('base64'), () =>
      mapLessonDetail(paidLesson),
    );

    const token = tokenFrom(detail.video.playbackUrl);

    expect(token.header.alg).toBe('RS256');
    expect(token.header.kid).toBe('signing-key-1');
    expect(token.payload.sub).toBe('playbackAbc00000000000000000000001');
    expect(token.payload.aud).toBe('v');

    const verified = createVerify('RSA-SHA256')
      .update(token.signedData)
      .verify(publicKey, Buffer.from(token.signature, 'base64url'));

    expect(verified).toBe(true);
  });

  it('accepts a private key pasted as raw PEM instead of base64', () => {
    const detail = withSigningKey('signing-key-1', privateKey, () => mapLessonDetail(paidLesson));

    expect(tokenFrom(detail.video.playbackUrl).header.alg).toBe('RS256');
  });

  it('does not sign free lessons', () => {
    const detail = withSigningKey('signing-key-1', privateKey, () =>
      mapLessonDetail({ ...paidLesson, accessLevel: 'FREE' as const }),
    );

    expect(detail.video.playbackUrl).toBe('https://stream.mux.com/playbackAbc00000000000000000000001.m3u8');
  });

  // Measured against @mux/mux-player 3.11.4 in Chrome: a player handed both a
  // playbackId and a signed src requests the id form and drops the token, so
  // leaving the id on a paid payload would silently defeat signed playback.
  it('leaves a paid lesson with the signed url as its only playback handle', () => {
    const detail = withSigningKey('signing-key-1', privateKey, () => mapLessonDetail(paidLesson));

    expect(detail.muxPlaybackId).toBeNull();
    expect(detail.video.muxPlaybackId).toBeNull();
    expect(detail.video.playbackUrl).toContain('token=');
  });

  it('still hands a free lesson its playback id', () => {
    const detail = withSigningKey('signing-key-1', privateKey, () =>
      mapLessonDetail({ ...paidLesson, accessLevel: 'FREE' as const }),
    );

    expect(detail.video.muxPlaybackId).toBe('playbackAbc00000000000000000000001');
  });

  it('gives admins the real playback id back, so the lesson editor can show it', () => {
    expect(mapAdminLessonSummary({ ...paidLesson, muxAssetId: 'asset-1' })).toMatchObject({
      muxPlaybackId: 'playbackAbc00000000000000000000001',
      muxAssetId: 'asset-1',
    });
  });

  // The signing keys being absent used to fall back to an unsigned, never
  // expiring url whenever NODE_ENV was not 'production' - and nothing in this
  // repository sets NODE_ENV except `pnpm start`.
  describe('the unsigned fallback when no signing key is configured', () => {
    it('refuses on a deployed database, whatever NODE_ENV says', async () => {
      for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
        await withNodeEnv(NODE_ENV, () =>
          withDatabaseUrl(DEPLOYED_DB, () =>
            withSigningKey(undefined, undefined, () => {
              expect(() => mapLessonDetail(paidLesson)).toThrow(
                /Premium playback is not configured/,
              );
            }),
          ),
        );
      }
    });

    it('refuses when there is no DATABASE_URL to judge by', async () => {
      await withDatabaseUrl(undefined, () =>
        withSigningKey(undefined, undefined, () => {
          expect(() => mapLessonDetail(paidLesson)).toThrow(/Premium playback is not configured/);
        }),
      );
    });

    it('still works for a developer against a local database', async () => {
      const detail = await withDatabaseUrl(LOCAL_DB, () =>
        withSigningKey(undefined, undefined, () => mapLessonDetail(paidLesson)),
      );

      expect(detail.video.playbackUrl).toBe('https://stream.mux.com/playbackAbc00000000000000000000001.m3u8');
    });

    it('never applies to a free lesson, which is meant to be unsigned', async () => {
      const detail = await withDatabaseUrl(DEPLOYED_DB, () =>
        withSigningKey(undefined, undefined, () =>
          mapLessonDetail({ ...paidLesson, accessLevel: 'FREE' as const }),
        ),
      );

      expect(detail.video.playbackUrl).toBe('https://stream.mux.com/playbackAbc00000000000000000000001.m3u8');
    });
  });
});

// A YouTube video id is the whole address of the video too: it plays at
// youtube.com for anyone holding it unless that video is Private. Nothing ties
// accessLevel to a provider, so PAID + YOUTUBE is saveable and the id is
// withheld by the same rule as the Mux playback id.
describe('paid YouTube lessons', () => {
  const paidYoutubeLesson = {
    id: 'lesson-1',
    courseId: 'course-1',
    title: 'Paid YouTube Lesson',
    description: null,
    orderIndex: 0,
    isPublished: true,
    accessLevel: 'PAID' as const,
    videoProvider: 'YOUTUBE',
    youtubeVideoId: 'youtube-abc',
    durationSeconds: 120,
    tags: [],
  };

  it('leaves the embed url as the only handle on the video', () => {
    const detail = mapLessonDetail(paidYoutubeLesson);

    expect(detail.youtubeVideoId).toBeNull();
    expect(detail.video.youtubeVideoId).toBeNull();
    expect(detail.video.embedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/youtube-abc?rel=0&modestbranding=1',
    );
  });

  it('still hands a free lesson its video id', () => {
    const detail = mapLessonDetail({ ...paidYoutubeLesson, accessLevel: 'FREE' as const });

    expect(detail.youtubeVideoId).toBe('youtube-abc');
    expect(detail.video.youtubeVideoId).toBe('youtube-abc');
  });

  it('gives admins the real video id back, so the lesson editor can show it', () => {
    expect(mapAdminLessonSummary(paidYoutubeLesson)).toMatchObject({
      youtubeVideoId: 'youtube-abc',
    });
  });
});

/**
 * The invariant the catalogue cleanup exists for: a published lesson can never
 * resolve to a playback identifier the provider cannot address.
 *
 * The seeded catalogue published 16 lessons carrying mnemonics like
 * `seedgrddef101`, and each one loaded the player and then failed with "Video
 * does not exist". Clearing those rows fixes the catalogue as it stands; this
 * check is what stops the next one, because it lives on the read path and so
 * covers every lesson however it reached the database - seed, admin editor, or
 * webhook.
 */
describe('published lessons never resolve to an unplayable identifier', () => {
  const publishedLesson = {
    id: 'lesson-1',
    courseId: 'course-1',
    title: 'Published Lesson',
    description: null,
    orderIndex: 0,
    isPublished: true,
    accessLevel: 'FREE' as const,
    durationSeconds: 120,
    tags: [],
  };

  // Only values that are provably unplayable: the placeholders this repository
  // seeded, and values that cannot be interpolated into the playback URL. The
  // rule deliberately no longer guesses at a valid Mux shape - it used to
  // require 20 characters and so refused Mux's own documented 18-character
  // example, telling members a real lesson was not filmed. See
  // isValidMuxPlaybackId in @diaz/shared. A short made-up id like 'TODO' is
  // therefore accepted here and fails in the player instead, which is the
  // honest boundary of what shape can decide.
  const unplayableMuxIds = ['seedgrddef101', 'seedbcdoff802', 'a1B2c3D4e5F6g7H8i9/../x', ' pad ', ''];
  const unplayableYoutubeIds = ['not-filmed', 'https://youtu.be/M7lc1UVf-VE', 'TBD', ''];

  it.each(unplayableMuxIds)('reports a Mux lesson holding "%s" as having no video', async (id) => {
    for (const accessLevel of ['FREE', 'PAID'] as const) {
      const lesson = {
        ...publishedLesson,
        accessLevel,
        videoProvider: 'MUX',
        muxPlaybackId: id,
      };

      // DEPLOYED_DB with no signing key is the strictest case: a paid lesson
      // that still tried to build a Mux url here would throw a 500 instead.
      const detail = await withDatabaseUrl(DEPLOYED_DB, () => mapLessonDetail(lesson));

      expect(detail.video.provider).toBe(VideoProvider.NONE);
      expect(detail.video.playbackUrl).toBeNull();
      expect(detail.video.muxPlaybackId).toBeNull();
      expect(detail.muxPlaybackId).toBeNull();
      expect(mapLessonSummary(lesson).videoProvider).toBe(VideoProvider.NONE);
      expect(mapLessonSummary(lesson).muxPlaybackId).toBeNull();
    }
  });

  it.each(unplayableYoutubeIds)(
    'reports a YouTube lesson holding "%s" as having no video',
    (id) => {
      for (const accessLevel of ['FREE', 'PAID'] as const) {
        const lesson = {
          ...publishedLesson,
          accessLevel,
          videoProvider: 'YOUTUBE',
          youtubeVideoId: id,
        };
        const detail = mapLessonDetail(lesson);

        expect(detail.video.provider).toBe(VideoProvider.NONE);
        expect(detail.video.embedUrl).toBeNull();
        expect(detail.video.youtubeVideoId).toBeNull();
        expect(mapLessonSummary(lesson).videoProvider).toBe(VideoProvider.NONE);
      }
    },
  );

  // The regression this suite exists to prevent, at the read path rather than
  // in the helper: a genuine Mux id must reach the player. `a1B2c3D4e5F6g7H8i9`
  // is the 18-character value from Mux's own API reference response example,
  // and the previous 20-character floor routed it to NONE.
  it("serves Mux's documented 18-character example rather than hiding the lesson", async () => {
    const lesson = {
      ...publishedLesson,
      videoProvider: 'MUX',
      muxPlaybackId: 'a1B2c3D4e5F6g7H8i9',
    };
    const detail = await withDatabaseUrl(DEPLOYED_DB, () => mapLessonDetail(lesson));

    expect(detail.video.provider).toBe(VideoProvider.MUX);
    expect(detail.video.playbackUrl).toBe('https://stream.mux.com/a1B2c3D4e5F6g7H8i9.m3u8');
    expect(detail.video.muxPlaybackId).toBe('a1B2c3D4e5F6g7H8i9');
    expect(mapLessonSummary(lesson).videoProvider).toBe(VideoProvider.MUX);
  });

  it('still resolves identifiers the providers actually issue', () => {
    const mux = mapLessonDetail({
      ...publishedLesson,
      videoProvider: 'MUX',
      muxPlaybackId: 'a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M',
    });

    expect(mux.video.provider).toBe(VideoProvider.MUX);
    expect(mux.video.playbackUrl).toBe(
      'https://stream.mux.com/a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M.m3u8',
    );

    const youtube = mapLessonDetail({
      ...publishedLesson,
      videoProvider: 'YOUTUBE',
      youtubeVideoId: 'M7lc1UVf-VE',
    });

    expect(youtube.video.provider).toBe(VideoProvider.YOUTUBE);
    expect(youtube.video.embedUrl).toContain('/embed/M7lc1UVf-VE');
  });

  // A lesson whose asset is still encoding is not filmed *yet*, not broken. The
  // member sees the honest empty state - never a player that loads and fails,
  // and never a 500 for a paid lesson with no playback id to sign.
  it('presents a lesson awaiting its playback id as no video rather than a broken one', async () => {
    for (const accessLevel of ['FREE', 'PAID'] as const) {
      const lesson = {
        ...publishedLesson,
        accessLevel,
        videoProvider: 'MUX',
        muxAssetId: 'ihzWtvsLJ9QBT00jogcYeV7QKY700xzc72dFqpMLT5p34',
        muxPlaybackId: null,
      };
      const detail = await withDatabaseUrl(DEPLOYED_DB, () => mapLessonDetail(lesson));

      expect(detail.video.provider).toBe(VideoProvider.NONE);
      expect(detail.video.playbackUrl).toBeNull();
      expect(mapLessonSummary(lesson).videoProvider).toBe(VideoProvider.NONE);
    }
  });

  // The asset id is the webhook's join key, not a handle on a video: it plays
  // nothing without the Mux API credentials. It still stays off the public
  // summary, which is what /programs answers to anonymous callers.
  it('keeps the mux asset id off the public summary of an awaiting lesson', () => {
    const summary = mapLessonSummary({
      ...publishedLesson,
      videoProvider: 'MUX',
      muxAssetId: 'ihzWtvsLJ9QBT00jogcYeV7QKY700xzc72dFqpMLT5p34',
      muxPlaybackId: null,
    });

    expect(summary).not.toHaveProperty('muxAssetId');
  });

  // The one place the awaiting state has to be visible: staff. It is derived
  // from the three stored fields, so the admin payload needs no extra field and
  // nothing can fall out of step with the row.
  it('shows staff the asset a lesson is waiting on', () => {
    expect(
      mapAdminLessonSummary({
        ...publishedLesson,
        videoProvider: 'MUX',
        muxAssetId: 'ihzWtvsLJ9QBT00jogcYeV7QKY700xzc72dFqpMLT5p34',
        muxPlaybackId: null,
      }),
    ).toMatchObject({
      videoProvider: VideoProvider.MUX,
      muxAssetId: 'ihzWtvsLJ9QBT00jogcYeV7QKY700xzc72dFqpMLT5p34',
      muxPlaybackId: null,
    });
  });

  // Members get what plays; staff get what is stored. The lesson editor loads
  // this payload straight into its form, so hiding the provider would blank the
  // identifier an admin had typed on their next save.
  it('still shows staff the provider and identifier stored on the row', () => {
    expect(
      mapAdminLessonSummary({
        ...publishedLesson,
        videoProvider: 'MUX',
        muxPlaybackId: 'seedgrddef101',
      }),
    ).toMatchObject({
      videoProvider: VideoProvider.MUX,
      muxPlaybackId: 'seedgrddef101',
    });
  });
});

describe('WebhooksService Mux asset sync', () => {
  it('writes the public playback id and rounded duration onto a free lesson', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'FREE', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        duration: 723.4,
        playback_ids: [{ id: 'publicPlayback00000000000000000001', policy: 'public' }],
      },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: { muxPlaybackId: 'publicPlayback00000000000000000001', durationSeconds: 723 },
    });
  });

  // The FREE half of the same rule the PAID path already follows: the id comes
  // from the policy the access level requires, or the delivery is refused. It
  // used to fall through to playbackIds[0], which stores an identifier that
  // cannot play over the plain url a free lesson is served with.
  it('refuses a free lesson asset whose only playback id is signed', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'FREE', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: { id: 'asset-1', duration: 60, playback_ids: [{ id: 'signed-only', policy: 'signed' }] },
      }),
    ).rejects.toThrow(/asset-1 has no public playback id.*FREE lesson lesson-1/);

    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a free lesson asset whose playback id carries no policy at all', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'FREE', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: { id: 'asset-1', playback_ids: [{ id: 'unlabelled' }] },
      }),
    ).rejects.toThrow(/has no public playback id/);

    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a free lesson asset that carries no playback ids at all', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'FREE', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({ type: 'video.asset.ready', data: { id: 'asset-1', duration: 60 } }),
    ).rejects.toThrow(/has no public playback id/);

    expect(update).not.toHaveBeenCalled();
  });

  it('still takes the public id for a free lesson when the asset also carries a signed one', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'FREE', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        playback_ids: [
          { id: 'signed-one', policy: 'signed' },
          { id: 'publicOne0000000000000000000000001', policy: 'public' },
        ],
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ muxPlaybackId: 'publicOne0000000000000000000000001' }) }),
    );
  });

  it('picks the signed playback id for a paid lesson', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'PAID', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        duration: 60,
        playback_ids: [{ id: 'signedPlayback00000000000000000001', policy: 'signed' }],
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ muxPlaybackId: 'signedPlayback00000000000000000001' }),
      }),
    );
  });

  // A signed playback id next to a public one does not cancel the public one -
  // nothing stops a caller using it, so the asset is still watchable by anyone
  // holding that id. This is also the shape the refusal's own recovery path
  // invites: adding a signed id to the offending asset is cheaper than
  // re-uploading it, and must not turn the delivery green.
  it('refuses a mixed-policy asset for a paid lesson, signed sibling and all', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'PAID', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: {
          id: 'asset-1',
          duration: 60,
          playback_ids: [
            { id: 'publicPlayback00000000000000000001', policy: 'public' },
            { id: 'signedPlayback00000000000000000001', policy: 'signed' },
          ],
        },
      }),
    ).rejects.toThrow(
      /asset-1 has a public playback id.*PAID lesson lesson-1.*signed-only playback policy/,
    );

    expect(update).not.toHaveBeenCalled();
  });

  // A public playback id on a paid lesson makes the video watchable by anyone
  // holding the id, whatever this API chooses to serve. There is no acceptable
  // second choice, so the delivery fails instead - visibly, in the Mux
  // dashboard, next to the asset whose upload policy is wrong.
  it('refuses a public-only asset for a paid lesson rather than accepting it', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'PAID', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: {
          id: 'asset-1',
          duration: 60,
          playback_ids: [{ id: 'publicPlayback00000000000000000001', policy: 'public' }],
        },
      }),
    ).rejects.toThrow(/asset-1 has a public playback id.*PAID lesson lesson-1/);

    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a paid asset that carries no playback ids at all', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'lesson-1', accessLevel: 'PAID', videoProvider: 'MUX' }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: { id: 'asset-1', duration: 60 },
      }),
    ).rejects.toThrow(/no signed playback id/);

    expect(update).not.toHaveBeenCalled();
  });

  it('does not fall back to a public id when the paid lesson already has one', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'lesson-1',
            accessLevel: 'PAID',
            videoProvider: 'MUX',
            muxPlaybackId: 'old',
          }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: {
          id: 'asset-1',
          playback_ids: [{ id: 'publicPlayback00000000000000000001' }, { id: 'another-public', policy: 'public' }],
        },
      }),
    ).rejects.toThrow(/has a public playback id/);

    expect(update).not.toHaveBeenCalled();
  });

  // The lesson was saved as the asset alone, which is what an upload leaves
  // behind. Completing it means the provider as well as the playback id -
  // otherwise the id lands on a row no read path treats as a Mux lesson.
  it('sets the provider when completing a lesson that was not marked as Mux yet', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'lesson-1',
            accessLevel: 'FREE',
            videoProvider: 'NONE',
            muxAssetId: 'asset-1',
            muxPlaybackId: null,
          }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        duration: 723.4,
        playback_ids: [{ id: 'publicPlayback00000000000000000001', policy: 'public' }],
      },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: {
        muxPlaybackId: 'publicPlayback00000000000000000001',
        durationSeconds: 723,
        videoProvider: 'MUX',
      },
    });
  });

  // Mux retries, so the same event arrives more than once. The second delivery
  // has to be a no-op rather than a write that happens to land on the values
  // already stored - a lesson that is already correct is left alone.
  it('writes nothing when the lesson already holds everything the event carries', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'lesson-1',
            accessLevel: 'FREE',
            videoProvider: 'MUX',
            muxAssetId: 'asset-1',
            muxPlaybackId: 'publicPlayback00000000000000000001',
            durationSeconds: 723,
          }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        duration: 723.4,
        playback_ids: [{ id: 'publicPlayback00000000000000000001', policy: 'public' }],
      },
    });

    expect(update).not.toHaveBeenCalled();
  });

  // A row cannot be served by two providers at once, and the database says so.
  // Writing a Mux playback id next to a YouTube video id would violate
  // `lesson_video_provider_consistency_chk`, turning every redelivery into an
  // opaque 500 forever - so it is refused with the reason instead.
  it('refuses a lesson that still holds a YouTube video id', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'lesson-1',
            accessLevel: 'FREE',
            videoProvider: 'YOUTUBE',
            muxAssetId: 'asset-1',
            youtubeVideoId: 'M7lc1UVf-VE',
          }),
          update,
        },
      }),
    );

    await expect(
      service.handleMuxWebhook({
        type: 'video.asset.ready',
        data: {
          id: 'asset-1',
          playback_ids: [{ id: 'publicPlayback00000000000000000001', policy: 'public' }],
        },
      }),
    ).rejects.toThrow(/still holds a YouTube video id/);

    expect(update).not.toHaveBeenCalled();
  });

  // `isAwaitingMuxPlayback` reads a whitespace-only YouTube video id as absent,
  // and so does `lesson_video_provider_consistency_chk` through
  // NULLIF(TRIM("youtubeVideoId"), ''). A row shaped like this therefore carries
  // the "Waiting for Mux" badge and the redeliver remedy, so the webhook has to
  // complete it rather than refuse the redelivery the badge asked for.
  it('completes a lesson whose YouTube video id is only whitespace', async () => {
    const lesson = {
      id: 'lesson-1',
      accessLevel: 'FREE',
      videoProvider: VideoProvider.MUX,
      muxAssetId: 'asset-1',
      muxPlaybackId: null,
      youtubeVideoId: '   ',
    };
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: { findFirst: vi.fn().mockResolvedValue(lesson), update },
      }),
    );

    expect(isAwaitingMuxPlayback(lesson)).toBe(true);

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        playback_ids: [{ id: 'publicPlayback00000000000000000001', policy: 'public' }],
      },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: { muxPlaybackId: 'publicPlayback00000000000000000001' },
    });
  });

  it('ignores assets that do not belong to any lesson', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: { findFirst: vi.fn().mockResolvedValue(null), update },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: { id: 'unknown-asset' },
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('ignores unrelated Mux event types', async () => {
    const findFirst = vi.fn();
    const service = new WebhooksService(createPrismaService({ lesson: { findFirst } }));

    await service.handleMuxWebhook({ type: 'video.upload.created', data: { id: 'upload-1' } });

    expect(findFirst).not.toHaveBeenCalled();
  });
});
