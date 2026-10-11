import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  createRepository: vi.fn(),
  redirect: vi.fn(),
  repository: { listFrequencyWords: vi.fn() },
  languageReactor: { current: {} as Record<string, readonly string[]> },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
// The real loader reads the Language Reactor asset off disk; these tests hand it
// the meanings directly, including the empty case the asset is in until the
// scrape lands.
vi.mock("@/app/(product)/read/vocabulary/lr-meanings", () => ({
  loadLrMeaningAsset: () => ({ available: true, order: "language-reactor-hover-dictionary", meanings: mocks.languageReactor.current }),
}));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: mocks.createRepository };
});

import VocabularyPage from "@/app/(product)/read/vocabulary/page";

const previousDatabaseUrl = process.env.DATABASE_URL;

/** 250 rows: three bands, and proof that nothing is paged away. */
const shelfItems = Array.from({ length: 250 }, (_, index) => ({
  id: `word:item${index}`,
  word: index === 0 ? "ser" : index === 1 ? "casa" : `item${index}`,
  normalizedWord: index === 0 ? "ser" : index === 1 ? "casa" : `item${index}`,
  occurrenceCount: index,
  context: index === 0 ? "Ser uno mismo es difícil." : null,
  sourceTitle: index === 0 ? "Podcast publicado" : null,
}));

async function renderPage(params: Record<string, string> = {}) {
  render(await VocabularyPage({ searchParams: Promise.resolve(params) }));
}

/** The word tiles only: the page's own search submit button is not a word. */
function tiles(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".vocabulary-study__word")];
}

/** jsdom ships no IntersectionObserver; the shelf frame observes its bands. */
class NoopIntersectionObserver {
  observe(): void { /* nothing to do */ }
  unobserve(): void { /* nothing to do */ }
  disconnect(): void { /* nothing to do */ }
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

describe("vocabulary page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
    mocks.languageReactor.current = {};
    delete process.env.DATABASE_URL;
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getDatabase.mockReturnValue({});
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); });
    mocks.repository.listFrequencyWords.mockImplementation(async (query: { search?: string; page: number; pageSize: number }) => {
      const matched = query.search ? shelfItems.filter((item) => item.word.includes(query.search!)) : shelfItems;
      return { items: matched.slice(0, query.pageSize), page: 1, pageSize: query.pageSize, total: matched.length };
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  function openWithDatabase() {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
  }

  it("renders the whole shelf on one page, without pagination", async () => {
    openWithDatabase();
    await renderPage();

    // One call for the whole shelf, sized by the committed reference list: the
    // page never asks twice, so a request builds the corpus snapshot once.
    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledTimes(1);
    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 7_922 });

    const lists = screen.getAllByRole("list");
    expect(lists.map((list) => list.getAttribute("aria-labelledby"))).toEqual(["vocabulary-band-1", "vocabulary-band-101", "vocabulary-band-201"]);
    expect(tiles()).toHaveLength(250);
    expect(screen.getByRole("heading", { name: "排名 201 - 250:" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "词句分页" })).not.toBeInTheDocument();
    expect(screen.getByText(/按参考词频排序的 250 个内容词/u)).toBeInTheDocument();
  });

  it("keeps the reviewed meaning under the word and the honest placeholder elsewhere", async () => {
    openWithDatabase();
    await renderPage();

    const words = tiles();
    expect(words[0]).toHaveTextContent("是（说明身份、来源或本质）");
    expect(words[1]).toHaveTextContent("房子、家");
    expect(words[2]).toHaveTextContent("释义待补充");
    expect(document.querySelectorAll(".vocabulary-study__word small")).toHaveLength(0);
  });

  it("puts Language Reactor's first meaning on the tile and all of them, in LR's order, on hover", async () => {
    const user = userEvent.setup();
    openWithDatabase();
    // LR's own order, which is not a frequency order.
    mocks.languageReactor.current = { item5: ["五", "第五", "五号"] };
    await renderPage();

    const tile = tiles().find((word) => word.dataset.word === "item5") as HTMLElement;
    expect(tile).toHaveTextContent("五");
    expect(tile).not.toHaveTextContent("第五");

    await user.hover(tile);
    const layer = document.getElementById("vocabulary-translation") as HTMLElement;
    expect(within(layer).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["五", "第五", "五号"]);
    // The hover path exists for a word the reviewed glossary does not carry.
    expect(tile).toHaveAttribute("aria-describedby", "vocabulary-translation");

    await user.click(tile);
    const card = screen.getByRole("complementary", { name: "item5 词汇卡片" });
    expect(card).toHaveTextContent("Language Reactor 词典释义");
    // Nothing claims the order is by commonness.
    expect(card).not.toHaveTextContent(/最常用|按频率|常用度/u);
  });

  it("shows a short LR list as it is, never padded to three", async () => {
    const user = userEvent.setup();
    openWithDatabase();
    mocks.languageReactor.current = { item6: ["六"] };
    await renderPage();

    const tile = tiles().find((word) => word.dataset.word === "item6") as HTMLElement;
    expect(tile).toHaveTextContent("六");
    await user.hover(tile);

    const layer = document.getElementById("vocabulary-translation") as HTMLElement;
    expect(within(layer).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the reviewed usage notes but not as positions in LR's list", async () => {
    const user = userEvent.setup();
    openWithDatabase();
    mocks.languageReactor.current = { casa: ["家", "房子", "住宅"] };
    await renderPage();

    const tile = tiles()[1];
    expect(tile).toHaveTextContent("家");
    await user.click(tile);

    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(within(card).getByRole("heading", { name: "词表用法" })).toBeInTheDocument();
    expect(card).toHaveTextContent("en casa 表示在家");
    // The meaning list itself is LR's, exactly three entries, in LR's order.
    expect(within(card).getAllByRole("listitem").slice(0, 3).map((item) => item.textContent)).toEqual(["家", "房子", "住宅"]);
  });

  it("offers the rail as fragment jumps to the bands, with no page in sight", async () => {
    openWithDatabase();
    await renderPage();

    const rail = screen.getByRole("navigation", { name: "按名次跳转" });
    expect(within(rail).getAllByRole("link")).toHaveLength(3);
    expect(within(rail).getByRole("link", { name: "跳到第 200 名" })).toHaveAttribute("href", "#vocabulary-band-101");
    // Which milestone is marked current follows the scroll position, so that
    // assertion lives where layout exists (the frame suite and the browser
    // check). Here: the rail deals in fragments, and never in pages.
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toContain("page=");
    }
  });

  it("converts a legacy paging deep link into the band fragment holding that rank", async () => {
    openWithDatabase();

    await expect(renderPage({ page: "42", pageSize: "24" })).rejects.toThrow("NEXT_REDIRECT:/read/vocabulary#vocabulary-band-901");
    // Page 2 of the default 24 starts at rank 25, inside the first band.
    await expect(renderPage({ page: "2" })).rejects.toThrow("NEXT_REDIRECT:/read/vocabulary#vocabulary-band-1");
    // A filtered list has no shelf ranks to convert to: keep the search, drop the page.
    await expect(renderPage({ search: "casa", page: "3", pageSize: "12" })).rejects.toThrow("NEXT_REDIRECT:/read/vocabulary?search=casa");
    expect(mocks.repository.listFrequencyWords).not.toHaveBeenCalled();
  });

  it("shows no view switcher and no view link anywhere on the page", async () => {
    openWithDatabase();
    await renderPage();

    expect(screen.queryByRole("navigation", { name: "词汇视图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "词汇表视图" })).not.toBeInTheDocument();
    for (const label of ["学习词表", "语料高频词", "正式词元"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    // The reading section navigation stays the single page-level navigation.
    expect(screen.getByRole("link", { name: "词汇" })).toHaveAttribute("aria-current", "page");
  });

  it("ignores ?view= instead of leaving a second behaviour reachable by URL", async () => {
    openWithDatabase();
    for (const view of ["study", "frequency", "lexicon"]) {
      cleanup();
      await renderPage({ view });

      expect(tiles()).toHaveLength(250);
      expect(screen.queryByRole("navigation", { name: "词汇视图" })).not.toBeInTheDocument();
      expect(screen.queryByText(/共 80 个已审核单词/u)).not.toBeInTheDocument();
    }
  });

  it("keeps exactly one page-level heading for assistive technology", async () => {
    openWithDatabase();
    await renderPage();

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("词汇");
    expect(headings[0]).toHaveClass("sr-only");
  });

  it("searches without carrying a view or a page parameter", async () => {
    openWithDatabase();
    await renderPage({ search: "casa" });

    const form = screen.getByRole("search") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/read/vocabulary");
    expect(form.querySelector('input[name="view"]')).toBeNull();
    expect(form.querySelector('input[name="page"]')).toBeNull();
    expect(within(form).getByLabelText("搜索词表")).toHaveValue("casa");
    expect(screen.getByRole("link", { name: "重置" })).toHaveAttribute("href", "/read/vocabulary");
    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledWith({ search: "casa", page: 1, pageSize: 7_922 });
    // A result set holds no shelf ranks, so it gets no bands and no rail.
    expect(screen.queryByRole("heading", { name: /排名/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "按名次跳转" })).not.toBeInTheDocument();
  });

  it("states honestly when the shelf cannot be read", async () => {
    await renderPage({ view: "frequency" });

    expect(screen.getByRole("heading", { name: "词汇表暂时不可用" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "按名次跳转" })).not.toBeInTheDocument();
    expect(mocks.repository.listFrequencyWords).not.toHaveBeenCalled();
  });

  it("tells a database outage apart from an empty result", async () => {
    openWithDatabase();
    mocks.repository.listFrequencyWords.mockRejectedValue(new Error("SHELF_LOAD_TIMEOUT"));

    await renderPage();

    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "词汇表暂时不可用" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "没有匹配的词" })).not.toBeInTheDocument();
  });

  it("reports a search that matches nothing, with the way back to the whole shelf", async () => {
    openWithDatabase();
    mocks.repository.listFrequencyWords.mockImplementation(async (query: { pageSize: number }) => ({ items: [], page: 1, pageSize: query.pageSize, total: 0 }));

    await renderPage({ search: "zzzz" });

    expect(screen.getByRole("heading", { name: "没有匹配的词" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到完整词表" })).toHaveAttribute("href", "/read/vocabulary");
  });
});
