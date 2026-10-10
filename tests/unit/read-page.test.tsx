import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getArticles: vi.fn(),
  BundleArticleRepository: vi.fn(),
  createRuntimeArticleRepository: vi.fn(() => ({})),
  listPrivateStories: vi.fn(),
  listReadingProgress: vi.fn(),
  listSavedArticles: vi.fn(),
  createDrizzleGeneratedArticleRepository: vi.fn(),
  createDrizzleReadingRepository: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  ReadShelf: vi.fn(() => null),
}));

vi.mock("@/src/modules/content/application", () => ({ getArticles: mocks.getArticles }));
vi.mock("@/src/modules/content/repositories", () => ({
  BundleArticleRepository: mocks.BundleArticleRepository,
  createRuntimeArticleRepository: mocks.createRuntimeArticleRepository,
}));
vi.mock("@/src/modules/reading", () => ({
  listPrivateStories: mocks.listPrivateStories,
  listReadingProgress: mocks.listReadingProgress,
  listSavedArticles: mocks.listSavedArticles,
}));
vi.mock("@/src/modules/reading/repositories", () => ({
  createDrizzleGeneratedArticleRepository: mocks.createDrizzleGeneratedArticleRepository,
  createDrizzleReadingRepository: mocks.createDrizzleReadingRepository,
}));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/app/(product)/read/read-shelf", () => ({ ReadShelf: mocks.ReadShelf }));

import ReadPage from "@/app/(product)/read/page";

const listResult = { articles: [], totalCount: 0, topics: [], nextCursor: null, hasMore: false, savedFilterAvailable: false };
const originalDatabaseUrl = process.env.DATABASE_URL;

describe("read page data loading", () => {
  afterEach(() => {
    vi.clearAllMocks();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("does not query user data for the Web Sites empty state", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getArticles.mockResolvedValue(listResult);

    await ReadPage({ searchParams: Promise.resolve({ source: "web" }) });

    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.listReadingProgress).not.toHaveBeenCalled();
  });

  it("never loads personal content even when a saved=1 link is opened", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getDatabase.mockReturnValue({});
    mocks.createDrizzleReadingRepository.mockReturnValue("reading-repository");
    mocks.getArticles.mockResolvedValue(listResult);
    mocks.listReadingProgress.mockResolvedValue([]);

    // `?saved=1` was the removed 我的文章 shelf. It must be ignored rather than
    // resurrecting saved-article or private-story reads on the public library.
    await ReadPage({ searchParams: Promise.resolve({ saved: "1" }) });

    expect(mocks.listReadingProgress).toHaveBeenCalledTimes(1);
    expect(mocks.listSavedArticles).not.toHaveBeenCalled();
    expect(mocks.listPrivateStories).not.toHaveBeenCalled();
  });

  it("loads only progress for the public shelf", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getDatabase.mockReturnValue({});
    mocks.createDrizzleReadingRepository.mockReturnValue("reading-repository");
    mocks.getArticles.mockResolvedValue(listResult);
    mocks.listReadingProgress.mockResolvedValue([]);

    await ReadPage({ searchParams: Promise.resolve({}) });

    expect(mocks.listReadingProgress).toHaveBeenCalledTimes(1);
    expect(mocks.listSavedArticles).not.toHaveBeenCalled();
    expect(mocks.listPrivateStories).not.toHaveBeenCalled();
  });

  it("loads the requested article page in one bounded repository batch", async () => {
    delete process.env.DATABASE_URL;
    const pageArticles = Array.from({ length: 12 }, (_, index) => ({ id: `article-${index + 24}` }));
    mocks.getArticles.mockResolvedValueOnce({ ...listResult, articles: pageArticles, totalCount: 105, nextCursor: "36", hasMore: true });

    const rendered = await ReadPage({ searchParams: Promise.resolve({ page: "3" }) });

    expect(mocks.getArticles).toHaveBeenCalledTimes(1);
    expect(mocks.getArticles).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cursor: "24", pageSize: 12 }));
    expect(rendered.props.children[2].props).toEqual(expect.objectContaining({
      result: expect.objectContaining({ articles: pageArticles }),
      page: 3,
      pageSize: 12,
    }));
  });
});
