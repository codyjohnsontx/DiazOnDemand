import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const MUX_API_BASE_URL = 'https://api.mux.com';

/** How long the signed upload URL stays usable; Mux's own default. */
const DIRECT_UPLOAD_TIMEOUT_SECONDS = 3600;

/** The subset of Mux's Direct Upload object this API reads back. */
export type MuxDirectUpload = {
  id: string;
  url: string;
  timeout: number;
};

/**
 * What the asset behind an upload is allowed to be, decided by the lesson's
 * tier and nothing else. `syncMuxAsset` enforces the same rule when the asset
 * is ready - a PAID lesson is refused an asset carrying any public playback id,
 * a FREE one is refused an asset carrying none - so an upload created here is
 * the only kind that handler will accept. Deciding it at both ends is the
 * point: the policy is chosen before the file exists, and checked after.
 */
export function playbackPolicyForAccessLevel(accessLevel: string): 'public' | 'signed' {
  return accessLevel === 'PAID' ? 'signed' : 'public';
}

/**
 * Creates Mux direct uploads with the API access token, so the browser only
 * ever holds the one-off signed upload URL.
 *
 * Written against Mux's REST API with `fetch` rather than `@mux/mux-node`: one
 * endpoint is called, the request is a small JSON body under Basic auth, and a
 * dependency that pulls in the whole Video, Data and Webhooks surface buys
 * nothing here. The webhook side already parses Mux payloads by hand for the
 * same reason.
 */
@Injectable()
export class MuxDirectUploadService {
  private readonly logger = new Logger(MuxDirectUploadService.name);

  /**
   * The MUX_TOKEN_ID / MUX_TOKEN_SECRET pair, read per call rather than at
   * construction so a process started without them still boots - the env
   * schema only requires the two together, never that they exist - and answers
   * this route alone with a named 503.
   */
  private credentials() {
    const tokenId = process.env.MUX_TOKEN_ID;
    const tokenSecret = process.env.MUX_TOKEN_SECRET;

    if (!tokenId || !tokenSecret) {
      throw new ServiceUnavailableException(
        'Video upload is not configured on this server: MUX_TOKEN_ID and MUX_TOKEN_SECRET are ' +
          'required to create a Mux direct upload.',
      );
    }

    return `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`, 'utf8').toString('base64')}`;
  }

  /**
   * Asks Mux for a direct upload whose asset will be bound to `lessonId`.
   *
   * `passthrough` carries the lesson id onto the asset Mux creates, so every
   * later `video.asset.*` event names the lesson it belongs to even if the
   * upload id were lost. `cors_origin` is the web app's origin, because the
   * signed URL is used from the browser and Google Cloud Storage answers the
   * preflight from it. `video_quality` is deliberately not set: that is an
   * account-level choice with billing consequences, and the account default
   * applies.
   */
  async createDirectUpload(input: {
    lessonId: string;
    accessLevel: string;
    corsOrigin: string;
  }): Promise<MuxDirectUpload> {
    const authorization = this.credentials();
    const body = {
      cors_origin: input.corsOrigin,
      timeout: DIRECT_UPLOAD_TIMEOUT_SECONDS,
      new_asset_settings: {
        playback_policies: [playbackPolicyForAccessLevel(input.accessLevel)],
        passthrough: input.lessonId,
      },
    };

    let response: Response;

    try {
      response = await fetch(`${MUX_API_BASE_URL}/video/v1/uploads`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      this.logger.error(`Mux direct upload request failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Mux could not be reached to create the upload.');
    }

    if (!response.ok) {
      // The status is the whole diagnosis - 401 is the token, 422 is the
      // request - so it goes to the operator verbatim; the body may quote the
      // request and is logged rather than answered.
      const detail = await response.text().catch(() => '');
      this.logger.error(`Mux refused to create a direct upload: HTTP ${response.status} ${detail}`);
      throw new ServiceUnavailableException(
        `Mux refused to create the upload (HTTP ${response.status}). Check the Mux access token ` +
          'and try again.',
      );
    }

    const payload = (await response.json()) as { data?: Partial<MuxDirectUpload> };
    const upload = payload.data;

    if (!upload?.id || !upload.url) {
      this.logger.error('Mux answered a direct upload without an id or url');
      throw new ServiceUnavailableException('Mux answered without an upload URL.');
    }

    return { id: upload.id, url: upload.url, timeout: upload.timeout ?? DIRECT_UPLOAD_TIMEOUT_SECONDS };
  }
}
