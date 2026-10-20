import { describe, expect, it, vi } from "vitest";

import type { MediaPlayback } from "@/src/modules/media/domain/media";

import { resolveWordAudioFrom, type ExampleAddress } from "@/src/modules/lexicon-corpus/application/resolve-word-audio";

/**
 * The rules that decide whether a vocabulary word can be heard as real speech.
 *
 * These are worth testing without a database because every wrong answer here is
 * silent from the outside: a clip that plays the neighbouring sentence, or audio
 * from a version that no longer matches the displayed text, still *sounds* fine.
 */

type PlaybackSegment = MediaPlayback["segments"][number];

const segment: PlaybackSegment = {
  id: "segment-1",
  index: 4,
  startMs: 10_000,
  endMs: 12_000,
  sourceText: "La casa es grande.",
  translation: null,
  speaker: null,
  words: [
    { text: "La", startMs: 10_000, endMs: 10_200, startOffset: 0, endOffset: 2 },
    { text: "casa", startMs: 10_300, endMs: 10_800, startOffset: 3, endOffset: 7 },
    { text: "es", startMs: 10_900, endMs: 11_100, startOffset: 8, endOffset: 10 },
    { text: "grande", startMs: 11_200, endMs: 11_900, startOffset: 11, endOffset: 17 },
  ],
};

function playback(overrides: Partial<MediaPlayback["media"]> = {}, segmentOverrides: Partial<PlaybackSegment> = {}): MediaPlayback {
  return {
    media: {
      id: "media-1",
      stableKey: "youtube.test",
      version: 1,
      kind: "video",
      title: "Podcast publicado",
      summary: "",
      sourceName: "Test",
      language: "es",
      region: null,
      cefr: null,
      topics: [],
      durationMs: 60_000,
      publishedAt: null,
      curatedAt: "2026-10-11T00:00:00.000Z",
      contentHash: "hash",
      progress: null,
      ...overrides,
    },
    asset: { kind: "audio", url: "https://cdn.test/audio.mp3", expiresAt: "2026-10-12T00:00:00.000Z" },
    segments: [{ ...segment, ...segmentOverrides }],
  };
}

function address(overrides: Partial<ExampleAddress> = {}): ExampleAddress {
  return {
    word: "casa",
    exampleText: "La casa es grande.",
    documentKind: "media",
    documentStableKey: "youtube.test",
    documentVersion: 1,
    segmentIndex: 4,
    ...overrides,
  };
}

/**
 * The narrow read's answer for the same media: the playable asset plus the candidate rows
 * for one segment. The word route uses this instead of the whole playback, so the two entry
 * points must resolve a word identically — a clip that depended on which read produced it
 * would be a bug no status-code test could see.
 */
function lookup(candidates: readonly PlaybackSegment[] = [segment]) {
  return {
    stableKey: "youtube.test",
    title: "Podcast publicado",
    version: 1,
    asset: { kind: "audio", url: "https://cdn.test/audio.mp3", expiresAt: new Date("2026-10-12T00:00:00.000Z") },
    candidates,
  };
}

describe("resolveWordAudioFrom through the narrow segment read", () => {
  it("resolves the same clip as the whole-playback read", async () => {
    const wide = await resolveWordAudioFrom({ address: address(), word: "casa", loadPlayback: async () => playback() });
    const narrow = await resolveWordAudioFrom({ address: address(), word: "casa", loadLookup: async () => lookup() });

    expect(narrow).toEqual(wide);
    expect(narrow.outcome).toBe("clip");
    if (narrow.outcome !== "clip") return;
    // The sentence the panel shows must come along on this path too.
    expect(narrow.clip.segmentText).toBe("La casa es grande.");
    expect(narrow.clip.expiresAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("refuses an ambiguous match, exactly as the wide read does", async () => {
    // Two segments with the same text but different indexes: the stored index matches
    // neither, so the text fallback has to choose, and choosing between two recordings of
    // the same sentence would be a coin flip.
    const narrow = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadLookup: async () => lookup([{ ...segment, index: 9 }, { ...segment, id: "segment-2", index: 11 }]),
    });
    expect(narrow).toEqual({ outcome: "synthetic", reason: "segment_missing" });
  });

  it("treats an unavailable media read as synthesis rather than an error", async () => {
    const narrow = await resolveWordAudioFrom({ address: address(), word: "casa", loadLookup: async () => null });
    expect(narrow).toEqual({ outcome: "synthetic", reason: "media_unavailable" });
  });

  it("still refuses a different media item, whatever the read", async () => {
    const narrow = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadLookup: async () => ({ ...lookup(), stableKey: "youtube.other" }),
    });
    expect(narrow).toEqual({ outcome: "synthetic", reason: "stale_reference" });
  });

  it("does not read any media when the address is already ruled out", async () => {
    const loadLookup = vi.fn(async () => lookup());
    const resolution = await resolveWordAudioFrom({ address: null, word: "casa", loadLookup });
    expect(resolution).toEqual({ outcome: "synthetic", reason: "no_example" });
    expect(loadLookup).not.toHaveBeenCalled();
  });
});

describe("resolveWordAudioFrom", () => {
  it("plays the word's own window inside the addressed segment", async () => {
    const result = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadPlayback: async () => playback(),
    });

    expect(result.outcome).toBe("clip");
    if (result.outcome !== "clip") return;
    expect(result.clip.url).toBe("https://cdn.test/audio.mp3");
    expect(result.clip.startMs).toBe(10_180);
    expect(result.clip.stopAtMs).toBe(11_050);
    expect(result.clip.segmentStartMs).toBe(10_000);
    expect(result.clip.segmentEndMs).toBe(12_000);
    expect(result.clip.segmentIndex).toBe(4);
    expect(result.clip.stableKey).toBe("youtube.test");
    expect(result.clip.sourceTitle).toBe("Podcast publicado");
    // The sentence the clip says travels with it. The panel shows this text while the
    // recording plays, so it must be the *resolved segment's* own text — the same
    // string the audio came from, not the address field looked up a second time.
    expect(result.clip.segmentText).toBe("La casa es grande.");
  });

  it("synthesizes when the word has no example at all", async () => {
    const loadPlayback = vi.fn(async () => playback());
    const result = await resolveWordAudioFrom({ address: null, word: "casa", loadPlayback });

    expect(result).toEqual({ outcome: "synthetic", reason: "no_example" });
    // The expensive read must not happen when the answer is already known.
    expect(loadPlayback).not.toHaveBeenCalled();
  });

  it("synthesizes for an article example, which has no audio", async () => {
    const loadPlayback = vi.fn(async () => playback());
    const result = await resolveWordAudioFrom({
      address: address({ documentKind: "article", documentStableKey: null, documentVersion: null, segmentIndex: null }),
      word: "casa",
      loadPlayback,
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "article_example" });
    expect(loadPlayback).not.toHaveBeenCalled();
  });

  it("synthesizes when a media address is missing part of itself", async () => {
    const loadPlayback = vi.fn(async () => playback());
    const result = await resolveWordAudioFrom({
      address: address({ segmentIndex: null }),
      word: "casa",
      loadPlayback,
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "incomplete_address" });
    expect(loadPlayback).not.toHaveBeenCalled();
  });

  it("synthesizes when the media is no longer available", async () => {
    const result = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadPlayback: async () => null,
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "media_unavailable" });
  });

  it("finds the sentence again when the media was re-published with new numbering", async () => {
    // The observed real case: an item went from v2 with 146+ segments to v3 with
    // 99, so a stored index stops resolving. The sentence is still there under a
    // different index, and that is what must be played — refusing every
    // re-published item would silence every word in it.
    const result = await resolveWordAudioFrom({
      address: address({ documentVersion: 2, segmentIndex: 146 }),
      word: "casa",
      loadPlayback: async () => playback({ version: 3 }, { index: 12 }),
    });

    expect(result.outcome).toBe("clip");
    if (result.outcome !== "clip") return;
    expect(result.clip.segmentIndex).toBe(12);
    expect(result.clip.startMs).toBe(10_180);
    expect(result.clip.stopAtMs).toBe(11_050);
  });

  it("refuses the audio when the same sentence now exists twice", async () => {
    // Two segments with identical text can be two recordings; picking one would
    // be a coin flip.
    const result = await resolveWordAudioFrom({
      address: address({ documentVersion: 2, segmentIndex: 146 }),
      word: "casa",
      loadPlayback: async () => ({
        ...playback({ version: 3 }, { index: 12 }),
        segments: [
          { ...playback().segments[0]!, index: 12 },
          { ...playback().segments[0]!, index: 40 },
        ],
      }),
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "segment_missing" });
  });

  it("refuses audio from a different media item", async () => {
    const result = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadPlayback: async () => playback({ stableKey: "youtube.other" }),
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "stale_reference" });
  });

  it("finds the sentence at its new index when the stored one moved", async () => {
    // The stored index is a hint, not an identity: what must match is the
    // sentence. A segment that is still in the version under another index is
    // the same audio, so it plays.
    const result = await resolveWordAudioFrom({
      address: address({ segmentIndex: 9 }),
      word: "casa",
      loadPlayback: async () => playback({}, { index: 12 }),
    });

    expect(result.outcome).toBe("clip");
    if (result.outcome !== "clip") return;
    expect(result.clip.segmentIndex).toBe(12);
  });

  it("refuses audio when the sentence is no longer in the served version", async () => {
    const result = await resolveWordAudioFrom({
      address: address({ segmentIndex: 9 }),
      word: "casa",
      loadPlayback: async () => playback({}, { sourceText: "Otra frase distinta.", index: 12 }),
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "segment_missing" });
  });

  it("refuses audio when the index points at a different sentence and the example is gone", async () => {
    // A re-published version can renumber segments; then the stored index points
    // at a different sentence, and if the displayed one is not in the version
    // either, playing the indexed one would teach the wrong context.
    const result = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadPlayback: async () => playback({}, { sourceText: "Otra frase distinta." }),
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "segment_missing" });
  });

  it("synthesizes when the word is not in the segment as a whole token", async () => {
    const result = await resolveWordAudioFrom({
      address: address({ word: "sol" }),
      word: "sol",
      loadPlayback: async () => playback(),
    });

    expect(result).toEqual({ outcome: "synthetic", reason: "word_not_in_segment" });
  });

  it("forwards clip options so the caller keeps control of the padding", async () => {
    const result = await resolveWordAudioFrom({
      address: address(),
      word: "casa",
      loadPlayback: async () => playback(),
      clipOptions: { preRollMs: 0, postRollMs: 0 },
    });

    expect(result.outcome).toBe("clip");
    if (result.outcome !== "clip") return;
    expect(result.clip.startMs).toBe(10_300);
    expect(result.clip.stopAtMs).toBe(10_800);
  });
});
