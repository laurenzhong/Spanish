import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VocabularyShelf, type VocabularyShelfItem } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";

const glossary = {
  cefr: "A1",
  partOfSpeech: "名词",
  meanings: [{ meaning: "房子、家", usage: "en casa 表示在家" }],
  collocations: ["en casa"],
  examples: ["Hoy me quedo en casa."],
  forms: ["casas"],
} as const;

/**
 * Deliberately not in count order: the shelf's order is the reference rank the
 * server sends, so a component that re-sorted by our own counts would fail.
 */
const items: readonly VocabularyShelfItem[] = [
  { id: "word:ser", markKey: "ser", text: "ser", count: 2_659, context: "Ser uno mismo es difícil.", source: "Podcast publicado", glossary: null },
  { id: "word:casa", markKey: "casa", text: "casa", count: 3, context: "Mi casa y tu casa son casa.", source: "Podcast publicado", glossary },
  { id: "word:vez", markKey: "vez", text: "vez", count: 1_956, context: null, source: null, glossary: null },
];

function renderShelf(scope: string, shelfItems: readonly VocabularyShelfItem[] = items) {
  render(<VocabularyShelf items={shelfItems} storageScope={scope} />);
}

function wordButton(text: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(text) });
}

const speechSpeak = vi.fn();

describe("vocabulary shelf", () => {
  beforeEach(() => {
    window.localStorage.clear();
    speechSpeak.mockClear();
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string;
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak: speechSpeak, getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the reference-rank order it is given instead of re-sorting by our counts", () => {
    renderShelf("scope-order");

    const words = within(screen.getByRole("list", { name: "词汇列表" })).getAllByRole("button");
    // `ser` ranks above `vez` in the reference list even though `vez` is not the
    // rarer word in this fixture; the order must stay the server's.
    expect(words.map((word) => word.textContent?.split(/\s+/u)[0])).toEqual(["ser", "casa", "vez"]);
    expect(words.map((word) => word.querySelector("small")?.textContent?.trim())).toEqual(["2659", "3", "1956"]);
  });

  it("shows the reviewed meaning and keeps the placeholder for words without one", () => {
    renderShelf("scope-meaning");

    expect(wordButton("casa")).toHaveTextContent("房子、家");
    expect(wordButton("ser")).toHaveTextContent("释义待补充");
    // Nothing is invented for a word the reviewed glossary does not cover.
    expect(screen.queryByText(/ser.*(是|存在)/u)).not.toBeInTheDocument();
  });

  it("marks a word in this browser under the study shelf's storage contract", async () => {
    const user = userEvent.setup();
    renderShelf("scope-mark");

    await user.click(wordButton("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    const marking = within(card).getByRole("group", { name: "标记 casa" });
    expect(marking.querySelectorAll("button")).toHaveLength(3);

    await user.click(within(marking).getByRole("button", { name: "已熟悉" }));
    expect(within(marking).getByRole("button", { name: "已熟悉" })).toHaveAttribute("aria-pressed", "true");
    expect(within(marking).getByText("当前：已熟悉")).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("sueno:vocabulary-status:v1:scope-mark") ?? "{}")).toEqual({ casa: "familiar" });
    });
    // The mark is the reader's own: it survives as long as the browser keeps it.
    expect(screen.getByText(/已标记 1 个 · 标记保存在本机浏览器/u)).toBeInTheDocument();
  });

  it("keeps marks apart per account scope and shows an existing mark without a click", () => {
    window.localStorage.setItem("sueno:vocabulary-status:v1:scope-known", JSON.stringify({ casa: "revisit" }));

    renderShelf("scope-known");
    const marked = wordButton("casa");
    expect(marked).toHaveClass("is-revisit");
    expect(screen.getByText(/已标记 1 个/u)).toBeInTheDocument();
  });

  it("carries the published example and the reviewed glossary extras into the card", async () => {
    const user = userEvent.setup();
    renderShelf("scope-card");

    await user.click(wordButton("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(within(card).getByText("已审核词表 · A1 · 名词", { exact: false })).toBeInTheDocument();
    expect(within(card).getByText("房子、家")).toBeInTheDocument();
    expect(within(card).getByText("en casa 表示在家")).toBeInTheDocument();
    expect(within(card).getByText("en casa")).toBeInTheDocument();
    expect(within(card).getByText("Hoy me quedo en casa.")).toBeInTheDocument();
    // The one example path: the published segment the shelf already carries.
    const corpus = card.querySelector(".vocabulary-study__corpus");
    expect(corpus).not.toBeNull();
    expect(within(corpus as HTMLElement).getByText("Mi casa y tu casa son casa.")).toBeInTheDocument();
    expect(within(corpus as HTMLElement).getByText("Podcast publicado")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "朗读单词" })).toBeInTheDocument();
  });

  it("states honestly when a word has no published example or reviewed meaning", async () => {
    const user = userEvent.setup();
    renderShelf("scope-honest");

    await user.click(wordButton("vez"));
    const card = screen.getByRole("complementary", { name: "vez 词汇卡片" });
    expect(within(card).getByText("已发布内容中暂时没有收录这个词的例句。")).toBeInTheDocument();
    expect(within(card).getByText("这个词还没有审核过的中文释义，先按下面的语境理解它。")).toBeInTheDocument();
    expect(within(card).getByText(/已发布内容出现 1956 次/u)).toBeInTheDocument();
  });

  it("uses the shared lexicon wording for the three states and reads the word aloud", async () => {
    const user = userEvent.setup();
    renderShelf("scope-wording");

    await user.click(wordButton("ser"));
    const card = screen.getByRole("complementary", { name: "ser 词汇卡片" });
    const marking = within(card).getByRole("group", { name: "标记 ser" });
    for (const label of ["已熟悉", "想复现", "暂不学习"]) {
      expect(within(marking).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(marking).queryByRole("button", { name: /掌握|学习中/ })).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "朗读单词" }));
    expect(speechSpeak).toHaveBeenCalledTimes(1);
  });
});
