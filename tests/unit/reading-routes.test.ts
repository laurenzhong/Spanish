import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  repository: {
    getState: vi.fn(),
    upsertState: vi.fn(),
    setSaved: vi.fn(),
    listSavedArticleIds: vi.fn(),
    saveSource: vi.fn(),
    listSavedSources: vi.fn(),
    deleteSavedSource: vi.fn(),
  },
}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/reading/repositories", () => ({ createDrizzleReadingRepository: mocks.createRepository }));

import { GET as getState, PATCH as patchState } from "@/app/api/v1/read/articles/[articleId]/state/route";
import { GET as getSaved, POST as postSaved } from "@/app/api/v1/read/saved/route";
import { GET as getSources, POST as postSource } from "@/app/api/v1/read/sources/route";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const requestId = "reading_12345678";
const hash = "a".repeat(64);
const statePatch = {
  contentHash: hash,
  highlights: [],
  note: "",
  position: 0,
  saved: false,
  savedPhrases: [],
  status: "in_progress" as const,
};

function request(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(url, {
    ...init,
    headers: { "x-request-id": requestId, ...(init?.headers ?? {}) },
  });
}

describe("reading API routes", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.getDatabase.mockReturnValue({});
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.createRepository.mockReturnValue(mocks.repository);
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("requires authentication for state, saved, and source reads", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);

    const responses = await Promise.all([
      getState(request("http://localhost/api/v1/read/articles/article@1/state"), { params: Promise.resolve({ articleId: "article@1" }) }),
      getSaved(request("http://localhost/api/v1/read/saved")),
      getSources(request("http://localhost/api/v1/read/sources")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    await expect(responses[0]?.json()).resolves.toMatchObject({ error: { code: "AUTH_REQUIRED", requestId } });
  });

  it("returns unavailable when the database is not configured", async () => {
    delete process.env.DATABASE_URL;

    const responses = await Promise.all([
      getState(request("http://localhost/api/v1/read/articles/article@1/state"), { params: Promise.resolve({ articleId: "article@1" }) }),
      getSaved(request("http://localhost/api/v1/read/saved")),
      getSources(request("http://localhost/api/v1/read/sources")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
  });

  it("accepts the Supabase cookie session for saved article reads", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.repository.listSavedArticleIds.mockResolvedValue(["article.reading-test@1"]);
    const response = await getSaved(request("http://localhost/api/v1/read/saved", { headers: { cookie: "sb-session=present" } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { articleIds: ["article.reading-test@1"] } });
    expect(mocks.getCurrentUser).toHaveBeenCalledOnce();
  });

  it("rejects malformed state and save payloads before repository access", async () => {
    const malformedState = await patchState(
      request("http://localhost/api/v1/read/articles/article@1/state", {
        method: "PATCH",
        body: JSON.stringify({ ...statePatch, contentHash: "stale" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ articleId: "article@1" }) },
    );
    const malformedSave = await postSaved(
      request("http://localhost/api/v1/read/saved", {
        method: "POST",
        body: JSON.stringify({ articleId: "" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(malformedState.status).toBe(400);
    expect(malformedSave.status).toBe(400);
    expect(mocks.repository.upsertState).not.toHaveBeenCalled();
    expect(mocks.repository.setSaved).not.toHaveBeenCalled();
  });

  it("reports a version conflict without overwriting local state", async () => {
    mocks.repository.upsertState.mockRejectedValueOnce(new Error("ARTICLE_VERSION_CONFLICT"));

    const response = await patchState(
      request("http://localhost/api/v1/read/articles/article@1/state", {
        method: "PATCH",
        body: JSON.stringify(statePatch),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ articleId: "article@1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CONFLICT", requestId } });
  });

  it("rejects malformed source URLs and never fetches them", async () => {
    const response = await postSource(
      request("http://localhost/api/v1/read/sources", {
        method: "POST",
        body: JSON.stringify({ url: "not a url" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.repository.saveSource).not.toHaveBeenCalled();
  });
});
