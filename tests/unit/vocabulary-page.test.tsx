import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: vi.fn() };
});

import VocabularyPage from "@/app/(product)/read/vocabulary/page";

const previousDatabaseUrl = process.env.DATABASE_URL;

async function renderPage(params: Record<string, string> = {}) {
  render(await VocabularyPage({ searchParams: Promise.resolve(params) }));
}

describe("vocabulary page", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    cleanup();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("shows a study list that is usable without reading the database", async () => {
    await renderPage();
    expect(screen.getByText(/共 \d+ 个已审核单词/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /casa/ })).toHaveTextContent("房子、家");
  });

  it("renders exactly one view switcher under the page heading", async () => {
    await renderPage();
    expect(screen.queryByRole("heading", { name: "可以马上开始学的西语词表" })).not.toBeInTheDocument();
    // The old six-entry switcher is gone; the new one is a labelled navigation
    // of three URL views, not a second page-level landmark.
    expect(screen.queryByRole("navigation", { name: "词汇表视图" })).not.toBeInTheDocument();
    const switcher = screen.getByRole("navigation", { name: "词汇视图" });
    expect(within(switcher).getAllByRole("link").map((link) => link.textContent)).toEqual(["学习词表", "语料高频词", "正式词元"]);
    // The reading section navigation stays the single page-level navigation.
    expect(screen.getByRole("link", { name: "词汇" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps exactly one page-level heading for assistive technology", async () => {
    await renderPage();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("词汇");
    expect(headings[0]).toHaveClass("sr-only");
  });

  it("states honestly when a non-default vocabulary view is opened by URL", async () => {
    await renderPage({ view: "frequency", search: "casa", pageSize: "12" });
    expect(await screen.findByRole("heading", { name: "语料高频词暂时不可用" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "语料高频词" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "学习词表" })).not.toHaveAttribute("aria-current");
    // Switching is a navigation that keeps the reader's search and page size
    // and drops the current page, which belonged to the view being left.
    expect(screen.getByRole("link", { name: "学习词表" })).toHaveAttribute("href", "/read/vocabulary?view=study&search=casa&pageSize=12");
  });
});
