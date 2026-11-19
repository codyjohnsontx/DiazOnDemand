-- The member journal: one row per session plus one row per tagged curriculum
-- item, and the one-time 18+ confirmation on the member.
--
-- Additive only: two new tables and a nullable column, nothing existing is
-- touched. Both tables cascade from User, as Progress and Favorite do, so
-- removing an account removes its journal.
-- CreateEnum
CREATE TYPE "JournalOutcome" AS ENUM ('WORKED', 'DID_NOT_WORK');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adultConfirmedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryItem" (
    "entryId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "outcome" "JournalOutcome" NOT NULL,

    CONSTRAINT "JournalEntryItem_pkey" PRIMARY KEY ("entryId","track")
);

-- CreateIndex
CREATE INDEX "JournalEntry_userId_sessionDate_idx" ON "JournalEntry"("userId", "sessionDate");

-- CreateIndex
CREATE INDEX "JournalEntry_discipline_sessionDate_idx" ON "JournalEntry"("discipline", "sessionDate");

-- CreateIndex
CREATE INDEX "JournalEntryItem_track_idx" ON "JournalEntryItem"("track");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryItem" ADD CONSTRAINT "JournalEntryItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

