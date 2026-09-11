import {
  AccessLevel,
  LessonVideoState,
  resolveLessonVideoState,
  type AdminLessonSummary,
} from '@diaz/shared';
import { AwaitingMuxPlaybackNote } from '@/components/awaiting-mux-playback-note';
import { PremiumBadge } from '@/components/premium-badge';

/**
 * The one video state a lesson is in, as both admin surfaces show it.
 *
 * `resolveLessonVideoState` in `@diaz/shared` decides the state from the row;
 * this file only decides the words, and it is the only file that does, so the
 * course lesson rows and the lesson editor cannot describe the same row two
 * ways. The operator is meant to learn what happened to an upload from here and
 * never from the Mux dashboard, which is why FAILED carries Mux's own message
 * and the replacement case says outright that the previous video still plays.
 */
const STATE_BADGES: Record<LessonVideoState, { label: string; tone: 'neutral' | 'premium' | 'accent' }> = {
  [LessonVideoState.NONE]: { label: 'No video', tone: 'neutral' },
  [LessonVideoState.UPLOADING]: { label: 'Upload in progress', tone: 'neutral' },
  [LessonVideoState.PROCESSING]: { label: 'Waiting for Mux', tone: 'neutral' },
  [LessonVideoState.READY]: { label: 'Video ready', tone: 'accent' },
  [LessonVideoState.FAILED]: { label: 'Upload failed', tone: 'premium' },
};

type VideoStateLesson = Pick<
  AdminLessonSummary,
  'accessLevel' | 'muxUploadId' | 'muxVideoError' | 'muxAssetId' | 'muxPlaybackId' | 'youtubeVideoId'
>;

export function LessonVideoStateBadge({ lesson }: { lesson: VideoStateLesson }) {
  const badge = STATE_BADGES[resolveLessonVideoState(lesson).state];

  return <PremiumBadge label={badge.label} tone={badge.tone} />;
}

/**
 * What to tell staff about the state, or nothing for the two states that need
 * no explanation. PROCESSING defers to `AwaitingMuxPlaybackNote`, which already
 * names the remedy for an asset that never completes.
 */
export function LessonVideoStateNote({
  lesson,
  className,
}: {
  lesson: VideoStateLesson;
  className: string;
}) {
  const { state, previousVideoStillPlays } = resolveLessonVideoState(lesson);
  const previous = previousVideoStillPlays
    ? ' The video this lesson already had is unchanged and still plays for members.'
    : '';

  if (state === LessonVideoState.FAILED) {
    return (
      <p className={[className, 'text-[var(--danger)]'].join(' ')}>
        {lesson.muxVideoError}
        {previous} Choose the file again to retry; a new upload clears this message.
      </p>
    );
  }

  if (state === LessonVideoState.UPLOADING) {
    return (
      <p className={className}>
        Mux is waiting for the file. If the upload was interrupted or the page was closed before
        it finished, choose the file again - the earlier upload link expires on its own.
        {previous}
      </p>
    );
  }

  if (state === LessonVideoState.PROCESSING) {
    return (
      <AwaitingMuxPlaybackNote
        accessLevel={lesson.accessLevel as AccessLevel}
        className={className}
      />
    );
  }

  return null;
}
