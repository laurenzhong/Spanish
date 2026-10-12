import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

import ReadSectionLayout from "@/app/(product)/read/layout";
import ReadLoading from "@/app/(product)/read/loading";
import { activeReadSection } from "@/app/(product)/read/read-section-nav-host";
import VocabularyLoading from "@/app/(product)/read/vocabulary/loading";
import type { ReadSectionKey } from "@/src/modules/lexicon-corpus";

function navigation() {
  return screen.getByRole("navigation", { name: "阅读内容类型" });
}

function currentTab(): string | undefined {
  return navigation().querySelector('[aria-current="page"]')?.textContent ?? undefined;
}

describe("reading section layout", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/read");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("puts the section navigation in the section, not in each page", () => {
    render(<ReadSectionLayout><p>page content</p></ReadSectionLayout>);

    // One navigation, and it is the section's own link set.
    expect(within(navigation()).getAllByRole("link").map((link) => link.textContent)).toEqual(["文章", "词汇", "短语", "语料", "已保存"]);
    // The page's own content is rendered beside it, inside the same container,
    // which is the row that stacks the navigation above the content.
    const container = document.querySelector(".page-stack.read-page");
    expect(container).not.toBeNull();
    expect(container?.contains(navigation())).toBe(true);
    expect(within(container as HTMLElement).getByText("page content")).toBeInTheDocument();
  });

  it("keeps the navigation on screen while a route's loading state renders", () => {
    // This is the shape a transition has in the App Router: the layout stays
    // mounted and `loading.tsx` fills its children slot. The reading navigation
    // used to be inside the page, so this render had none at all.
    usePathname.mockReturnValue("/read/vocabulary");
    render(<ReadSectionLayout><VocabularyLoading /></ReadSectionLayout>);

    expect(screen.getAllByRole("navigation", { name: "阅读内容类型" })).toHaveLength(1);
    expect(currentTab()).toBe("词汇");
    // ...and the vocabulary loading state is what is showing below it.
    expect(screen.getByText("正在载入词汇表…")).toBeInTheDocument();
  });

  it("stays mounted for the article shelf's own loading state", () => {
    render(<ReadSectionLayout><ReadLoading /></ReadSectionLayout>);

    expect(screen.getAllByRole("navigation", { name: "阅读内容类型" })).toHaveLength(1);
    expect(currentTab()).toBe("文章");
  });

  it("marks the tab the URL belongs to", () => {
    const cases: readonly (readonly [string, ReadSectionKey])[] = [
      ["/read", "articles"],
      ["/read/", "articles"],
      ["/read/vocabulary", "vocabulary"],
      ["/read/vocabulary/", "vocabulary"],
      ["/read/phrases", "phrases"],
      ["/read/corpus", "corpus"],
      ["/read/saved-items", "saved-items"],
      ["/read/saved", "saved-items"],
      // Not destinations of their own: an article is read, and the private story
      // generator produces one, so both keep 文章 current instead of leaving the
      // navigation with nothing underlined.
      ["/read/article/article.one", "articles"],
      ["/read/article/article.one%401", "articles"],
      ["/read/generate", "articles"],
      // Anything unexpected under the section falls back to where it starts.
      ["/read/something-new", "articles"],
    ];

    expect(cases.map(([pathname]) => activeReadSection(pathname))).toEqual(cases.map(([, key]) => key));

    for (const [pathname, key] of cases) {
      usePathname.mockReturnValue(pathname);
      const rendered = render(<ReadSectionLayout><span /></ReadSectionLayout>);
      const labels: Record<ReadSectionKey, string> = {
        articles: "文章",
        vocabulary: "词汇",
        phrases: "短语",
        corpus: "语料",
        "saved-items": "已保存",
      };
      expect(currentTab()).toBe(labels[key]);
      rendered.unmount();
    }
  });
});

describe("vocabulary loading state", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reads as vocabulary, not as a learning position", () => {
    render(<VocabularyLoading />);

    expect(screen.getByText("正在载入词汇表…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    // The shared surface state's copy talks about a learning position this page
    // does not have, and the owner read it as the wrong product area.
    expect(document.body.textContent).not.toContain("学习位置");
    expect(document.body.textContent).not.toContain("正在准备内容");
    // The page's own heading, so the outline does not lose its h1 while loading.
    expect(screen.getAllByRole("heading", { hidden: true }).map((heading) => heading.textContent)).toEqual(["词汇"]);
  });

  it("is shaped like the shelf: rank bands with tiles under them", () => {
    const { container } = render(<VocabularyLoading />);

    const bands = container.querySelectorAll(".vocabulary-shelf__band");
    const headings = container.querySelectorAll(".vocabulary-rank-band");
    const tiles = container.querySelectorAll(".vocabulary-study__word");
    expect(bands).toHaveLength(2);
    expect(Array.from(headings).map((heading) => heading.textContent)).toEqual(["排名 1 - 100:", "排名 101 - 200:"]);
    expect(tiles).toHaveLength(24);
    expect(Array.from(tiles).every((tile) => tile.tagName === "DIV")).toBe(true);
    // The real tiles are buttons and carry `data-word-key`; a placeholder that
    // claimed either would be counted as a word by the page's own selectors.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("[data-word-key]")).toHaveLength(0);
  });

  it("renders no navigation of its own and does not take the viewport", () => {
    const { container } = render(<VocabularyLoading />);

    expect(screen.queryByRole("navigation")).toBeNull();
    // Page-scoped: the section layout provides the chrome, so the fallback is a
    // page-height block rather than a full-screen overlay.
    expect(container.querySelector(".lexicon-shelf")).not.toBeNull();
    expect(container.querySelector(".surface-state")).toBeNull();
  });
});
