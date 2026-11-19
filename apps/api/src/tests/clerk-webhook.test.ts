import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksController } from '../webhooks/webhooks.controller.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

/**
 * `POST /webhooks/clerk` driven over HTTP through a real Nest app created with
 * `rawBody: true`, as createApiApp creates the production one, so the signature
 * is checked against the exact bytes Clerk sent. Prisma is mocked here; what the
 * delete removes from a real database is in journal.db.test.ts.
 */

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const OTHER_SECRET = 'whsec_dGhpcy1pcy1ub3QtdGhlLWNsZXJrLXNlY3JldA==';

function sign(secret: string, id: string, timestamp: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function userDeleted(clerkUserId: string) {
  return JSON.stringify({
    type: 'user.deleted',
    object: 'event',
    data: { id: clerkUserId, deleted: true, object: 'user' },
  });
}

const deleteMany = vi.fn();
let app: INestApplication | undefined;
let url = '';
let previousSecret: string | undefined;

// Vitest compiles with esbuild, which emits no decorator metadata, so Nest would
// inject undefined. These are the constructor types tsc emits for the real build.
Reflect.defineMetadata('design:paramtypes', [WebhooksService], WebhooksController);
Reflect.defineMetadata('design:paramtypes', [PrismaService, Object], WebhooksService);

async function startApp() {
  @Module({
    controllers: [WebhooksController],
    providers: [
      WebhooksService,
      { provide: PrismaService, useValue: { client: { journalEntry: { deleteMany } } } },
    ],
  })
  class ClerkWebhookTestModule {}

  app = await NestFactory.create(ClerkWebhookTestModule, { rawBody: true, logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
}

async function deliver(
  body: string,
  {
    secret = SECRET,
    id = 'msg_2abc',
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature,
  }: { secret?: string; id?: string; timestamp?: string; signature?: string } = {},
) {
  const response = await fetch(`${url}/webhooks/clerk`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature ?? sign(secret, id, timestamp, body),
    },
    body,
  });

  const { message } = (await response.json()) as { message?: string };
  return { status: response.status, message };
}

function rejected(reason: RegExp) {
  return { status: 400, message: expect.stringMatching(reason) };
}

beforeEach(async () => {
  previousSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET;
  deleteMany.mockReset();
  deleteMany.mockResolvedValue({ count: 0 });
  await startApp();
});

afterEach(async () => {
  await app?.close();
  app = undefined;

  if (previousSecret === undefined) {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  } else {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = previousSecret;
  }
});

describe('POST /webhooks/clerk', () => {
  it("deletes the deleted member's journal entries on a correctly signed user.deleted", async () => {
    deleteMany.mockResolvedValue({ count: 3 });

    expect((await deliver(userDeleted('user_member'))).status).toBe(201);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { user: { clerkUserId: 'user_member' } } });
  });

  it('succeeds for a Clerk user this API never saw, deleting nothing', async () => {
    deleteMany.mockResolvedValue({ count: 0 });

    expect((await deliver(userDeleted('user_never_signed_in'))).status).toBe(201);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { user: { clerkUserId: 'user_never_signed_in' } },
    });
  });

  it('rejects a delivery signed with a different secret and deletes nothing', async () => {
    expect(await deliver(userDeleted('user_member'), { secret: OTHER_SECRET })).toEqual(
      rejected(/signature mismatch/),
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a body changed after signing', async () => {
    const id = 'msg_2abc';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(SECRET, id, timestamp, userDeleted('user_member'));

    expect(await deliver(userDeleted('user_someone_else'), { id, timestamp, signature })).toEqual(
      rejected(/signature mismatch/),
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a replay outside the timestamp tolerance', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 600);

    expect(await deliver(userDeleted('user_member'), { timestamp: stale })).toEqual(
      rejected(/outside of tolerance/),
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rejects every delivery while no signing secret is configured', async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;

    expect(await deliver(userDeleted('user_member'))).toEqual(rejected(/not configured/));
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a delivery with no svix headers', async () => {
    const response = await fetch(`${url}/webhooks/clerk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: userDeleted('user_member'),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'Missing svix headers or raw body' });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('accepts any matching signature in the list, as during a secret rotation', async () => {
    const body = userDeleted('user_member');
    const id = 'msg_2abc';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `${sign(OTHER_SECRET, id, timestamp, body)} ${sign(SECRET, id, timestamp, body)}`;

    expect((await deliver(body, { id, timestamp, signature })).status).toBe(201);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it('acknowledges other event types without touching the journal', async () => {
    const body = JSON.stringify({ type: 'user.updated', data: { id: 'user_member' } });

    expect((await deliver(body)).status).toBe(201);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('WebhooksService.verifyClerkSignature', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts Svix's own published test vector", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1614265330 * 1000);

    expect(() =>
      new WebhooksService({ client: {} } as unknown as PrismaService).verifyClerkSignature(
        Buffer.from('{"test": 2432232314}', 'utf8'),
        {
          id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
          timestamp: '1614265330',
          signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
        },
      ),
    ).not.toThrow();
  });
});
