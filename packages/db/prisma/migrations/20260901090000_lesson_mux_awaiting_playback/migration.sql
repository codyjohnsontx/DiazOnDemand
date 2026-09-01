-- A Mux lesson whose asset is still encoding holds the asset id and no playback
-- id yet: Mux issues the playback id later, on `video.asset.ready`. The previous
-- constraint required a MUX row to already hold a playback id, so that state
-- could not be stored - and a lesson that cannot be saved holding the asset id
-- is a lesson the webhook can never find, which is why every delivery logged
-- "No lesson matches Mux asset <id>; skipping sync".
--
-- Widening only. Every row the previous constraint accepted is still accepted,
-- so this needs no backfill and cannot fail on existing data. What stays
-- rejected is a MUX row holding neither identifier, which is a lesson pointing
-- at nothing rather than a lesson waiting for something.
ALTER TABLE "Lesson"
DROP CONSTRAINT "lesson_video_provider_consistency_chk";

ALTER TABLE "Lesson"
ADD CONSTRAINT "lesson_video_provider_consistency_chk"
CHECK (
  (
    "videoProvider" = 'MUX'::"VideoProvider"
    AND (
      NULLIF(TRIM("muxPlaybackId"), '') IS NOT NULL
      OR NULLIF(TRIM("muxAssetId"), '') IS NOT NULL
    )
    AND NULLIF(TRIM("youtubeVideoId"), '') IS NULL
  )
  OR (
    "videoProvider" = 'YOUTUBE'::"VideoProvider"
    AND NULLIF(TRIM("youtubeVideoId"), '') IS NOT NULL
    AND NULLIF(TRIM("muxPlaybackId"), '') IS NULL
  )
  OR (
    "videoProvider" = 'NONE'::"VideoProvider"
    AND NULLIF(TRIM("muxPlaybackId"), '') IS NULL
    AND NULLIF(TRIM("youtubeVideoId"), '') IS NULL
  )
);
