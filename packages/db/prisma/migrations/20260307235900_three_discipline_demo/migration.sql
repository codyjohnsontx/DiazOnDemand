-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('BJJ', 'MUAY_THAI', 'HAGANAH');

-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('MUX', 'YOUTUBE', 'NONE');

-- AlterTable
ALTER TABLE "Program"
ADD COLUMN "discipline" "Discipline" NOT NULL DEFAULT 'BJJ',
ADD COLUMN "isFeaturedDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Lesson"
ADD COLUMN "videoProvider" "VideoProvider" NOT NULL DEFAULT 'MUX',
ADD COLUMN "youtubeVideoId" TEXT;

-- Backfill
UPDATE "Lesson"
SET "videoProvider" = CASE
  WHEN "muxPlaybackId" IS NOT NULL THEN 'MUX'::"VideoProvider"
  ELSE 'NONE'::"VideoProvider"
END;
