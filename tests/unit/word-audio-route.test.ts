import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read-aloud route.
 *
 * The one behaviour worth pinning beyond the status codes: the response must
 * carry a single clip reference and never the media's segment list. The shelf
 * holds thousands of words, so a playback payload per click would be a payload
 * regression that no other test would notice.
 */
const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  findWordAddress: vi.fn(),
  getSegmentLookup: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verifyRequestUser, getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/lexicon-corpus/repositories/word-address-reader", () => ({ findWordAddress: mocks.findWordAddress }));
vi.mock("@/src/modules/media/repositories", () => ({
  createDrizzleMediaRepository: () => ({ getSegmentLookup: mocks.getSegmentLookup }),
}));

import { POST as readWordAudio } from "@/app/api/v1/read/word-audio/route";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const previousDatabaseUrl = process.env.DATABASE_URL;
const address = {
  word: "casa",
  exampleText: "La casa es grande.",
  documentKind: "media" as const,
  documentStableKey: "youtube.test",
  documentVersion: 1,
  segmentIndex: 4,
};

function request(body: unknown, init: { withSession?: boolean } = {}) {
  mocks.verifyRequestUser.mockResolvedValue(init.withSession === false ? null : user);
  mocks.getCurrentUser.mockResolvedValue(null);
  return new NextRequest("http://localhost/api/v1/read/word-audio", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-request-id": "word_audio_12345678" },
  });
}

describe("POST /api/v1/read/word-audio", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.getDatabase.mockReturnValue({});
    mocks.findWordAddress.mockResolvedValue(address);
    mocks.getSegmentLookup.mockResolvedValue({
      stableKey: "youtube.test",
      title: "Podcast publicado",
      version: 1,
      asset: { kind: "audio", url: "https://cdn.test/audio.mp3", expiresAt: new Date("2026-10-12T00:00:00.000Z") },
      candidates: [{
        id: "segment-1",
        index: 4,
        startMs: 10_000,
        endMs: 12_000,
        sourceText: "La casa es grande.",
        words: [
          { text: "La", startMs: 10_000, endMs: 10_200, startOffset: 0, endOffset: 2 },
          { text: "casa", startMs: 10_300, endMs: 10_800, startOffset: 3, endOffset: 7 },
          { text: "es", startMs: 10_900, endMs: 11_100, startOffset: 8, endOffset: 10 },
          { text: "grande", startMs: 11_200, endMs: 11_900, startOffset: 11, endOffset: 17 },
        ],
      }],
    });
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("returns one clip reference for a word that has real audio", async () => {
    const response = await readWordAudio(request({ word: "casa" }));
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { outcome: string; clip: Record<string, unknown> } };
    expect(body.data.outcome).toBe("clip");
    expect(body.data.clip.url).toBe("https://cdn.test/audio.mp3");
    expect(body.data.clip.startMs).toBe(10_180);
    expect(body.data.clip.stopAtMs).toBe(11_050);
    expect(body.data.clip.sourceTitle).toBe("Podcast publicado");
  });

  it("never returns the media's segment list", async () => {
    const response = await readWordAudio(request({ word: "casa" }));
    const text = await response.text();
    // The clip is a reference; a `segments` array would be the whole playback
    // payload and belongs to the media page, not to a word click.
    expect(text).not.toContain("\"segments\"");
    expect(text).not.toContain("\"translation\"");
  });

  it("asks for synthesis when the corpus has no example for the word", async () => {
    mocks.findWordAddress.mockResolvedValue(null);
    const response = await readWordAudio(request({ word: "casa" }));
    expect(response.status).toBe(200);
    expect((await response.json() as { data: unknown }).data).toEqual({ outcome: "synthetic", reason: "no_example" });
    // Nothing to play means no media read at all.
    expect(mocks.getSegmentLookup).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    const response = await readWordAudio(request({ word: "casa" }, { withSession: false }));
    expect(response.status).toBe(401);
  });

  it("rejects a word that is not a plain word", async () => {
    for (const body of [{ word: "" }, { word: "casa; drop table" }, { word: "a".repeat(41) }, { word: "casa", extra: 1 }]) {
      const response = await readWordAudio(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("reports a media read failure as synthesis rather than failing the click", async () => {
    mocks.getSegmentLookup.mockRejectedValue(new Error("MEDIA_NOT_AVAILABLE"));
    const response = await readWordAudio(request({ word: "casa" }));
    expect(response.status).toBe(200);
    expect((await response.json() as { data: unknown }).data).toEqual({ outcome: "synthetic", reason: "media_unavailable" });
  });
});
