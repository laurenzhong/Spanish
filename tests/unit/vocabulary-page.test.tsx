import { cleanup, render, screen } from "@testing-library/react";
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

  it("does not reintroduce the removed vocabulary header and view switcher", async () => {
    await renderPage();
    expect(screen.queryByRole("heading", { name: "可以马上开始学的西语词表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "词汇表视图" })).not.toBeInTheDocument();
    for (const label of ["学习词表", "语料高频词", "我的收藏", "正式词元", "已保存词句 ↗", "短语 ↗"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
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
    await renderPage({ view: "frequency" });
    expect(screen.getByRole("heading", { name: "语料高频词暂时不可用" })).toBeInTheDocument();
  });
});
