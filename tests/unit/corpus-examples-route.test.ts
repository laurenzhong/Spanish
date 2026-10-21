// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), session: vi.fn(), database: vi.fn(), create: vi.fn(), list: vi.fn() }));
vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verify, getCurrentUser: mocks.session }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.database }));
vi.mock("@/src/modules/lexicon-corpus/repositories/corpus-examples-repository", () => ({ createCorpusExamplesRepository: mocks.create }));
import { GET } from "@/app/api/v1/corpus/examples/route";
import { corpusExamplesQuerySchema } from "@/src/modules/lexicon-corpus/schemas/corpus-examples";

const previousDatabase = process.env.DATABASE_URL;
describe("corpus examples read protocol", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.DATABASE_URL = "postgresql://example.invalid/db"; mocks.verify.mockResolvedValue({ id: "owner" }); mocks.session.mockResolvedValue({ id: "session" }); mocks.create.mockReturnValue({ list: mocks.list }); mocks.list.mockResolvedValue({ items: [], page: 1, pageSize: 12, total: 0 }); });
  afterEach(() => { if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase; });
  const request = (suffix = "", headers?: Record<string, string>) => new NextRequest(`http://localhost/api/v1/corpus/examples${suffix}`, { headers });

  it("passes validated filters to the application and never caches user content", async () => {
    const response = await GET(request("?query=por%20eso&contentKind=podcast&match=all&page=2"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.list).toHaveBeenCalledWith("owner", expect.objectContaining({ query: "por eso", contentKind: "podcast", match: "all", page: 2, pageSize: 12 }));
  });
  it("uses a valid session only when no explicit authorization was supplied", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("session", expect.anything());
  });
  it("rejects invalid authorization even when a valid session exists", async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await GET(request("", { authorization: "Bearer invalid" }))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("requires authentication before database access", async () => {
    mocks.verify.mockResolvedValue(null); mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it.each(["?page=0", "?pageSize=25", "?match=lemma", "?entryKind=phrase", "?contentKind=media"])("rejects invalid input %s", async (suffix) => {
    expect((await GET(request(suffix))).status).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("distinguishes a missing database and a read failure from an empty library", async () => {
    delete process.env.DATABASE_URL;
    expect((await GET(request())).status).toBe(503);
    process.env.DATABASE_URL = "postgresql://example.invalid/db";
    mocks.list.mockRejectedValue(new Error("private content must not be logged"));
    const result = await GET(request());
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain("private content");
  });
  it("bounds query length and page counts while allowing empty browse", () => {
    expect(corpusExamplesQuerySchema.parse({})).toMatchObject({ query: "", page: 1, pageSize: 12 });
    expect(corpusExamplesQuerySchema.safeParse({ query: "a".repeat(121) }).success).toBe(false);
    expect(corpusExamplesQuerySchema.safeParse({ page: 4105 }).success).toBe(true);
    expect(corpusExamplesQuerySchema.safeParse({ page: 100001 }).success).toBe(false);
  });
});
