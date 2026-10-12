import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: vi.fn() };
});

import { PhraseLibrary, ReadSectionNavigation } from "@/src/modules/lexicon-corpus";

const phrase = {
  id: "20000000-0000-4000-8000-000000000001",
  expression: "¿Qué tal?",
  normalizedExpression: "que tal",
  scope: "public" as const,
  meaningZh: "怎么样？",
  pragmaticPurpose: "轻松问候",
  register: "neutral",
  region: "es-ES",
  cefr: "A2",
  variants: ["Que tal"],
  occurrenceCount: 1,
  representativeOccurrence: {
    leftContext: "Hola,",
    keyword: "¿Qué tal?",
    rightContext: "hoy?",
    sourceTitle: "Una conversación",
    sourceKind: "article-rss",
    document: { kind: "article" as const, stableKey: "article.one", version: 2 },
    location: { kind: "text" as const, paragraphId: "p1", segmentIndex: 0 },
    entryKind: "phrase" as const,
    entryId: "20000000-0000-4000-8000-000000000001",
    surfaceText: "¿Qué tal?",
  },
  intent: null,
  revision: 1,
};

describe("lexicon pages and controls", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("renders phrase purpose and honest empty states", () => {
    render(<PhraseLibrary items={[phrase]} />);
    expect(screen.getByRole("heading", { name: "¿Qué tal?" })).toBeInTheDocument();
    expect(screen.getByText("轻松问候")).toBeInTheDocument();
    expect(screen.getByText("公开")).toBeInTheDocument();
    expect(screen.getByText("Una conversación")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开来源" })).toHaveAttribute("href", "/read/article/article.one#segment-0");
    expect(screen.getByRole("link", { name: "在语料中查看全部用例" })).toHaveAttribute("href", "/read/corpus?entryKind=phrase&entryId=20000000-0000-4000-8000-000000000001");
    cleanup();
    // The empty state is the live phrase library's own (`VocabularyLibrary` and
    // the `?view=lexicon` shelf it belonged to were removed with the view).
    render(<PhraseLibrary items={[]} />);
    expect(screen.getByRole("heading", { name: "还没有短语" })).toBeInTheDocument();
  });

  it("shows an honest empty state when no representative occurrence is visible", () => {
    render(<PhraseLibrary items={[{ ...phrase, representativeOccurrence: null }]} />);
    expect(screen.getByText("暂无可见代表例句")).toBeInTheDocument();
  });

  it("labels private phrase entries without exposing ownership details", () => {
    render(<PhraseLibrary items={[{ ...phrase, scope: "private" }]} />);
    expect(screen.getByText("私有")).toBeInTheDocument();
    expect(screen.queryByText(/owner|userId/i)).not.toBeInTheDocument();
  });

  it("loads exact occurrence context and links back to the recorded position", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { items: [{
      leftContext: "Hola,", keyword: "¿Qué tal?", rightContext: "hoy?", sourceTitle: "Una historia", sourceKind: "article-rss",
      document: { kind: "article", stableKey: "article.one", version: 2 }, location: { kind: "text", paragraphId: "p2", segmentIndex: 1 },
      entryKind: "phrase", entryId: phrase.id, surfaceText: "¿Qué tal?",
    }], page: 1, pageSize: 6, total: 1 } }), { status: 200 }));
    // Through the live phrase library: `LexiconOccurrences` is shared with the
    // removed `VocabularyLibrary`, so its one interactive path is covered here.
    render(<PhraseLibrary items={[phrase]} total={1} />);
    await user.click(screen.getByRole("button", { name: "查看 ¿Qué tal? 的上下文" }));
    expect(await screen.findByText("Una historia")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到原文" })).toHaveAttribute("href", "/read/article/article.one#segment-1");
  });

  it("keeps the reading destinations visible", () => {
    render(<ReadSectionNavigation active="vocabulary" />);
    expect(screen.getByRole("link", { name: "文章" })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("link", { name: "词汇" })).toHaveAttribute("href", "/read/vocabulary");
    expect(screen.getByRole("link", { name: "短语" })).toHaveAttribute("href", "/read/phrases");
    expect(screen.getByRole("link", { name: "已保存" })).toHaveAttribute("href", "/read/saved-items");
    expect(screen.getByRole("link", { name: "语料" })).toHaveAttribute("href", "/read/corpus");
  });

  it("orders the reading navigation as content groups first and the personal shelf last", () => {
    render(<ReadSectionNavigation active="articles" />);
    const navigation = screen.getByRole("navigation", { name: "阅读内容类型" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["文章", "词汇", "短语", "语料", "已保存"]);
    expect(within(navigation).getByRole("link", { name: "文章" })).toHaveAttribute("aria-current", "page");
  });

  it("slides the single underline to the hovered item and back to the current page", () => {
    // jsdom has no layout engine, so every element reports the geometry the
    // indicator measures in the browser: 60px-wide tabs behind a container that
    // starts at the same origin.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("read-section-navigation")) return { left: 0, width: 300 } as DOMRect;
      if (this.tagName !== "A") return { left: 0, width: 0 } as DOMRect;
      const index = Array.from(this.parentElement?.querySelectorAll("a") ?? []).indexOf(this as HTMLAnchorElement);
      return { left: index * 60, width: 60 } as DOMRect;
    });
    render(<ReadSectionNavigation active="articles" />);
    const navigation = screen.getByRole("navigation", { name: "阅读内容类型" });
    const indicator = navigation.querySelector(".read-section-navigation__indicator");
    expect(indicator).not.toBeNull();

    expect(navigation).toHaveAttribute("data-indicator", "ready");
    expect(indicator).toHaveStyle({ transform: "translateX(0px) translateY(0px)", width: "60px", opacity: "1" });

    const links = within(navigation).getAllByRole("link");
    links[2].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(indicator).toHaveStyle({ transform: "translateX(120px) translateY(0px)", width: "60px" });

    // Leaving the navigation returns the underline to the current page.
    links[2].dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(indicator).toHaveStyle({ transform: "translateX(0px) translateY(0px)" });
  });
});
