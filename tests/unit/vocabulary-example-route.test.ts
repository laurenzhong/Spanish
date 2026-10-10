import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  findCorpusExample: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({
  verifyRequestUser: mocks.verifyRequestUser,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: mocks.createRepository };
});

import { GET } from "@/app/api/v1/read/vocabulary-example/route";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const previousDatabaseUrl = process.env.DATABASE_URL;

function request(word: string | null) {
  const url = new URL("http://localhost/api/v1/read/vocabulary-example");
  if (word !== null) url.searchParams.set("word", word);
  return new NextRequest(url, { headers: { "x-request-id": "vocabulary_example_1" } });
}

describe("vocabulary example route", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getDatabase.mockReturnValue({});
    mocks.createRepository.mockReturnValue({ findCorpusExample: mocks.findCorpusExample });
    mocks.findCorpusExample.mockResolvedValue({
      word: "casa",
      sentence: "Hoy me quedo en casa.",
      translation: "今天我待在家里。",
      sourceTitle: "Podcast diario",
      documentKind: "media",
      documentStableKey: "media.daily",
      documentVersion: 2,
      position: 7,
    });
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("requires a session before reading the corpus", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const response = await GET(request("casa"));
    expect(response.status).toBe(401);
    expect(mocks.findCorpusExample).not.toHaveBeenCalled();
  });

  it("rejects words that are not plain Spanish tokens", async () => {
    const response = await GET(request("casa'; drop table"));
    expect(response.status).toBe(400);
    expect(mocks.findCorpusExample).not.toHaveBeenCalled();
  });

  it("returns one published example with its translation", async () => {
    const response = await GET(request("casa"));
    expect(response.status).toBe(200);
    expect(mocks.findCorpusExample).toHaveBeenCalledWith("casa");
    const body = await response.json() as { data: { sentence: string; translation: string } };
    expect(body.data.sentence).toBe("Hoy me quedo en casa.");
    expect(body.data.translation).toBe("今天我待在家里。");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns an empty example instead of failing when the corpus has no match", async () => {
    mocks.findCorpusExample.mockResolvedValue(null);
    const response = await GET(request("zzzz"));
    expect(response.status).toBe(200);
    expect((await response.json() as { data: unknown }).data).toBeNull();
  });
});
