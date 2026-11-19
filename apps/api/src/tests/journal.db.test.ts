/**
 * Database-backed tests for the member journal. Run against a real Postgres
 * because the things that matter here are invisible to a mocked client: the
 * Trends threshold is a distinct-member count in raw SQL, and a member's delete
 * reaching the staff views, or an account removal reaching the journal, are
 * cascades, and a Clerk account deletion must take that member's journal and
 * nothing else. See the header of billing-lifecycle.db.test.ts for the commands.
 */
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { EntitlementTier as DbEntitlementTier, PrismaClient } from '@diaz/db';
import {
  Discipline,
  EntitlementTier,
  JOURNAL_TRENDS_MIN_MEMBERS,
  JournalOutcome,
  Role,
  journalEntryWriteSchema,
  type JournalEntryWriteDto,
} from '@diaz/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser, RequestWithUser } from '../common/request-with-user.js';
import { AdminJournalService } from '../journal/admin-journal.service.js';
import { JournalService } from '../journal/journal.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl && process.env.CI) {
  throw new Error('TEST_DATABASE_URL is required on CI: these journal tests must not skip.');
}

const prismaClient = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['error'] })
  : null;

const prisma = { client: prismaClient } as unknown as PrismaService;

const TRACK = 'guard-passing-offense';

function entryFor(
  outcome: JournalOutcome,
  overrides: Partial<JournalEntryWriteDto> = {},
): JournalEntryWriteDto {
  return journalEntryWriteSchema.parse({
    sessionDate: '2026-01-15',
    discipline: Discipline.BJJ,
    items: [{ track: TRACK, outcome }],
    note: 'Passing felt slow',
    ...overrides,
  });
}

async function statusOf(run: Promise<unknown>) {
  return run.then(
    () => 'ok',
    (error) => (error instanceof HttpException ? error.getStatus() : 'unexpected'),
  );
}

beforeAll(async () => {
  await prismaClient?.$connect();
});

afterAll(async () => {
  await prismaClient?.$disconnect();
});

describe.skipIf(!prismaClient)('member journal (database-backed)', () => {
  const journal = new JournalService(prisma);
  const staff = new AdminJournalService(prisma);
  const createdUserIds: string[] = [];

  async function createMember({ adult = true, premium = true } = {}): Promise<AuthUser> {
    const user = await prismaClient!.user.create({
      data: {
        clerkUserId: `journal_test_${randomUUID()}`,
        adultConfirmedAt: adult ? new Date() : null,
        entitlement: {
          create: { tier: premium ? DbEntitlementTier.PREMIUM : DbEntitlementTier.FREE },
        },
      },
    });
    createdUserIds.push(user.id);

    return {
      id: user.id,
      clerkUserId: user.clerkUserId,
      role: Role.STUDENT,
      entitlementTier: premium ? EntitlementTier.PREMIUM : EntitlementTier.FREE,
    };
  }

  function bjjTrend(items: { track: string }[]) {
    return items.find((item) => item.track === TRACK);
  }

  afterEach(async () => {
    await prismaClient!.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
  });

  it('stores an entry, replaces its items on edit and returns the calendar date', async () => {
    const member = await createMember();
    const created = await journal.create(member, entryFor(JournalOutcome.WORKED));

    expect(created.sessionDate).toBe('2026-01-15');

    await journal.update(
      member,
      created.id,
      entryFor(JournalOutcome.DID_NOT_WORK, {
        sessionDate: '2026-01-16',
        items: [
          { track: 'side-control-defense', outcome: JournalOutcome.DID_NOT_WORK },
          { track: TRACK, outcome: JournalOutcome.DID_NOT_WORK },
        ],
        note: null,
      }),
    );

    const { entries } = await journal.overview(member);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sessionDate: '2026-01-16', note: null });
    expect(entries[0]?.items.map((item) => item.track)).toEqual([TRACK, 'side-control-defense']);
  });

  it('answers 404 for another member entry on read-through, edit and delete', async () => {
    const owner = await createMember();
    const other = await createMember();
    const entry = await journal.create(owner, entryFor(JournalOutcome.WORKED));

    expect((await journal.overview(other)).entries).toEqual([]);
    expect(await statusOf(journal.update(other, entry.id, entryFor(JournalOutcome.WORKED)))).toBe(
      404,
    );
    expect(await statusOf(journal.remove(other.id, entry.id))).toBe(404);
    expect((await journal.overview(owner)).entries).toHaveLength(1);
  });

  it('requires premium and the 18+ confirmation to write, and neither to read or delete', async () => {
    const unconfirmed = await createMember({ adult: false });

    expect(await statusOf(journal.create(unconfirmed, entryFor(JournalOutcome.WORKED)))).toBe(403);

    await journal.confirmAdult(unconfirmed.id);
    const firstConfirmation = await prismaClient!.user.findUniqueOrThrow({
      where: { id: unconfirmed.id },
    });
    await journal.confirmAdult(unconfirmed.id);
    const secondConfirmation = await prismaClient!.user.findUniqueOrThrow({
      where: { id: unconfirmed.id },
    });

    expect(secondConfirmation.adultConfirmedAt).toEqual(firstConfirmation.adultConfirmedAt);

    const entry = await journal.create(unconfirmed, entryFor(JournalOutcome.WORKED));

    // Through the real auth path, so this is the tier a revocation actually leaves
    // the member with rather than one this test asserted for itself.
    await prismaClient!.entitlement.update({
      where: { userId: unconfirmed.id },
      data: { tier: DbEntitlementTier.FREE, validUntil: null },
    });
    process.env.DEV_BYPASS_AUTH = 'true';
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    const revoked = await new AuthService(prisma)
      .authenticateRequest({
        headers: { 'x-dev-user-id': unconfirmed.clerkUserId },
      } as unknown as RequestWithUser)
      .finally(() => {
        delete process.env.DEV_BYPASS_AUTH;
        process.env.DATABASE_URL = previousUrl;
      });

    const overview = await journal.overview(revoked);

    expect(overview).toMatchObject({ adultConfirmed: true, canWrite: false });
    expect(overview.entries).toHaveLength(1);
    expect(await statusOf(journal.create(revoked, entryFor(JournalOutcome.WORKED)))).toBe(402);
    expect(await statusOf(journal.update(revoked, entry.id, entryFor(JournalOutcome.WORKED)))).toBe(
      402,
    );
    expect(await statusOf(journal.remove(revoked.id, entry.id))).toBe('ok');
    expect((await journal.overview(revoked)).entries).toEqual([]);
  });

  describe('Trends', () => {
    const range = { from: '2031-03-01', to: '2031-03-31' };
    const inRange = { sessionDate: '2026-01-15' };

    /** A range nothing else in a shared database falls into. */
    async function seedMark(member: AuthUser, outcome: JournalOutcome, sessionDate: string) {
      const entry = await journal.create(member, entryFor(outcome, inRange));
      await prismaClient!.journalEntry.update({
        where: { id: entry.id },
        data: { sessionDate: new Date(`${sessionDate}T00:00:00.000Z`) },
      });
      return entry;
    }

    it('hides an item until enough distinct members tagged it, counting both outcomes', async () => {
      const members = await Promise.all(
        Array.from({ length: JOURNAL_TRENDS_MIN_MEMBERS }, () => createMember()),
      );
      const [first, second, third] = members as [AuthUser, AuthUser, AuthUser];

      // One member repeating an item must not reach the threshold on their own.
      await seedMark(first, JournalOutcome.DID_NOT_WORK, '2031-03-10');
      await seedMark(first, JournalOutcome.DID_NOT_WORK, '2031-03-11');
      await seedMark(first, JournalOutcome.DID_NOT_WORK, '2031-03-12');
      await seedMark(second, JournalOutcome.WORKED, '2031-03-10');

      expect(bjjTrend((await staff.trends(range)).items)).toBeUndefined();

      const last = await seedMark(third, JournalOutcome.DID_NOT_WORK, '2031-03-10');

      expect(bjjTrend((await staff.trends(range)).items)).toEqual({
        discipline: Discipline.BJJ,
        track: TRACK,
        workedCount: 1,
        didNotWorkCount: 4,
        memberCount: 3,
      });

      expect(
        bjjTrend((await staff.trends({ ...range, discipline: Discipline.MUAY_THAI })).items),
      ).toBeUndefined();
      expect(
        bjjTrend((await staff.trends({ from: '2031-03-11', to: '2031-03-31' })).items),
      ).toBeUndefined();

      // A member's delete drops the count back under the threshold, for staff too.
      await journal.remove(third.id, last.id);

      expect(bjjTrend((await staff.trends(range)).items)).toBeUndefined();
    });
  });

  it('shows staff every entry and note with no threshold, until the member deletes it', async () => {
    const member = await createMember();
    const entry = await journal.create(member, entryFor(JournalOutcome.DID_NOT_WORK));

    expect((await staff.getMember(member.id)).entries).toEqual([
      expect.objectContaining({ id: entry.id, note: 'Passing felt slow' }),
    ]);
    expect((await staff.listMembers()).find((row) => row.id === member.id)).toMatchObject({
      label: member.clerkUserId,
      entryCount: 1,
      lastSessionDate: '2026-01-15',
    });

    await journal.remove(member.id, entry.id);

    expect((await staff.getMember(member.id)).entries).toEqual([]);
    expect((await staff.listMembers()).find((row) => row.id === member.id)).toBeUndefined();
  });

  it('removes the journal with the account', async () => {
    const member = await createMember();
    const entry = await journal.create(member, entryFor(JournalOutcome.WORKED));

    await prismaClient!.user.delete({ where: { id: member.id } });

    expect(await prismaClient!.journalEntry.count({ where: { id: entry.id } })).toBe(0);
    expect(await prismaClient!.journalEntryItem.count({ where: { entryId: entry.id } })).toBe(0);
  });

  it("deletes only the deleted member's journal when Clerk deletes the account", async () => {
    const webhooks = new WebhooksService(prisma);
    const member = await createMember();
    const other = await createMember();
    const entries = [
      await journal.create(member, entryFor(JournalOutcome.WORKED)),
      await journal.create(member, entryFor(JournalOutcome.DID_NOT_WORK)),
    ];
    const kept = await journal.create(other, entryFor(JournalOutcome.DID_NOT_WORK));
    const deleted = { type: 'user.deleted', data: { id: member.clerkUserId } };

    await webhooks.handleClerkWebhook(deleted);

    const entryIds = entries.map((entry) => entry.id);
    expect(await prismaClient!.journalEntry.count({ where: { userId: member.id } })).toBe(0);
    expect(
      await prismaClient!.journalEntryItem.count({ where: { entryId: { in: entryIds } } }),
    ).toBe(0);
    expect(
      await prismaClient!.user.findUnique({
        where: { id: member.id },
        select: { adultConfirmedAt: true, entitlement: { select: { tier: true } } },
      }),
    ).toMatchObject({
      adultConfirmedAt: expect.any(Date),
      entitlement: { tier: DbEntitlementTier.PREMIUM },
    });
    expect((await journal.overview(other)).entries.map((entry) => entry.id)).toEqual([kept.id]);

    await expect(webhooks.handleClerkWebhook(deleted)).resolves.toBeUndefined();
  });

  it('deletes nothing for a deleted Clerk account this API never saw', async () => {
    const member = await createMember();
    const entry = await journal.create(member, entryFor(JournalOutcome.WORKED));

    await expect(
      new WebhooksService(prisma).handleClerkWebhook({
        type: 'user.deleted',
        data: { id: `user_unknown_${randomUUID()}` },
      }),
    ).resolves.toBeUndefined();

    expect((await journal.overview(member)).entries.map((row) => row.id)).toEqual([entry.id]);
  });
});
