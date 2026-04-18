import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EntitlementTier, Role } from '@diaz/shared';
import { ContentService } from '../content/content.service.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import { ProgressService } from '../progress/progress.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

type MockPrismaClient = Partial<{
  lesson: { findFirst: ReturnType<typeof vi.fn> };
  progress: { upsert: ReturnType<typeof vi.fn> };
  favorite: {
    upsert?: ReturnType<typeof vi.fn>;
    deleteMany?: ReturnType<typeof vi.fn>;
  };
  subscription: { upsert: ReturnType<typeof vi.fn> };
  entitlement: { upsert: ReturnType<typeof vi.fn> };
}>;

function createPrismaService(client: MockPrismaClient): PrismaService {
  return { client } as unknown as PrismaService;
}

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
            muxPlaybackId: 'mux-playback-id',
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
            muxPlaybackId: 'mux-playback-id',
            durationSeconds: 120,
            tags: [],
          }),
        },
      }),
    );

    const lesson = await service.getLesson('lesson-1', {
      id: 'user-1',
      clerkUserId: 'clerk-1',
      role: Role.STUDENT,
      entitlementTier: EntitlementTier.PREMIUM,
    });

    expect(lesson.video.playbackUrl).toBe('https://stream.mux.com/mux-playback-id.m3u8');
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
  it('syncs premium entitlements for active Stripe subscriptions', async () => {
    const subscriptionUpsert = vi.fn().mockResolvedValue({});
    const entitlementUpsert = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        subscription: { upsert: subscriptionUpsert },
        entitlement: { upsert: entitlementUpsert },
      }),
    );
    const currentPeriodEnd = 1_900_000_000;

    await service.handleStripeSubscriptionEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          current_period_end: currentPeriodEnd,
          metadata: { userId: 'user-1' },
          items: { data: [{ price: { id: 'price_monthly' } }] },
        },
      },
    } as unknown as Parameters<WebhooksService['handleStripeSubscriptionEvent']>[0]);

    expect(subscriptionUpsert).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_123' },
      update: {
        userId: 'user-1',
        stripeCustomerId: 'cus_123',
        status: 'active',
        currentPeriodEnd: new Date(currentPeriodEnd * 1000),
        planId: 'price_monthly',
      },
      create: {
        userId: 'user-1',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        status: 'active',
        currentPeriodEnd: new Date(currentPeriodEnd * 1000),
        planId: 'price_monthly',
      },
    });
    expect(entitlementUpsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        tier: 'PREMIUM',
        validUntil: new Date(currentPeriodEnd * 1000),
      },
      create: {
        userId: 'user-1',
        tier: 'PREMIUM',
        validUntil: new Date(currentPeriodEnd * 1000),
      },
    });
  });

  it('downgrades entitlements for inactive Stripe subscriptions', async () => {
    const entitlementUpsert = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        subscription: { upsert: vi.fn().mockResolvedValue({}) },
        entitlement: { upsert: entitlementUpsert },
      }),
    );

    await service.handleStripeSubscriptionEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'canceled',
          current_period_end: null,
          metadata: { userId: 'user-1' },
          items: { data: [] },
        },
      },
    } as unknown as Parameters<WebhooksService['handleStripeSubscriptionEvent']>[0]);

    expect(entitlementUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ tier: 'FREE', validUntil: null }),
        create: expect.objectContaining({ tier: 'FREE', validUntil: null }),
      }),
    );
  });

  it('ignores subscription events without user metadata', async () => {
    const subscriptionUpsert = vi.fn().mockResolvedValue({});
    const entitlementUpsert = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        subscription: { upsert: subscriptionUpsert },
        entitlement: { upsert: entitlementUpsert },
      }),
    );

    await service.handleStripeSubscriptionEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          current_period_end: null,
          metadata: {},
          items: { data: [] },
        },
      },
    } as unknown as Parameters<WebhooksService['handleStripeSubscriptionEvent']>[0]);

    expect(subscriptionUpsert).not.toHaveBeenCalled();
    expect(entitlementUpsert).not.toHaveBeenCalled();
  });
});
