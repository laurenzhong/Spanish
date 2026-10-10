import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
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
import { ReadShelfData } from "@/app/(product)/read/read-shelf-data";
import { ReadShelfSkeleton } from "@/app/(product)/read/read-shelf-skeleton";
import { ReadSectionNavigation } from "@/src/modules/lexicon-corpus";

const listResult = { articles: [], totalCount: 0, topics: [], nextCursor: null, hasMore: false, savedFilterAvailable: false };
const originalDatabaseUrl = process.env.DATABASE_URL;

function elements(children: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(children).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child] : []);
}

describe("read page data loading", () => {
  afterEach(() => {
    vi.clearAllMocks();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("renders the reading navigation as the static shell and holds the shelf behind its own boundary", () => {
    const rendered = ReadPage({ searchParams: Promise.resolve({}) });
    const [heading, navigation, boundary] = elements(rendered.props.children);

    expect(heading.type).toBe("h1");
    expect(heading.props.className).toBe("sr-only");
    expect(navigation.type).toBe(ReadSectionNavigation);
    expect(navigation.props.active).toBe("articles");
    // The shelf waits behind its own Suspense boundary, so the navigation above
    // it is already on screen (at its real size) while articles load.
    expect(boundary.type).toBe(Suspense);
    expect((boundary.props as { fallback: ReactElement }).fallback.type).toBe(ReadShelfSkeleton);
    expect((boundary.props as { children: ReactElement }).children.type).toBe(ReadShelfData);
  });

  it("reads no user data while rendering the public library", async () => {
    // Reading progress used to be read here, one sequential remote round trip
    // before the shelf could paint (~800 ms measured). It is per-user
    // decoration and now belongs to the client shelf. The `await` matters: the
    // old page was async and only reached its private reads after the first
    // suspension point, so a synchronous assertion would pass on it too.
    process.env.DATABASE_URL = "postgres://test";
    mocks.getArticles.mockResolvedValue(listResult);

    await ReadPage({ searchParams: Promise.resolve({}) });

    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.listReadingProgress).not.toHaveBeenCalled();
    expect(mocks.listSavedArticles).not.toHaveBeenCalled();
    expect(mocks.listPrivateStories).not.toHaveBeenCalled();
    // The article query itself now runs inside the boundary, not during the
    // page render.
    expect(mocks.getArticles).not.toHaveBeenCalled();
  });

  it("never loads personal content even when a saved=1 link is opened", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getArticles.mockResolvedValue(listResult);

    // `?saved=1` was the removed 我的文章 shelf. It must be ignored rather than
    // resurrecting saved-article or private-story reads on the public library.
    await ReadShelfData({ searchParams: Promise.resolve({ saved: "1" }) });

    expect(mocks.listReadingProgress).not.toHaveBeenCalled();
    expect(mocks.listSavedArticles).not.toHaveBeenCalled();
    expect(mocks.listPrivateStories).not.toHaveBeenCalled();
  });

  it("keeps the Web Sites tab on the public shelf without any private read", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getArticles.mockResolvedValue(listResult);

    const rendered = await ReadShelfData({ searchParams: Promise.resolve({ source: "web" }) });

    expect(rendered.props.source).toBe("web");
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.listReadingProgress).not.toHaveBeenCalled();
  });

  it("loads the requested article page in one bounded repository batch", async () => {
    delete process.env.DATABASE_URL;
    const pageArticles = Array.from({ length: 12 }, (_, index) => ({ id: `article-${index + 24}` }));
    mocks.getArticles.mockResolvedValueOnce({ ...listResult, articles: pageArticles, totalCount: 105, nextCursor: "36", hasMore: true });

    const rendered = await ReadShelfData({ searchParams: Promise.resolve({ page: "3" }) });

    expect(mocks.getArticles).toHaveBeenCalledTimes(1);
    expect(mocks.getArticles).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cursor: "24", pageSize: 12 }));
    expect(rendered.props).toEqual(expect.objectContaining({
      result: expect.objectContaining({ articles: pageArticles }),
      page: 3,
      pageSize: 12,
    }));
  });

  it("clamps an out-of-range page to the last available page", async () => {
    delete process.env.DATABASE_URL;
    mocks.getArticles
      .mockResolvedValueOnce({ ...listResult, articles: [], totalCount: 12, hasMore: false })
      .mockResolvedValueOnce({ ...listResult, articles: [{ id: "article-1" }], totalCount: 12, hasMore: false });

    const rendered = await ReadShelfData({ searchParams: Promise.resolve({ page: "9" }) });

    expect(mocks.getArticles).toHaveBeenCalledTimes(2);
    expect(mocks.getArticles).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ cursor: "0" }));
    expect(rendered.props.page).toBe(1);
  });
});
