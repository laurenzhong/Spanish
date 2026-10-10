import { cleanup, render, screen } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, onClick, prefetch, ...props }: { children: ReactNode; onClick?: MouseEventHandler<HTMLAnchorElement>; prefetch?: boolean | null } & Record<string, unknown>) => (
    <a {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }} data-prefetch={prefetch === true ? "full" : prefetch === false ? "disabled" : "auto"}>{children}</a>
  ),
}));

import ReadLoading from "@/app/(product)/read/loading";
import { ReadShelf } from "@/app/(product)/read/read-shelf";
import { ARTICLE_PAGE_SIZE } from "@/app/(product)/read/shelf-constants";
import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";

const articles: ArticleCardProjection[] = Array.from({ length: ARTICLE_PAGE_SIZE }, (_, index) => ({
  id: `article.test-${index}@1`,
  stableKey: `article.test-${index}`,
  version: 1,
  locale: "es-ES",
  title: `Historia ${index}`,
  summary: "Una historia para comparar el esqueleto con la página.",
  cefr: "A2",
  topics: ["topic.daily-life"],
  region: "es-ES",
  register: "neutral",
  format: "story",
  estimatedReadingMinutes: 4,
  sourceName: "Sueño Editorial",
  author: null,
  publicationDate: "2026-08-26",
  assets: { audio: false, chineseSummary: false, wordHelp: false, image: false },
  oralTransferType: "summary",
}));

const result: ArticleListResult = {
  articles,
  totalCount: articles.length,
  topics: ["topic.daily-life"],
  nextCursor: null,
  hasMore: false,
  savedFilterAvailable: false,
};

function classList(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []);
}

function childrenClasses(element: Element | null | undefined): string[][] {
  return Array.from(element?.children ?? []).map((child) => classList(child));
}

describe("reading shelf loading state", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the real reading navigation while the shelf loads", () => {
    render(<ReadLoading />);

    const navigation = screen.getByRole("navigation", { name: "阅读内容类型" });
    expect(Array.from(navigation.querySelectorAll("a")).map((link) => link.textContent)).toEqual(["文章", "词汇", "短语", "语料", "已保存"]);
    // The destination the user is on keeps its own underline, exactly like the
    // rendered page, so the swap does not move the underline.
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe("文章");
  });

  it("does not invent a heading or a placeholder tab row", () => {
    render(<ReadLoading />);

    // The old placeholder drew a visible heading bar and two tabs for a page
    // that has neither.
    expect(document.querySelector(".read-page-loading")).toBeNull();
    expect(document.querySelector(".read-page-loading__heading")).toBeNull();
    expect(document.querySelector(".read-page-loading__tabs")).toBeNull();
    // The only heading carrying text is the page's own screen-reader title;
    // the rest are the (hidden) per-row title boxes the real list has too.
    expect(screen.getAllByRole("heading", { hidden: true }).map((heading) => heading.textContent).filter(Boolean)).toEqual(["阅读"]);
  });

  it("mirrors the rendered shelf's structure box for box", () => {
    const loading = render(<ReadLoading />);
    const skeletonLibrary = loading.container.querySelector(".read-shelf-skeleton");
    const skeletonRows = loading.container.querySelectorAll(".read-article-row");
    const skeletonToolbar = childrenClasses(loading.container.querySelector(".read-library__toolbar"));
    const skeletonCells = childrenClasses(skeletonRows[0]);
    // The class names alone are not enough: the body's own line boxes have to
    // line up too, so compare those before this tree is unmounted.
    const skeletonBodyLines = childrenClasses(loading.container.querySelector(".read-shelf-skeleton .read-article-row__body"));
    const skeletonRowCount = skeletonRows.length;
    const skeletonResults = childrenClasses(loading.container.querySelector(".read-results"));
    // The rows are boxes, not articles: e2e selectors such as
    // `article.read-article-row` must keep matching only rendered rows.
    const skeletonArticles = loading.container.querySelectorAll("article.read-article-row").length;
    loading.unmount();

    const shelf = render(<ReadShelf result={result} page={1} pageSize={ARTICLE_PAGE_SIZE} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);
    const shelfRows = shelf.container.querySelectorAll(".read-article-row");

    // Same wrapper, same toolbar columns, same one-row-per-article list.
    expect(classList(skeletonLibrary)).toEqual(["read-library", "read-shelf-skeleton"]);
    expect(skeletonResults).toEqual(childrenClasses(shelf.container.querySelector(".read-results")));
    expect(skeletonToolbar).toEqual(childrenClasses(shelf.container.querySelector(".read-library__toolbar")));
    expect(skeletonRowCount).toBe(shelfRows.length);
    expect(skeletonArticles).toBe(0);
    // The row is the same three-cell grid: type cell, body, save action.
    expect(skeletonCells).toEqual(childrenClasses(shelfRows[0]));
    // ...and the body holds the same meta / title / rule / topic boxes.
    expect(skeletonBodyLines).toEqual(childrenClasses(shelf.container.querySelector(".read-article-row__body")));
  });
});
