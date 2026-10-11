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

type ShelfPosition = Readonly<{ page?: number; pageSize?: number; total?: number; ranked?: boolean }>;

function renderShelf(scope: string, shelfItems: readonly VocabularyShelfItem[] = items, position: ShelfPosition = {}) {
  render(<VocabularyShelf
    items={shelfItems}
    storageScope={scope}
    page={position.page ?? 1}
    pageSize={position.pageSize ?? 24}
    total={position.total ?? 7_922}
    ranked={position.ranked ?? true}
  />);
}

/** A ranked page's words are grouped under the heading that names their band. */
function bandList(heading = "排名 1 - 100:"): HTMLElement {
  return screen.getByRole("list", { name: heading });
}

function rail() {
  return screen.getByRole("navigation", { name: "按名次跳转" });
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

    const words = within(bandList()).getAllByRole("button");
    // `ser` ranks above `vez` in the reference list even though `vez` is not the
    // rarer word in this fixture; the order must stay the server's.
    expect(words.map((word) => word.querySelector(".vocabulary-study__word-text")?.textContent?.trim())).toEqual([
      "ser",
      "casa",
      "vez",
    ]);
    // The tile deliberately carries no occurrence count. It used to be the sort
    // key; the order is the reference rank now, and a count beside a sorted list
    // reads as the sort key while being a surface-form count the corpus cannot
    // compute per lemma yet. Asserting its absence stops it returning unnoticed,
    // which simply deleting the old assertion would not.
    expect(words.map((word) => word.querySelector("small"))).toEqual([null, null, null]);
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
    // The card used to state an occurrence count here. It no longer does, and the
    // remaining honesty assertions above are untouched: what is asserted now is
    // that the card does not narrate a number it cannot compute correctly.
    expect(within(card).queryByText(/已发布内容出现/u)).toBeNull();
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

  it("heads each rank band and splits a page that crosses a band edge", () => {
    // Page 3 of 49 holds shelf ranks 99-101: two of them end band 1-100 and the
    // third opens band 101-200, so the page carries both headings.
    renderShelf("scope-band-edge", items, { page: 3, pageSize: 49 });

    expect(screen.getByRole("heading", { name: "排名 1 - 100:" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "排名 101 - 200:" })).toBeInTheDocument();
    expect(within(bandList("排名 1 - 100:")).getAllByRole("button")).toHaveLength(2);
    expect(within(bandList("排名 101 - 200:")).getAllByRole("button")).toHaveLength(1);
  });

  it("offers the reference rail as jump links to the page holding each milestone", () => {
    renderShelf("scope-rail");

    const links = within(rail()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["1", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1k", "2k", "3k", "4k", "5k", "6k", "7k"]);
    // The 1,000th content word is the 42nd page of 24; the 7,000th is the 292nd.
    expect(within(rail()).getByRole("link", { name: "跳到第 1k 名" })).toHaveAttribute("href", "/read/vocabulary?page=42&pageSize=24");
    expect(within(rail()).getByRole("link", { name: "跳到第 7k 名" })).toHaveAttribute("href", "/read/vocabulary?page=292&pageSize=24");
    // Rank 1 has passed milestone 1 and nothing else yet.
    expect(within(rail()).getByRole("link", { name: "跳到第 1 名" })).toHaveAttribute("aria-current", "true");
    expect(within(rail()).getByRole("link", { name: "跳到第 100 名" })).not.toHaveAttribute("aria-current");
  });

  it("marks the last milestone passed and names the real band on a deep page", () => {
    // Page 42 of 24 holds shelf ranks 985-1008, inside band 901-1000.
    renderShelf("scope-rail-deep", items, { page: 42, pageSize: 24 });

    expect(screen.getByRole("heading", { name: "排名 901 - 1000:" })).toBeInTheDocument();
    expect(within(rail()).getByRole("link", { name: "跳到第 900 名" })).toHaveAttribute("aria-current", "true");
    expect(within(rail()).getByRole("link", { name: "跳到第 1k 名" })).not.toHaveAttribute("aria-current");
  });

  it("clips the last band to the shelf and drops milestones past its end", () => {
    // The shelf's last rank is 7,922, so the final heading says 7901 - 7922
    // rather than claiming a hundred words that do not exist.
    renderShelf("scope-clip", items, { page: 331, pageSize: 24 });
    expect(screen.getByRole("heading", { name: "排名 7901 - 7922:" })).toBeInTheDocument();

    // A shelf that stops at rank 450 reaches the 400 milestone and no further.
    cleanup();
    renderShelf("scope-short", items, { total: 450 });
    expect(within(rail()).queryByRole("link", { name: "跳到第 500 名" })).not.toBeInTheDocument();
    expect(within(rail()).getByRole("link", { name: "跳到第 400 名" })).toBeInTheDocument();
  });

  it("hides the rail when there is only one page to jump through", () => {
    renderShelf("scope-single-page", items, { total: 3, pageSize: 24 });

    expect(screen.getByRole("heading", { name: "排名 1 - 3:" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "按名次跳转" })).not.toBeInTheDocument();
  });

  it("shows neither bands nor the rail for a filtered result set", () => {
    renderShelf("scope-search", items, { ranked: false });

    // A search result holds no shelf rank, so it is listed without a band
    // heading and without destinations that would imply one.
    expect(screen.getByRole("list", { name: "词汇列表" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /排名/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "按名次跳转" })).not.toBeInTheDocument();
  });

  it("reaches the rail with the keyboard, after the words it jumps past", async () => {
    const user = userEvent.setup();
    renderShelf("scope-keyboard");

    // Three word tiles, then the rail's first milestone: real links, no tab traps.
    for (let step = 0; step < 4; step += 1) await user.tab();
    expect(within(rail()).getByRole("link", { name: "跳到第 1 名" })).toHaveFocus();
  });
});
