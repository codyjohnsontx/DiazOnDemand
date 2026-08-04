import { describe, expect, it } from 'vitest';
import { VideoProvider } from './enums.js';
import {
  hasPlayableVideo,
  hasUnplayableVideoIdentifier,
  isValidMuxPlaybackId,
  isValidYouTubeVideoId,
} from './video-source.js';

describe('isValidMuxPlaybackId', () => {
  it('accepts identifiers shaped like the ones Mux issues', () => {
    for (const id of [
      'qxb01i6T202018GFS02vp9RIe01icTcDCjVzQpmaB00CUisJ4',
      'a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M',
      'DS00Spx1CV902MCtPj5WknGlR102V5HFkDe',
    ]) {
      expect(isValidMuxPlaybackId(id)).toBe(true);
    }
  });

  it('rejects every placeholder the seeded catalog used to publish', () => {
    // The originals, one per course. Each of these loaded the player and then
    // failed with "Video does not exist".
    for (const id of [
      'seedgrddef101',
      'seedgrdoff201',
      'seedgpsdef301',
      'seedgpsoff401',
      'seedscddef501',
      'seedscdoff601',
      'seedbcddef701',
      'seedbcdoff801',
    ]) {
      expect(isValidMuxPlaybackId(id)).toBe(false);
    }
  });

  it('rejects anything too short to be issued, however it is spelled', () => {
    // The rule is length and character set, not the word "seed" - the next
    // placeholder someone types will not carry that prefix.
    expect(isValidMuxPlaybackId('placeholder')).toBe(false);
    expect(isValidMuxPlaybackId('lesson-01')).toBe(false);
    expect(isValidMuxPlaybackId('TODO')).toBe(false);
    expect(isValidMuxPlaybackId('')).toBe(false);
  });

  it('rejects characters that would escape the stream URL they get pasted into', () => {
    expect(isValidMuxPlaybackId('abcdefghij0123456789/../secret')).toBe(false);
    expect(isValidMuxPlaybackId('abcdefghij0123456789?token=x')).toBe(false);
    expect(isValidMuxPlaybackId('abcdefghij0123456789.m3u8')).toBe(false);
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
