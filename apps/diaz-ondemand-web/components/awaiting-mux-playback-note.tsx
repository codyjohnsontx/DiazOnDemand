import { AccessLevel } from '@diaz/shared';

/**
 * What to tell staff about a lesson holding a Mux asset that no playback ID has
 * arrived for.
 *
 * Encoding may still be running, the event may have been delivered before this
 * lesson held the asset ID, the upload may have failed, or the webhook may never
 * have been configured - so the opening says what is true of all four and the
 * rest says what to do about the ones an admin can fix.
 *
 * The remedy differs by access level, and naming only the free one is how this
 * sends a premium operator at a step that cannot work: `syncMuxAsset` refuses an
 * asset carrying a public playback ID on a PAID lesson, which is exactly the
 * asset a FREE -> PAID clear leaves behind, so redelivering `video.asset.ready`
 * for it fails every time. Redelivery is still right once the asset is
 * signed-only, and the row cannot say which of the two this is, so the premium
 * text names both and the condition that separates them.
 *
 * It lives here because both admin surfaces show it and the two must not drift:
 * an operator who follows the course row and an operator who follows the lesson
 * editor have to be told the same thing.
 */
export function AwaitingMuxPlaybackNote({
  accessLevel,
  className,
}: {
  accessLevel: AccessLevel;
  className: string;
}) {
  return (
    <p className={className}>
      No playback ID yet. Mux sends it with the video.asset.ready event, and only a lesson that
      already holds the asset ID receives it.{' '}
      {accessLevel === AccessLevel.PAID
        ? 'A premium lesson needs a signed-only asset, and an asset carrying a public playback ' +
          'ID is refused. If it is already signed-only and Ready in Mux, redeliver that event ' +
          'from the Mux dashboard. If this is still the asset the lesson had while it was free, ' +
          're-create it in Mux with a signed-only playback policy and save the new asset ID.'
        : 'If the asset is already Ready in Mux, redeliver that event from the Mux dashboard.'}
    </p>
  );
}
