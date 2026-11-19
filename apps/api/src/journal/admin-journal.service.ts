import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { Prisma } from '@diaz/db';
import {
  JOURNAL_TRENDS_MIN_MEMBERS,
  type JournalMemberDetailDto,
  type JournalMemberSummaryDto,
  type JournalTrendItemDto,
  type JournalTrendsQueryDto,
} from '@diaz/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  formatSessionDate,
  journalEntryInclude,
  journalEntryOrder,
  mapJournalEntry,
} from './journal-entry-presentation.js';

const CLERK_LOOKUP_BATCH = 100;

/** Read-only by design: staff take no action on an entry, and a member's delete reaches here. */
@Injectable()
export class AdminJournalService {
  private readonly logger = new Logger(AdminJournalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counted in SQL because the threshold is on distinct members in the selected
   * range, not on marks: one member logging an item ten times is still one member.
   */
  async trends({ discipline, from, to }: JournalTrendsQueryDto) {
    const filters = [
      discipline ? Prisma.sql`e."discipline" = ${discipline}::"Discipline"` : null,
      from ? Prisma.sql`e."sessionDate" >= ${from}::date` : null,
      to ? Prisma.sql`e."sessionDate" <= ${to}::date` : null,
    ].filter((filter) => filter !== null);
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;

    const items = await this.prisma.client.$queryRaw<JournalTrendItemDto[]>`
      SELECT
        e."discipline" AS "discipline",
        i."track" AS "track",
        COUNT(*) FILTER (WHERE i."outcome" = 'WORKED')::int AS "workedCount",
        COUNT(*) FILTER (WHERE i."outcome" = 'DID_NOT_WORK')::int AS "didNotWorkCount",
        COUNT(DISTINCT e."userId")::int AS "memberCount"
      FROM "JournalEntryItem" i
      JOIN "JournalEntry" e ON e."id" = i."entryId"
      ${where}
      GROUP BY e."discipline", i."track"
      HAVING COUNT(DISTINCT e."userId") >= ${JOURNAL_TRENDS_MIN_MEMBERS}
      ORDER BY "didNotWorkCount" DESC, "workedCount" ASC, i."track" ASC
    `;

    return { minMembers: JOURNAL_TRENDS_MIN_MEMBERS, items };
  }

  /** Members with at least one entry, most recently journalled first. */
  async listMembers(): Promise<JournalMemberSummaryDto[]> {
    const members = await this.prisma.client.user.findMany({
      where: { journalEntries: { some: {} } },
      select: {
        id: true,
        clerkUserId: true,
        _count: { select: { journalEntries: true } },
        journalEntries: {
          orderBy: { sessionDate: 'desc' },
          take: 1,
          select: { sessionDate: true },
        },
      },
    });
    const labels = await this.lookUpLabels(members.map((member) => member.clerkUserId));

    return members
      .map((member) => ({
        id: member.id,
        label: labels.get(member.clerkUserId) ?? member.clerkUserId,
        entryCount: member._count.journalEntries,
        lastSessionDate: formatSessionDate(member.journalEntries[0]!.sessionDate),
      }))
      .sort((a, b) => b.lastSessionDate.localeCompare(a.lastSessionDate));
  }

  /** Every entry and note. The Trends threshold does not apply here. */
  async getMember(id: string): Promise<JournalMemberDetailDto> {
    const member = await this.prisma.client.user.findUnique({
      where: { id },
      select: {
        id: true,
        clerkUserId: true,
        journalEntries: { include: journalEntryInclude, orderBy: [...journalEntryOrder] },
      },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const labels = await this.lookUpLabels([member.clerkUserId]);

    return {
      id: member.id,
      label: labels.get(member.clerkUserId) ?? member.clerkUserId,
      entries: member.journalEntries.map(mapJournalEntry),
    };
  }

  /**
   * The database holds only a Clerk id for a member, so a coach could not tell
   * members apart without this. A failed lookup costs the names, never the page:
   * the caller falls back to the Clerk id.
   */
  private async lookUpLabels(clerkUserIds: string[]) {
    const labels = new Map<string, string>();
    const secretKey = process.env.CLERK_SECRET_KEY;

    if (!secretKey) {
      return labels;
    }

    try {
      const clerk = createClerkClient({ secretKey });

      for (let start = 0; start < clerkUserIds.length; start += CLERK_LOOKUP_BATCH) {
        const userId = clerkUserIds.slice(start, start + CLERK_LOOKUP_BATCH);
        const { data } = await clerk.users.getUserList({ userId, limit: userId.length });

        for (const user of data) {
          const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
          const label = name || user.primaryEmailAddress?.emailAddress;

          if (label) {
            labels.set(user.id, label);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Clerk member lookup failed: ${String(error)}`);
    }

    return labels;
  }
}
