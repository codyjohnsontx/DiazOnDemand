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

-- Enforce provider-specific playback identifiers
ALTER TABLE "Lesson"
ADD CONSTRAINT "lesson_video_provider_consistency_chk"
CHECK (
  (
    "videoProvider" = 'MUX'::"VideoProvider"
    AND NULLIF("muxPlaybackId", '') IS NOT NULL
    AND NULLIF("youtubeVideoId", '') IS NULL
  )
  OR (
    "videoProvider" = 'YOUTUBE'::"VideoProvider"
    AND NULLIF("youtubeVideoId", '') IS NOT NULL
    AND NULLIF("muxPlaybackId", '') IS NULL
  )
  OR (
    "videoProvider" = 'NONE'::"VideoProvider"
    AND NULLIF("muxPlaybackId", '') IS NULL
    AND NULLIF("youtubeVideoId", '') IS NULL
  )
);
