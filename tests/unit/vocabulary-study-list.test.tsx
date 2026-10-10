import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

import { VocabularyStudyList } from "@/src/modules/reading/ui/vocabulary-study-list";

const words = [
  {
    id: "casa",
    headword: "casa",
    partOfSpeech: "名词",
    cefr: "A1",
    meanings: [{ meaning: "房子、家", usage: "en casa 表示在家" }],
    collocations: ["en casa"],
    examples: ["Hoy me quedo en casa."],
    forms: ["casas"],
    occurrenceCount: null,
  },
  {
    id: "querer",
    headword: "querer",
    partOfSpeech: "动词",
    cefr: "A1",
    meanings: [{ meaning: "想要、希望", usage: "后接名词或不定式" }],
    collocations: [],
    examples: [],
    forms: ["quiero"],
    occurrenceCount: null,
  },
] as const;

describe("vocabulary study list", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string;
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps every word directly learnable and filters by search", async () => {
    const user = userEvent.setup();
    render(<VocabularyStudyList words={words} storageScope="user-1" />);
    expect(screen.getByRole("button", { name: /casa/ })).toHaveTextContent("房子、家");
    expect(screen.getByRole("button", { name: /querer/ })).toHaveTextContent("想要、希望");

    await user.type(screen.getByRole("searchbox", { name: /搜索单词或释义/ }), "房子");
    expect(screen.getByRole("button", { name: /casa/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /querer/ })).not.toBeInTheDocument();
  });

  it("marks a word and keeps the mark in this browser", async () => {
    const user = userEvent.setup();
    render(<VocabularyStudyList words={words} storageScope="user-1" />);
    await user.click(screen.getByRole("button", { name: /casa/ }));

    const card = screen.getByRole("complementary", { name: "casa 学习卡片" });
    expect(within(card).getByText("房子、家")).toBeInTheDocument();
    expect(within(card).getByText("en casa 表示在家")).toBeInTheDocument();

    const marking = within(card).getByRole("group", { name: "标记 casa" });
    await user.click(within(marking).getByRole("button", { name: "✓ 已掌握" }));
    expect(within(marking).getByRole("button", { name: "✓ 已掌握" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("sueno:vocabulary-status:v1:user-1") ?? "{}")).toEqual({ casa: "familiar" });
    });
  });

  it("shows a real corpus example with its Chinese translation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        word: "casa",
        sentence: "Hoy me quedo en casa.",
        translation: "今天我待在家里。",
        sourceTitle: "Podcast diario",
        documentKind: "media",
        documentStableKey: "media.daily",
        documentVersion: 2,
        position: 7,
      },
    }), { status: 200 }));
    render(<VocabularyStudyList words={words} storageScope="user-1" />);
    await user.click(screen.getByRole("button", { name: /casa/ }));

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/read/vocabulary-example?word=casa"), expect.objectContaining({ credentials: "same-origin" }));
    const card = screen.getByRole("complementary", { name: "casa 学习卡片" });
    expect(await within(card).findByText("今天我待在家里。")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Podcast diario/ })).toHaveAttribute("href", "/learn/media/media.daily");
  });
});
