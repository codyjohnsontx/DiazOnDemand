-- Direct-to-Mux upload from the admin lesson editor.
--
-- `muxUploadId` is the Mux direct upload a lesson is waiting on: the editor
-- requests one, the browser PUTs the file to it, and `video.upload.asset_created`
-- exchanges it for the asset id. It is cleared the moment the asset is bound,
-- so a lesson holding one is always "file not received yet" and nothing else.
--
-- `muxVideoError` is the last failure Mux reported for the lesson's video -
-- `video.upload.errored`, `video.upload.cancelled` or `video.asset.errored` -
-- and is cleared when a new upload starts or an asset becomes ready. Without
-- it a failed upload is indistinguishable from one still encoding, and the
-- operator's only recourse is the Mux dashboard, which is what the in-app
-- upload exists to remove.
--
-- Additive only: both columns are nullable, nothing existing is touched, and
-- `lesson_video_provider_consistency_chk` does not mention either column. The
-- video state is derived from these two plus the three identifiers already on
-- the row - see resolveLessonVideoState in @diaz/shared - rather than stored.
ALTER TABLE "Lesson"
ADD COLUMN "muxUploadId" TEXT,
ADD COLUMN "muxVideoError" TEXT;
