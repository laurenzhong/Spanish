import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSavedShelfItems: vi.fn(),
  createDrizzleReadingRepository: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  SavedItemsLibrary: vi.fn(() => null),
}));

vi.mock("@/src/modules/reading", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/reading")>();
  return { ...original, listSavedShelfItems: mocks.listSavedShelfItems };
});
vi.mock("@/src/modules/reading/repositories", () => ({ createDrizzleReadingRepository: mocks.createDrizzleReadingRepository }));
vi.mock("@/src/modules/reading/ui/saved-items-library", () => ({ SavedItemsLibrary: mocks.SavedItemsLibrary }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));

import SavedItemsPage from "@/app/(product)/read/saved-items/page";

const shelfItem = {
  id: "00000000-0000-4000-8000-000000000010",
  articleId: "article.shelf@1",
  stableKey: "article.shelf",
  version: 1,
  title: "Una historia",
  sourceName: "Sueño Editorial",
  sourceUrl: null,
  itemType: "highlight" as const,
  text: "de repente",
  position: 2,
  context: null,
  createdAt: new Date("2026-09-26T00:00:00.000Z"),
};
const articleItem = {
  articleId: "article.story@1",
  stableKey: "article.story",
  version: 1,
  title: "Un cuento privado",
  sourceName: "Sueño Story Bot",
  sourceUrl: null,
  itemType: "article" as const,
  origin: "generated" as const,
  saved: false,
  createdAt: new Date("2026-09-27T00:00:00.000Z"),
};
const originalDatabaseUrl = process.env.DATABASE_URL;

async function renderPage(params: Record<string, string>) {
  const rendered = await SavedItemsPage({ searchParams: Promise.resolve(params) });
  // The page returns the library alone now: the reading navigation and the
  // container that stacked it above the content belong to
  // `app/(product)/read/layout.tsx`.
  return rendered.props as {
    items: readonly { itemType: string; createdAt: string }[];
    itemType?: string;
    page: number;
    pageSize: number;
    total: number;
    unavailable: boolean;
  };
}

describe("saved-items page data loading", () => {
  afterEach(() => {
    vi.clearAllMocks();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("stays honest and read-only without a database", async () => {
    delete process.env.DATABASE_URL;
    const props = await renderPage({});
    expect(mocks.listSavedShelfItems).not.toHaveBeenCalled();
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(props.unavailable).toBe(true);
    expect(props.items).toEqual([]);
  });

  it("forwards the requested tab and page to the shelf adapter", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getDatabase.mockReturnValue({});
    mocks.createDrizzleReadingRepository.mockReturnValue("reading-repository");
    mocks.listSavedShelfItems.mockResolvedValue({ items: [articleItem, shelfItem], page: 2, pageSize: 10, total: 12 });

    const props = await renderPage({ itemType: "article", page: "2", pageSize: "10", search: "cuento" });

    expect(mocks.listSavedShelfItems).toHaveBeenCalledWith("reading-repository", "user-1", { itemType: "article", page: 2, pageSize: 10, search: "cuento" });
    expect(props).toMatchObject({ itemType: "article", page: 2, pageSize: 10, total: 12, unavailable: false });
    expect(props.items.map((item) => item.itemType)).toEqual(["article", "highlight"]);
    expect(props.items.map((item) => item.createdAt)).toEqual(["2026-09-27T00:00:00.000Z", "2026-09-26T00:00:00.000Z"]);
  });

  it("keeps the type alias and ignores an unknown item type", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getDatabase.mockReturnValue({});
    mocks.createDrizzleReadingRepository.mockReturnValue("reading-repository");
    mocks.listSavedShelfItems.mockResolvedValue({ items: [], page: 1, pageSize: 24, total: 0 });

    await renderPage({ type: "highlight" });
    expect(mocks.listSavedShelfItems).toHaveBeenLastCalledWith("reading-repository", "user-1", { itemType: "highlight", page: 1, pageSize: 24, search: undefined });

    // `?itemType=word` stays invalid: the shelf falls back to 全部 instead of
    // forwarding an unknown kind to the repository.
    await renderPage({ itemType: "word" });
    expect(mocks.listSavedShelfItems).toHaveBeenLastCalledWith("reading-repository", "user-1", { itemType: undefined, page: 1, pageSize: 24, search: undefined });
  });

  it("reports itself unavailable when the session is missing", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getDatabase.mockReturnValue({});

    const props = await renderPage({ itemType: "article" });
    expect(mocks.listSavedShelfItems).not.toHaveBeenCalled();
    expect(props.unavailable).toBe(true);
  });
});
