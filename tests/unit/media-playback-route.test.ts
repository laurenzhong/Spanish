// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MediaUnavailableError extends Error {
    readonly code = "MEDIA_NOT_AVAILABLE" as const;
  }
  return {
    MediaUnavailableError,
    verifyRequestUser: vi.fn(),
    getCurrentUser: vi.fn(),
    getMediaPlayback: vi.fn(),
    createRepository: vi.fn(),
    getDatabase: vi.fn(),
  };
});

vi.mock("@/src/shared/auth/server", () => ({
  verifyRequestUser: mocks.verifyRequestUser,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/src/modules/media", () => ({
  MediaUnavailableError: mocks.MediaUnavailableError,
  createDrizzleMediaRepository: mocks.createRepository,
  getMediaPlayback: mocks.getMediaPlayback,
}));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));

import { GET } from "@/app/api/v1/media/[stableKey]/playback/route";

const user = { id: "00000000-0000-4000-8000-000000000001", email: null };
const requestId = "playback_12345678";

function request(query = "", stableKey = "podcast.test") {
  return new NextRequest(`http://localhost/api/v1/media/${encodeURIComponent(stableKey)}/playback${query}`, {
    headers: { "x-request-id": requestId },
  });
}

function playback() {
  return {
    media: {
      stableKey: "podcast.test",
      version: 3,
      kind: "podcast",
      title: "Episode",
      sourceName: "Test source",
    },
    asset: { kind: "audio", url: "https://content.libsyn.com/episode.mp3", expiresAt: null },
    segments: [
      {
        id: "00000000-0000-4000-8000-0000000000aa",
        index: 0,
        startMs: 0,
        endMs: 1_000,
        sourceText: "Buenos días.",
        translation: null,
        speaker: null,
        words: [{ startMs: 0, endMs: 1_000, startOffset: 0, endOffset: 6, text: "Buenos" }],
      },
    ],
  };
}

describe("media playback route", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createRepository.mockReturnValue({ repository: true });
    mocks.getDatabase.mockReturnValue({ database: true });
    mocks.getMediaPlayback.mockResolvedValue(playback());
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("keeps the word timings by default so the existing full contract does not change", async () => {
    const response = await GET(request(), { params: Promise.resolve({ stableKey: "podcast.test" }) });

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { segments: Array<{ words: unknown }> } };
    expect(body.data.segments[0]?.words).toEqual([
      { startMs: 0, endMs: 1_000, startOffset: 0, endOffset: 6, text: "Buenos" },
    ]);
    expect(mocks.getMediaPlayback).toHaveBeenCalledWith(
      { repository: true },
      "podcast.test",
      user.id,
      expect.any(Date),
      {},
    );
  });

  it("requests the text-only projection for include=text without changing the response contract", async () => {
    mocks.getMediaPlayback.mockResolvedValue({
      ...playback(),
      segments: playback().segments.map((segment) => ({ ...segment, words: null })),
    });
    const response = await GET(request("?include=text"), { params: Promise.resolve({ stableKey: "podcast.test" }) });

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { segments: Array<{ words: unknown; sourceText: string }> } };
    expect(body.data.segments[0]).toMatchObject({ sourceText: "Buenos días.", words: null });
    expect(mocks.getMediaPlayback).toHaveBeenCalledWith(
      { repository: true },
      "podcast.test",
      user.id,
      expect.any(Date),
      { includeWords: false },
    );
  });

  it("rejects an unsupported include value instead of silently returning the full transcript", async () => {
    for (const query of ["?include=words", "?include=FULL", "?include=text,words"]) {
      const response = await GET(request(query), { params: Promise.resolve({ stableKey: "podcast.test" }) });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_FAILED", retryable: false, requestId },
      });
    }
    expect(mocks.getMediaPlayback).not.toHaveBeenCalled();
  });

  it("decodes the stable key and reports withdrawn or unpublished media as unavailable", async () => {
    mocks.getMediaPlayback.mockRejectedValue(new mocks.MediaUnavailableError());
    const response = await GET(request("", "podcast.test"), { params: Promise.resolve({ stableKey: "podcast.test" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEDIA_NOT_AVAILABLE", requestId } });
    expect(mocks.getMediaPlayback.mock.calls[0]?.[1]).toBe("podcast.test");
  });

  it("requires a session and a configured database before reading playback", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(null);
    const unauthenticated = await GET(request(), { params: Promise.resolve({ stableKey: "podcast.test" }) });
    expect(unauthenticated.status).toBe(401);
    expect(mocks.getMediaPlayback).not.toHaveBeenCalled();

    mocks.verifyRequestUser.mockResolvedValue(user);
    delete process.env.DATABASE_URL;
    const unavailable = await GET(request(), { params: Promise.resolve({ stableKey: "podcast.test" }) });
    expect(unavailable.status).toBe(503);
    expect(mocks.getMediaPlayback).not.toHaveBeenCalled();
  });
});
