import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  repository: { listSavedItems: vi.fn(), listSavedArticleShelf: vi.fn(), deleteSavedItem: vi.fn() },
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/reading/repositories", () => ({ createDrizzleReadingRepository: mocks.createRepository }));

import { GET } from "@/app/api/v1/read/saved-items/route";
import { DELETE } from "@/app/api/v1/read/saved-items/[itemId]/route";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const requestId = "saved_items_123";
const emptyShelf = { items: [], page: 1, pageSize: 24, total: 0 };

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers: { "x-request-id": requestId, ...headers } });
}

describe("saved-items API route", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getDatabase.mockReturnValue({});
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.repository.listSavedItems.mockResolvedValue(emptyShelf);
    mocks.repository.listSavedArticleShelf.mockResolvedValue(emptyShelf);
    mocks.repository.deleteSavedItem.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("requires authentication", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const response = await GET(request("http://localhost/api/v1/read/saved-items"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_REQUIRED", requestId } });
    expect(mocks.repository.listSavedItems).not.toHaveBeenCalled();
    expect(mocks.repository.listSavedArticleShelf).not.toHaveBeenCalled();
  });

  it("validates pagination and item type before repository access", async () => {
    const response = await GET(request("http://localhost/api/v1/read/saved-items?page=0&itemType=word"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED", requestId } });
    expect(mocks.repository.listSavedItems).not.toHaveBeenCalled();
    expect(mocks.repository.listSavedArticleShelf).not.toHaveBeenCalled();
  });

  it("returns a private paged projection and forwards filters", async () => {
    mocks.repository.listSavedItems.mockResolvedValue({
      items: [{
        id: "00000000-0000-4000-8000-000000000010",
        articleId: "article.test@1",
        stableKey: "article.test",
        version: 1,
        title: "Una historia",
        sourceName: "Sueño",
        sourceUrl: null,
        itemType: "phrase",
        text: "de repente",
        position: 2,
        context: "Llegó de repente.",
        createdAt: new Date("2026-09-26T00:00:00.000Z"),
      }],
      page: 2,
      pageSize: 1,
      total: 3,
    });
    const response = await GET(request("http://localhost/api/v1/read/saved-items?search=repente&type=phrase&page=2&pageSize=1"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      data: {
        page: 2,
        pageSize: 1,
        total: 3,
        items: [{ id: "00000000-0000-4000-8000-000000000010", createdAt: "2026-09-26T00:00:00.000Z", articleId: "article.test@1" }],
      },
    });
    expect(mocks.repository.listSavedItems).toHaveBeenCalledWith(user.id, { search: "repente", itemType: "phrase", page: 2, pageSize: 1 });
    expect(mocks.repository.listSavedArticleShelf).not.toHaveBeenCalled();
  });

  it("serves saved articles and private stories under itemType=article", async () => {
    mocks.repository.listSavedArticleShelf.mockResolvedValue({
      items: [
        {
          articleId: "article.test@1",
          stableKey: "article.test",
          version: 1,
          title: "Una historia",
          sourceName: "Sueño",
          sourceUrl: null,
          itemType: "article",
          origin: "public",
          saved: true,
          createdAt: new Date("2026-09-26T00:00:00.000Z"),
        },
        {
          articleId: "article.private@1",
          stableKey: "article.private",
          version: 1,
          title: "Un cuento privado",
          sourceName: "Sueño Story Bot",
          sourceUrl: null,
          itemType: "article",
          origin: "generated",
          saved: false,
          createdAt: new Date("2026-09-25T00:00:00.000Z"),
        },
      ],
      page: 1,
      pageSize: 24,
      total: 2,
    });
    const response = await GET(request("http://localhost/api/v1/read/saved-items?itemType=article"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 2,
        items: [
          { articleId: "article.test@1", itemType: "article", origin: "public", saved: true, createdAt: "2026-09-26T00:00:00.000Z" },
          { articleId: "article.private@1", itemType: "article", origin: "generated", saved: false },
        ],
      },
    });
    expect(mocks.repository.listSavedArticleShelf).toHaveBeenCalledWith(user.id, { search: undefined, page: 1, pageSize: 24 });
    expect(mocks.repository.listSavedItems).not.toHaveBeenCalled();
  });

  it("merges both sources for the default 全部 view", async () => {
    mocks.repository.listSavedArticleShelf.mockResolvedValue({
      items: [{
        articleId: "article.test@1",
        stableKey: "article.test",
        version: 1,
        title: "Una historia",
        sourceName: "Sueño",
        sourceUrl: null,
        itemType: "article",
        origin: "public",
        saved: true,
        createdAt: new Date("2026-09-26T00:00:00.000Z"),
      }],
      page: 1,
      pageSize: 24,
      total: 1,
    });
    mocks.repository.listSavedItems.mockResolvedValue({
      items: [{
        id: "00000000-0000-4000-8000-000000000010",
        articleId: "article.test@1",
        stableKey: "article.test",
        version: 1,
        title: "Una historia",
        sourceName: "Sueño",
        sourceUrl: null,
        itemType: "highlight",
        text: "de repente",
        position: 2,
        context: "Llegó de repente.",
        createdAt: new Date("2026-09-27T00:00:00.000Z"),
      }],
      page: 1,
      pageSize: 24,
      total: 1,
    });
    const response = await GET(request("http://localhost/api/v1/read/saved-items"));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { total: number; items: Array<{ itemType: string }> } };
    expect(payload.data.total).toBe(2);
    // Newest first across both sources.
    expect(payload.data.items.map((entry) => entry.itemType)).toEqual(["highlight", "article"]);
    expect(mocks.repository.listSavedArticleShelf).toHaveBeenCalledWith(user.id, { search: undefined, page: 1, pageSize: 24 });
    expect(mocks.repository.listSavedItems).toHaveBeenCalledWith(user.id, { search: undefined, itemType: undefined, page: 1, pageSize: 24 });
  });

  it("accepts the cookie-session fallback", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(user);
    const response = await GET(request("http://localhost/api/v1/read/saved-items", { cookie: "sb-session=present" }));
    expect(response.status).toBe(200);
    expect(mocks.getCurrentUser).toHaveBeenCalledOnce();
  });

  it("does not let an invalid bearer token fall through to a cookie session", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(user);
    const response = await GET(request("http://localhost/api/v1/read/saved-items", {
      authorization: "Bearer invalid",
      cookie: "sb-session=present",
    }));
    expect(response.status).toBe(401);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.repository.listSavedItems).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated user's UUID and stays idempotent", async () => {
    const itemId = "00000000-0000-4000-8000-000000000010";
    const response = await DELETE(request(`http://localhost/api/v1/read/saved-items/${itemId}`, { cookie: "sb-session=present" }), { params: Promise.resolve({ itemId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", data: { id: itemId, deleted: true } });
    expect(mocks.repository.deleteSavedItem).toHaveBeenCalledWith(user.id, itemId);
  });

  it("rejects an invalid saved-item id before touching the repository", async () => {
    const response = await DELETE(request("http://localhost/api/v1/read/saved-items/not-a-uuid"), { params: Promise.resolve({ itemId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    expect(mocks.repository.deleteSavedItem).not.toHaveBeenCalled();
  });

  it("does not let an invalid bearer token authorize deletion through cookies", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(user);
    const itemId = "00000000-0000-4000-8000-000000000010";
    const response = await DELETE(
      request(`http://localhost/api/v1/read/saved-items/${itemId}`, {
        authorization: "Bearer invalid",
        cookie: "sb-session=present",
      }),
      { params: Promise.resolve({ itemId }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.repository.deleteSavedItem).not.toHaveBeenCalled();
  });
});
