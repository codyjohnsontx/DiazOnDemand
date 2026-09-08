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
 * The remedy differs by access level, because `syncMuxAsset` refuses an asset
 * carrying a public playback ID on a PAID lesson and refuses one carrying no
 * public ID on a FREE lesson, so redelivering `video.asset.ready` for the wrong
 * kind of asset fails every time. Both branches therefore have the same shape:
 * state the rule, name redelivery for the case it works in, then end with the
 * remedy that always applies. The row cannot say which playback policy the asset
 * carries, in either direction, and a conditional remedy can only fail an
 * operator it does not happen to describe - a lesson set PAID with a public asset
 * from the start was never free with it, and a lesson flipped PAID -> FREE keeps
 * the signed-only asset it already had.
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
          'from the Mux dashboard. Otherwise re-create it in Mux with a signed-only playback ' +
          'policy and save the new asset ID.'
        : 'A free lesson is served over a plain, unsigned stream.mux.com url, so it needs an ' +
          'asset carrying a public playback ID, and an asset without one is refused. If it is ' +
          'already Ready in Mux with a public playback ID, redeliver that event from the Mux ' +
          'dashboard. Otherwise give the asset a public playback policy in Mux.'}
    </p>
  );
}
