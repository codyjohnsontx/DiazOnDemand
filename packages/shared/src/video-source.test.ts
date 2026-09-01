import { describe, expect, it } from 'vitest';
import { VideoProvider } from './enums.js';
import {
  hasPlayableVideo,
  hasUnplayableVideoIdentifier,
  isAwaitingMuxPlayback,
  isValidMuxPlaybackId,
  isValidYouTubeVideoId,
} from './video-source.js';

describe('isValidMuxPlaybackId', () => {
  // The regression that forced this rule to be inverted. `a1B2c3D4e5F6g7H8i9`
  // is the value in Mux's own API reference response example for a playback id,
  // and it is 18 characters. The rule previously required 20 or more, so it
  // routed a genuine Mux id to NONE and told the member the lesson had not been
  // filmed. Mux documents `PlaybackID.id` as a string and gives no minimum
  // length, so this test is the contract: do not reintroduce a length floor.
  it("accepts the 18-character id from Mux's documented response example", () => {
    expect(isValidMuxPlaybackId('a1B2c3D4e5F6g7H8i9')).toBe(true);
  });

  it('accepts the longer identifiers Mux also issues', () => {
    for (const id of [
      'qxb01i6T202018GFS02vp9RIe01icTcDCjVzQpmaB00CUisJ4',
      'a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M',
      'DS00Spx1CV902MCtPj5WknGlR102V5HFkDe',
    ]) {
      expect(isValidMuxPlaybackId(id)).toBe(true);
    }
  });

  it('rejects every one of the 16 placeholders this repository seeded', () => {
    // The complete known-bad set, not a sample: these are exactly the values
    // that stood in the seed before they were cleared, and each one loaded the
    // player and then failed with "Video does not exist".
    for (const id of [
      'seedgrddef101',
      'seedgrddef102',
      'seedgrdoff201',
      'seedgrdoff202',
      'seedgpsdef301',
      'seedgpsdef302',
      'seedgpsoff401',
      'seedgpsoff402',
      'seedscddef501',
      'seedscddef502',
      'seedscdoff601',
      'seedscdoff602',
      'seedbcddef701',
      'seedbcddef702',
      'seedbcdoff801',
      'seedbcdoff802',
    ]) {
      expect(isValidMuxPlaybackId(id)).toBe(false);
    }
  });

  it('rejects characters that would escape the stream URL they get pasted into', () => {
    expect(isValidMuxPlaybackId('abcdefghij0123456789/../secret')).toBe(false);
    expect(isValidMuxPlaybackId('abcdefghij0123456789?token=x')).toBe(false);
    expect(isValidMuxPlaybackId('abcdefghij0123456789#frag')).toBe(false);
    expect(isValidMuxPlaybackId('abcdefghij0123456789.m3u8')).toBe(false);
    expect(isValidMuxPlaybackId(' a1B2c3D4e5F6g7H8i9 ')).toBe(false);
    expect(isValidMuxPlaybackId('')).toBe(false);
  });

  // The honest boundary, asserted so nobody mistakes this rule for an
  // existence check. A short, URL-safe, made-up value is indistinguishable from
  // a real Mux id by shape alone, so it is accepted here and will fail in the
  // player instead. Catching those needs provider validation at a write
  // boundary, which this repository deliberately does not do.
  it('cannot tell a made-up URL-safe id from a real one, and does not pretend to', () => {
    expect(isValidMuxPlaybackId('TODO')).toBe(true);
    expect(isValidMuxPlaybackId('lesson-01')).toBe(true);
  });

  it('treats a missing identifier as invalid rather than throwing', () => {
    expect(isValidMuxPlaybackId(null)).toBe(false);
    expect(isValidMuxPlaybackId(undefined)).toBe(false);
  });
});

describe('isValidYouTubeVideoId', () => {
  it('accepts the fixed 11-character YouTube format', () => {
    for (const id of ['M7lc1UVf-VE', 'aqz-KE-bpKQ', 'ysz5S6PUM-U', '_-aBcDeF012']) {
      expect(isValidYouTubeVideoId(id)).toBe(true);
    }
  });

  it('rejects anything that is not exactly 11 valid characters', () => {
    expect(isValidYouTubeVideoId('M7lc1UVf-V')).toBe(false);
    expect(isValidYouTubeVideoId('M7lc1UVf-VEE')).toBe(false);
    expect(isValidYouTubeVideoId('M7lc1UVf VE')).toBe(false);
    expect(isValidYouTubeVideoId('https://youtu.be/M7lc1UVf-VE')).toBe(false);
    expect(isValidYouTubeVideoId(null)).toBe(false);
  });
});

describe('hasPlayableVideo', () => {
  it('trusts the provider the API resolved', () => {
    expect(hasPlayableVideo({ videoProvider: VideoProvider.MUX })).toBe(true);
    expect(hasPlayableVideo({ videoProvider: VideoProvider.YOUTUBE })).toBe(true);
  });

  it('is false for a lesson the read path resolved to no playable video', () => {
    expect(hasPlayableVideo({ videoProvider: VideoProvider.NONE })).toBe(false);
    expect(hasPlayableVideo({ videoProvider: null })).toBe(false);
    expect(hasPlayableVideo({})).toBe(false);
  });
});

describe('hasUnplayableVideoIdentifier', () => {
  it('flags a stored identifier the read path will refuse', () => {
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.MUX,
        muxPlaybackId: 'seedgrddef101',
      }),
    ).toBe(true);
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.YOUTUBE,
        youtubeVideoId: 'M7lc1UVf-V',
      }),
    ).toBe(true);
  });

  it('flags surrounding whitespace, which the read path does not strip either', () => {
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.MUX,
        muxPlaybackId: ' DS00Spx1CV902MCtPj5WknGlR102V5HFkDe ',
      }),
    ).toBe(true);
  });

  it('stays quiet for an identifier the provider could have issued', () => {
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.MUX,
        muxPlaybackId: 'DS00Spx1CV902MCtPj5WknGlR102V5HFkDe',
      }),
    ).toBe(false);
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.YOUTUBE,
        youtubeVideoId: 'M7lc1UVf-VE',
      }),
    ).toBe(false);
  });

  it('stays quiet for an empty field, which is a lesson nobody has configured yet', () => {
    expect(hasUnplayableVideoIdentifier({ videoProvider: VideoProvider.MUX })).toBe(false);
    expect(
      hasUnplayableVideoIdentifier({ videoProvider: VideoProvider.MUX, muxPlaybackId: '   ' }),
    ).toBe(false);
    expect(
      hasUnplayableVideoIdentifier({ videoProvider: VideoProvider.YOUTUBE, youtubeVideoId: null }),
    ).toBe(false);
  });

  it('only judges the identifier the stored provider actually uses', () => {
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.YOUTUBE,
        muxPlaybackId: 'seedgrddef101',
        youtubeVideoId: 'M7lc1UVf-VE',
      }),
    ).toBe(false);
    expect(
      hasUnplayableVideoIdentifier({
        videoProvider: VideoProvider.NONE,
        muxPlaybackId: 'seedgrddef101',
      }),
    ).toBe(false);
  });
});

describe('isAwaitingMuxPlayback', () => {
  const ASSET_ID = 'PS02Wt6ZFsample00Asset00Id00000001';

  it('is true for a mux lesson holding the asset id and no playback id', () => {
    expect(
      isAwaitingMuxPlayback({
        videoProvider: VideoProvider.MUX,
        muxAssetId: ASSET_ID,
        muxPlaybackId: null,
      }),
    ).toBe(true);
  });

  // A lesson nobody has pointed at an asset is not waiting for anything - it is
  // a lesson that has not been filmed, and telling staff to check Mux for it
  // would send them looking for an upload that never happened.
  it('is false for a mux lesson with no asset id at all', () => {
    expect(isAwaitingMuxPlayback({ videoProvider: VideoProvider.MUX })).toBe(false);
    expect(
      isAwaitingMuxPlayback({ videoProvider: VideoProvider.MUX, muxAssetId: '   ' }),
    ).toBe(false);
  });

  // The webhook has already completed this one. Re-delivery must not put it
  // back into a waiting state, and neither should a second look at the row.
  it('is false once the playback id has arrived', () => {
    expect(
      isAwaitingMuxPlayback({
        videoProvider: VideoProvider.MUX,
        muxAssetId: ASSET_ID,
        muxPlaybackId: 'DS00Spx1CV902MCtPj5WknGlR102V5HFkDe',
      }),
    ).toBe(false);
  });

  // Distinct from broken: a stored playback id the read path refuses is a
  // mistake somebody has to correct, not an asset anybody is waiting on.
  // `hasUnplayableVideoIdentifier` owns that one.
  it('is false for a lesson whose stored playback id will not play', () => {
    const lesson = {
      videoProvider: VideoProvider.MUX,
      muxAssetId: ASSET_ID,
      muxPlaybackId: 'seedgrddef101',
    };

    expect(isAwaitingMuxPlayback(lesson)).toBe(false);
    expect(hasUnplayableVideoIdentifier(lesson)).toBe(true);
  });

  it('says nothing about lessons served by another provider', () => {
    expect(
      isAwaitingMuxPlayback({
        videoProvider: VideoProvider.YOUTUBE,
        muxAssetId: ASSET_ID,
        youtubeVideoId: 'M7lc1UVf-VE',
      } as Parameters<typeof isAwaitingMuxPlayback>[0]),
    ).toBe(false);
    expect(
      isAwaitingMuxPlayback({ videoProvider: VideoProvider.NONE, muxAssetId: ASSET_ID }),
    ).toBe(false);
  });
});
