import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EntitlementTier, Role } from '@diaz/shared';
import { EntitlementTier as DbEntitlementTier } from '@diaz/db';
import { isEntitlementActive, resolveEntitlementTier } from '../common/entitlement.js';
import { ContentService } from '../content/content.service.js';
import { mapLessonDetail } from '../content/lesson-presentation.js';
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
  user: { findUnique: ReturnType<typeof vi.fn> };
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
});

describe('MeService', () => {
  function createMeService(entitlement: { tier: string; validUntil: Date | null } | null) {
    return new MeService(
      createPrismaService({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            clerkUserId: 'clerk-1',
            role: 'STUDENT',
            entitlement,
            subscription: null,
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
    muxPlaybackId: 'playback-abc',
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
    expect(token.payload.sub).toBe('playback-abc');
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

    expect(detail.video.playbackUrl).toBe('https://stream.mux.com/playback-abc.m3u8');
  });
});

describe('WebhooksService Mux asset sync', () => {
  it('writes the public playback id and rounded duration onto a free lesson', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({ id: 'lesson-1', accessLevel: 'FREE' }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        duration: 723.4,
        playback_ids: [{ id: 'public-playback', policy: 'public' }],
      },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'lesson-1' },
      data: { muxPlaybackId: 'public-playback', durationSeconds: 723 },
    });
  });

  it('picks the signed playback id for a paid lesson', async () => {
    const update = vi.fn().mockResolvedValue({});
    const service = new WebhooksService(
      createPrismaService({
        lesson: {
          findFirst: vi.fn().mockResolvedValue({ id: 'lesson-1', accessLevel: 'PAID' }),
          update,
        },
      }),
    );

    await service.handleMuxWebhook({
      type: 'video.asset.ready',
      data: {
        id: 'asset-1',
        duration: 60,
        playback_ids: [
          { id: 'public-playback', policy: 'public' },
          { id: 'signed-playback', policy: 'signed' },
        ],
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ muxPlaybackId: 'signed-playback' }),
      }),
    );
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
