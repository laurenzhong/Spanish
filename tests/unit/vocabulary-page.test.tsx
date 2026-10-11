import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  createRepository: vi.fn(),
  repository: { listFrequencyWords: vi.fn() },
}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: mocks.createRepository };
});

import VocabularyPage from "@/app/(product)/read/vocabulary/page";

const previousDatabaseUrl = process.env.DATABASE_URL;

const shelfPage = {
  items: [
    { id: "word:ser", word: "ser", normalizedWord: "ser", occurrenceCount: 2_659, context: "Ser uno mismo es difícil.", sourceTitle: "Podcast publicado" },
    { id: "word:casa", word: "casa", normalizedWord: "casa", occurrenceCount: 3, context: "Mi casa y tu casa son casa.", sourceTitle: "Podcast publicado" },
    { id: "word:neurociencia", word: "neurociencia", normalizedWord: "neurociencia", occurrenceCount: 0, context: null, sourceTitle: null },
  ],
  page: 1,
  pageSize: 24,
  total: 7_922,
};

async function renderPage(params: Record<string, string> = {}) {
  render(await VocabularyPage({ searchParams: Promise.resolve(params) }));
}

describe("vocabulary page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getDatabase.mockReturnValue({});
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.repository.listFrequencyWords.mockResolvedValue(shelfPage);
  });

  afterEach(() => {
    cleanup();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  function openWithDatabase() {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
  }

  it("renders the ranked shelf with the reviewed meanings and the honest placeholder", async () => {
    openWithDatabase();
    await renderPage();

    expect(screen.getByText(/按参考词频排序的 7922 个内容词/u)).toBeInTheDocument();
    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 24 });

    const words = within(screen.getByRole("list", { name: "词汇列表" })).getAllByRole("button");
    expect(words.map((word) => word.querySelector(".vocabulary-study__word-text")?.firstChild?.textContent)).toEqual(["ser", "casa", "neurociencia"]);
    // Two words carry the reviewed glossary meaning; the third keeps the
    // placeholder instead of an invented one.
    expect(words[0]).toHaveTextContent("是（说明身份、来源或本质）");
    expect(words[1]).toHaveTextContent("房子、家");
    expect(words[2]).toHaveTextContent("释义待补充");
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
      await renderPage({ view, search: "casa" });

      expect(screen.getByRole("list", { name: "词汇列表" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "词汇视图" })).not.toBeInTheDocument();
      expect(screen.queryByText(/共 80 个已审核单词/u)).not.toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "单词列表" })).not.toBeInTheDocument();
      for (const link of screen.getAllByRole("link")) {
        expect(link.getAttribute("href") ?? "").not.toContain("view=");
      }
    }
    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledWith({ search: "casa", page: 1, pageSize: 24 });
  });

  it("keeps exactly one page-level heading for assistive technology", async () => {
    openWithDatabase();
    await renderPage();

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("词汇");
    expect(headings[0]).toHaveClass("sr-only");
  });

  it("searches and pages through the shelf without carrying a view parameter", async () => {
    openWithDatabase();
    await renderPage({ search: "casa" });

    const form = screen.getByRole("search") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/read/vocabulary");
    expect(form.querySelector('input[name="view"]')).toBeNull();
    expect(within(form).getByLabelText("搜索词表")).toHaveValue("casa");
    expect(screen.getByRole("link", { name: "重置" })).toHaveAttribute("href", "/read/vocabulary");
    expect(mocks.repository.listFrequencyWords).toHaveBeenCalledWith({ search: "casa", page: 1, pageSize: 24 });

    const pagination = screen.getByRole("navigation", { name: "词句分页" });
    expect(within(pagination).getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/read/vocabulary?search=casa&pageSize=24&page=2");
  });

  it("states honestly when the shelf cannot be read", async () => {
    await renderPage({ view: "frequency" });

    expect(screen.getByRole("heading", { name: "词汇表暂时不可用" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "词汇列表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "词汇视图" })).not.toBeInTheDocument();
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
});
