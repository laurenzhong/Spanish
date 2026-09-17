import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  repository: {
    listVocabulary: vi.fn(),
    listPhrases: vi.fn(),
    setIntent: vi.fn(),
  },
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

import { GET as getVocabulary } from "@/app/api/v1/lexicon/vocabulary/route";
import { GET as getPhrases } from "@/app/api/v1/lexicon/phrases/route";
import { PUT as putIntent } from "@/app/api/v1/lexicon/intents/[entryId]/route";
import { LexicalIntentConflictError } from "@/src/modules/lexicon-corpus/repositories";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const requestId = "lexicon_12345678";
const previousDatabaseUrl = process.env.DATABASE_URL;

function request(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, { ...init, headers: { "x-request-id": requestId, ...(init.headers ?? {}) } });
}

describe("lexicon API routes", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.getDatabase.mockReturnValue({});
    mocks.repository.listVocabulary.mockResolvedValue({ items: [], page: 1, pageSize: 24, total: 0 });
    mocks.repository.listPhrases.mockResolvedValue({ items: [], page: 1, pageSize: 24, total: 0 });
    mocks.repository.setIntent.mockResolvedValue({ entryKind: "lexeme", entryId: "entry-1", intent: "revisit", revision: 1 });
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("validates list filters and forwards bounded queries", async () => {
    const vocabulary = await getVocabulary(request("http://localhost/api/v1/lexicon/vocabulary?search=café&intent=revisit&lemmaStatus=pending&page=2&pageSize=12"));
    expect(vocabulary.status).toBe(200);
    expect(mocks.repository.listVocabulary).toHaveBeenCalledWith(user.id, { search: "café", intent: "revisit", lemmaStatus: "pending", page: 2, pageSize: 12 });

    const phraseFilters = await getPhrases(request("http://localhost/api/v1/lexicon/phrases?pragmaticPurpose=saludo&register=neutral&region=es-ES&cefr=A2"));
    expect(phraseFilters.status).toBe(200);
    expect(mocks.repository.listPhrases).toHaveBeenCalledWith(user.id, { pragmaticPurpose: "saludo", register: "neutral", region: "es-ES", cefr: "A2", page: 1, pageSize: 24 });

    mocks.repository.listPhrases.mockClear();
    const phrases = await getPhrases(request("http://localhost/api/v1/lexicon/phrases?search=qué&pageSize=99"));
    expect(phrases.status).toBe(400);
    expect(mocks.repository.listPhrases).not.toHaveBeenCalled();
  });

  it("allows public list reads without a session", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const response = await getPhrases(request("http://localhost/api/v1/lexicon/phrases"));
    expect(response.status).toBe(200);
    expect(mocks.repository.listPhrases).toHaveBeenCalledWith(undefined, { page: 1, pageSize: 24 });
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("treats empty native form filters as omitted", async () => {
    const response = await getVocabulary(request("http://localhost/api/v1/lexicon/vocabulary?search=&intent=&lemmaStatus="));
    expect(response.status).toBe(200);
    expect(mocks.repository.listVocabulary).toHaveBeenCalledWith(user.id, { page: 1, pageSize: 24 });
  });

  it("requires authentication and validates intent payload before writing", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const unauthorized = await putIntent(request("http://localhost/api/v1/lexicon/intents/entry-1", { method: "PUT", body: JSON.stringify({ entryKind: "lexeme", intent: "revisit" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ entryId: "entry-1" }) });
    expect(unauthorized.status).toBe(401);

    mocks.verifyRequestUser.mockResolvedValue(user);
    const invalid = await putIntent(request("http://localhost/api/v1/lexicon/intents/entry-1", { method: "PUT", body: JSON.stringify({ entryKind: "unknown", intent: "revisit" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ entryId: "entry-1" }) });
    expect(invalid.status).toBe(400);
    expect(mocks.repository.setIntent).not.toHaveBeenCalled();
  });

  it("maps stale intent revisions to a stable conflict", async () => {
    mocks.repository.setIntent.mockRejectedValue(new LexicalIntentConflictError("stale"));
    const response = await putIntent(request("http://localhost/api/v1/lexicon/intents/entry-1", { method: "PUT", body: JSON.stringify({ entryKind: "phrase", intent: "revisit", expectedRevision: 1 }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ entryId: "entry-1" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CONFLICT", requestId } });
  });
});
