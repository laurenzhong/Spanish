import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: vi.fn() };
});

import { PhraseLibrary, ReadSectionNavigation, VocabularyLibrary } from "@/src/modules/lexicon-corpus";

const vocabulary = {
  id: "10000000-0000-4000-8000-000000000001",
  lemma: "comer",
  normalizedLemma: "comer",
  partOfSpeech: "verb",
  lemmaStatus: "verified" as const,
  meaningZh: "吃",
  forms: ["comer", "comiendo"],
  occurrenceCount: 2,
  intent: null,
  revision: 1,
};
const phrase = {
  id: "20000000-0000-4000-8000-000000000001",
  expression: "¿Qué tal?",
  normalizedExpression: "que tal",
  meaningZh: "怎么样？",
  pragmaticPurpose: "轻松问候",
  register: "neutral",
  region: "es-ES",
  cefr: "A2",
  variants: ["Que tal"],
  occurrenceCount: 1,
  intent: null,
  revision: 1,
};

describe("lexicon pages and controls", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("renders vocabulary metadata and updates a personal intent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { revision: 2 } }), { status: 200 }));
    const user = userEvent.setup();
    render(<VocabularyLibrary items={[vocabulary]} />);
    expect(screen.getByRole("heading", { name: "comer" })).toBeInTheDocument();
    expect(screen.getByText("2 个出现")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "想复现" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(vocabulary.id), expect.objectContaining({ method: "PUT" })));
    expect(screen.getByRole("button", { name: "想复现" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders phrase purpose and honest empty states", () => {
    render(<PhraseLibrary items={[phrase]} />);
    expect(screen.getByRole("heading", { name: "¿Qué tal?" })).toBeInTheDocument();
    expect(screen.getByText("轻松问候")).toBeInTheDocument();
    render(<VocabularyLibrary items={[]} />);
    expect(screen.getByRole("heading", { name: "还没有词汇" })).toBeInTheDocument();
  });

  it("loads exact occurrence context and links back to the recorded position", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { items: [{
      leftContext: "Quiero", keyword: "comer", rightContext: "contigo.", sourceTitle: "Una historia", sourceKind: "article-rss",
      document: { kind: "article", stableKey: "article.one", version: 2 }, location: { kind: "text", paragraphId: "p2", segmentIndex: 1 },
      entryKind: "lexeme", entryId: vocabulary.id, surfaceText: "comer",
    }], page: 1, pageSize: 6, total: 1 } }), { status: 200 }));
    render(<VocabularyLibrary items={[vocabulary]} total={1} />);
    await user.click(screen.getByRole("button", { name: "查看 comer 的上下文" }));
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
