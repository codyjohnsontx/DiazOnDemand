import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { JournalEntryDto, JournalEntryWriteDto } from '@diaz/shared';
import { Prisma } from '@diaz/db';
import type { AuthUser } from '../common/request-with-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  journalEntryInclude,
  journalEntryOrder,
  mapJournalEntry,
} from './journal-entry-presentation.js';

const RECORD_NOT_FOUND = 'P2025';

function writableFields({ sessionDate, discipline, note }: JournalEntryWriteDto) {
  return { sessionDate: new Date(`${sessionDate}T00:00:00.000Z`), discipline, note };
}

/**
 * A member's own journal. Every query is scoped by the signed-in user's id, so
 * another member's entry id answers 404 exactly as an unknown one does.
 */
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser) {
    const row = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        adultConfirmedAt: true,
        journalEntries: { include: journalEntryInclude, orderBy: [...journalEntryOrder] },
      },
    });

    return {
      adultConfirmed: row.adultConfirmedAt !== null,
      entries: row.journalEntries.map(mapJournalEntry),
    };
  }

  /** One-time: a repeat keeps the original date. */
  async confirmAdult(userId: string) {
    await this.prisma.client.user.updateMany({
      where: { id: userId, adultConfirmedAt: null },
      data: { adultConfirmedAt: new Date() },
    });

    return { adultConfirmed: true };
  }

  async create(user: AuthUser, payload: JournalEntryWriteDto): Promise<JournalEntryDto> {
    await this.assertCanWrite(user);

    const entry = await this.prisma.client.journalEntry.create({
      data: {
        ...writableFields(payload),
        userId: user.id,
        items: { create: payload.items },
      },
      include: journalEntryInclude,
    });

    return mapJournalEntry(entry);
  }

  async update(
    user: AuthUser,
    entryId: string,
    payload: JournalEntryWriteDto,
  ): Promise<JournalEntryDto> {
    await this.assertCanWrite(user);

    try {
      const entry = await this.prisma.client.journalEntry.update({
        where: { id: entryId, userId: user.id },
        data: {
          ...writableFields(payload),
          items: { deleteMany: {}, create: payload.items },
        },
        include: journalEntryInclude,
      });

      return mapJournalEntry(entry);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw new NotFoundException('Journal entry not found');
      }

      throw error;
    }
  }

  /** Permanent, for staff too. */
  async remove(userId: string, entryId: string) {
    const { count } = await this.prisma.client.journalEntry.deleteMany({
      where: { id: entryId, userId },
    });

    if (count === 0) {
      throw new NotFoundException('Journal entry not found');
    }

    return { deleted: true };
  }

  /**
   * Open to every signed-in member, free or premium, once they have confirmed
   * they are 18+, unless they are banned.
   */
  private async assertCanWrite(user: AuthUser) {
    const row = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { adultConfirmedAt: true, bannedAt: true },
    });

    if (row.bannedAt !== null) {
      throw new ForbiddenException('Banned members cannot write to the journal');
    }

    if (row.adultConfirmedAt === null) {
      throw new ForbiddenException('18+ confirmation required');
    }
  }
}
