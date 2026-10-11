import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VocabularyShelf, type VocabularyShelfGlossary } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";
import { VocabularyShelfList, type VocabularyShelfItem } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf-list";
import { groupRanks } from "@/src/modules/lexicon-corpus/ui/vocabulary-rank";

/**
 * Two reviewed meanings, in the reviewed file's own order. The glossary has no
 * frequency field, so this order is the only order there is to show — and the
 * first one is the meaning the tile already carries underneath the word.
 */
const glossary: Record<string, VocabularyShelfGlossary> = {
  casa: {
    cefr: "A1",
    partOfSpeech: "名词",
    meanings: [{ meaning: "房子、家", usage: "en casa 表示在家" }, { meaning: "家、住所", usage: "" }],
    collocations: ["en casa"],
    examples: ["Hoy me quedo en casa."],
    forms: ["casas"],
  },
};

const items: readonly VocabularyShelfItem[] = [
  { id: "word:ser", markKey: "ser", text: "ser", context: "Ser uno mismo es difícil.", source: "Podcast publicado", meaning: null },
  { id: "word:casa", markKey: "casa", text: "casa", context: "Mi casa y tu casa son casa.", source: "Podcast publicado", meaning: "房子、家" },
  { id: "word:vez", markKey: "vez", text: "vez", context: null, source: null, meaning: null },
];

/** Enough rows to prove the shelf is rendered whole and split across bands. */
const manyItems: readonly VocabularyShelfItem[] = Array.from({ length: 105 }, (_, index) => ({
  id: `word:item${index}`,
  markKey: `item${index}`,
  text: `item${index}`,
  context: null,
  source: null,
  meaning: null,
}));

type ShelfOptions = Readonly<{ ranked?: boolean; total?: number }>;

function renderShelf(scope: string, shelfItems: readonly VocabularyShelfItem[] = items, options: ShelfOptions = {}) {
  const ranked = options.ranked ?? true;
  const total = options.total ?? 7_922;
  const bands = ranked ? groupRanks(shelfItems, 1, total).map((group) => group.band) : [];
  render(<VocabularyShelf storageScope={scope} glossary={glossary} bands={bands} total={total} ranked={ranked}>
    <VocabularyShelfList items={shelfItems} ranked={ranked} total={total} />
  </VocabularyShelf>);
}

function wordTile(text: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(text) });
}

function rail() {
  return screen.getByRole("navigation", { name: "按名次跳转" });
}

function translation() {
  return screen.queryByRole("tooltip");
}

/** The card's meaning list only: the card also carries a glossary example list. */
function cardMeanings(card: HTMLElement): readonly string[] {
  return [...card.querySelectorAll<HTMLElement>(".vocabulary-study__meanings li")].map((item) => item.textContent ?? "");
}

const speechSpeak = vi.fn();

describe("vocabulary shelf", () => {
  beforeEach(() => {
    window.localStorage.clear();
    speechSpeak.mockClear();
    // jsdom only ships requestAnimationFrame when it is built with
    // `pretendToBeVisual`; the frame throttles its scroll marker with it.
    if (typeof window.requestAnimationFrame !== "function") {
      Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0) });
      Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: (handle: number) => window.clearTimeout(handle) });
    }
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

  it("renders the whole shelf at once, split into its rank bands, with no paging and no count", () => {
    renderShelf("scope-whole", manyItems, { total: 105 });

    expect(screen.getByRole("heading", { name: "排名 1 - 100:" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "排名 101 - 105:" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "排名 1 - 100:" })).getAllByRole("button")).toHaveLength(100);
    expect(within(screen.getByRole("list", { name: "排名 101 - 105:" })).getAllByRole("button")).toHaveLength(5);
    // Every word of the shelf is on the page: no pagination control anywhere.
    expect(screen.getAllByRole("button")).toHaveLength(105);
    expect(screen.queryByRole("navigation", { name: "词句分页" })).not.toBeInTheDocument();
    // The occurrence count is gone and must not come back with the full render.
    expect(document.querySelectorAll(".vocabulary-study__word small")).toHaveLength(0);
  });

  it("keeps the reference order it is given and the translation under each word", () => {
    renderShelf("scope-order");

    const words = within(screen.getByRole("list", { name: "排名 1 - 100:" })).getAllByRole("button");
    expect(words.map((word) => word.querySelector(".vocabulary-study__word-text")?.textContent)).toEqual(["ser", "casa", "vez"]);
    expect(wordTile("casa")).toHaveTextContent("房子、家");
    expect(wordTile("ser")).toHaveTextContent("释义待补充");
  });

  it("shows every reviewed meaning on hover, in the reviewed order, and describes the tile for assistive tech", async () => {
    const user = userEvent.setup();
    renderShelf("scope-hover");

    await user.hover(wordTile("casa"));

    const tooltip = translation();
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveTextContent("casa");
    // The reviewed file has no frequency field: its own order is what is shown,
    // and the first meaning is the one already under the word.
    expect(within(tooltip as HTMLElement).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["房子、家en casa 表示在家", "家、住所"]);
    expect(wordTile("casa")).toHaveAttribute("aria-describedby", "vocabulary-translation");    // `title` is not the mechanism: keyboard and touch cannot reach it.
    expect(wordTile("casa")).not.toHaveAttribute("title");
  });

  it("shows the same translation on keyboard focus", async () => {
    const user = userEvent.setup();
    renderShelf("scope-focus");

    // The first tile in order is `ser`, which has no reviewed meaning: focusing
    // it must not invent one.
    await user.tab();
    expect(wordTile("ser")).toHaveFocus();
    expect(translation()).toBeNull();

    await user.tab();
    expect(wordTile("casa")).toHaveFocus();
    expect(translation()).toHaveTextContent("房子、家");
    expect(wordTile("casa")).toHaveAttribute("aria-describedby", "vocabulary-translation");
  });

  it("follows its word when the page scrolls, and drops the translation once that word leaves view", async () => {
    const user = userEvent.setup();
    const tops = new Map<HTMLElement, number>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = tops.get(this) ?? 100;
      return { top, bottom: top + 74, left: 40, right: 240, width: 200, height: 74, x: 40, y: top, toJSON: () => ({}) } as DOMRect;
    });

    renderShelf("scope-follow");
    const tile = wordTile("casa");
    await user.hover(tile);
    const tooltip = translation() as HTMLElement;
    expect(tooltip.style.top).toBe("182px");

    // The word scrolls up: the fixed layer moves with it instead of hanging over
    // whatever word happens to be at the old coordinate.
    tops.set(tile, 40);
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(tooltip.style.top).toBe("122px"));

    // Once the word is off-screen there is nothing to point at.
    tops.set(tile, -400);
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(translation()).toBeNull());
  });

  it("lets another word be clicked while the translation is showing", async () => {
    const user = userEvent.setup();
    renderShelf("scope-neighbour");

    await user.hover(wordTile("casa"));
    expect(translation()).not.toBeNull();

    await user.click(wordTile("vez"));
    expect(screen.getByRole("complementary", { name: "vez 词汇卡片" })).toBeInTheDocument();
    // The floating layer never receives the click meant for the word.
    expect(translation()).toBeNull();
  });

  it("opens the card with the meanings and the one published example, and closes it again", async () => {
    const user = userEvent.setup();
    renderShelf("scope-card");

    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(within(card).getByText("已审核词表 · A1 · 名词")).toBeInTheDocument();
    expect(cardMeanings(card)).toEqual(["房子、家en casa 表示在家", "家、住所"]);
    expect(within(card).getByText("Mi casa y tu casa son casa.")).toBeInTheDocument();
    expect(within(card).getByText("Podcast publicado")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "朗读单词" })).toBeInTheDocument();

    await user.click(wordTile("casa"));
    expect(screen.queryByRole("complementary", { name: "casa 词汇卡片" })).not.toBeInTheDocument();
  });

  it("states honestly when a word has no reviewed meaning or published example", async () => {
    const user = userEvent.setup();
    renderShelf("scope-honest");

    await user.click(wordTile("vez"));
    const card = screen.getByRole("complementary", { name: "vez 词汇卡片" });
    expect(within(card).getByText("这个词还没有审核过的中文释义，先按下面的语境理解它。")).toBeInTheDocument();
    expect(within(card).getByText("已发布内容中暂时没有收录这个词的例句。")).toBeInTheDocument();
    expect(within(card).queryByText(/已发布内容出现/u)).toBeNull();
  });

  it("marks a word in this browser and decorates its server-rendered tile", async () => {
    const user = userEvent.setup();
    renderShelf("scope-mark");

    await user.click(wordTile("casa"));
    const marking = within(screen.getByRole("complementary", { name: "casa 词汇卡片" })).getByRole("group", { name: "标记 casa" });
    await user.click(within(marking).getByRole("button", { name: "已熟悉" }));

    expect(wordTile("casa")).toHaveClass("is-familiar");
    expect(screen.getByText(/已标记 1 个/u)).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("sueno:vocabulary-status:v1:scope-mark") ?? "{}")).toEqual({ casa: "familiar" });
    });

    await user.click(within(marking).getByRole("button", { name: "已熟悉" }));
    expect(wordTile("casa")).not.toHaveClass("is-familiar");
  });

  it("shows a mark made in another session of the same scope without a click", () => {
    window.localStorage.setItem("sueno:vocabulary-status:v1:scope-known", JSON.stringify({ casa: "revisit" }));

    renderShelf("scope-known");

    expect(wordTile("casa")).toHaveClass("is-revisit");
    expect(screen.getByText(/已标记 1 个/u)).toBeInTheDocument();
  });

  it("turns the rail into band fragments and moves its marker with the band in view", async () => {
    // jsdom has no layout, so give the bands a geometry before the frame measures
    // them: band 1 at the document top, band 101 one viewport and a bit below.
    // Rect tops are viewport-relative, hence the scrollY subtraction.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const documentTop = Number(this.dataset.bandStart ?? "0") === 101 ? 2_000 : 0;
      const top = documentTop - window.scrollY;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });

    renderShelf("scope-rail", manyItems, { total: 105 });

    expect(within(rail()).getByRole("link", { name: "跳到第 1 名" })).toHaveAttribute("href", "#vocabulary-band-1");
    expect(within(rail()).getByRole("link", { name: "跳到第 100 名" })).toHaveAttribute("href", "#vocabulary-band-1");
    expect(within(rail()).getByRole("link", { name: "跳到第 1 名" })).toHaveAttribute("aria-current", "true");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 2_100 });
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(within(rail()).getByRole("link", { name: "跳到第 100 名" })).toHaveAttribute("aria-current", "true");
    });
  });

  it("offers no bands and no rail for a search result", () => {
    renderShelf("scope-search", items, { ranked: false, total: 3 });

    expect(screen.getByRole("list", { name: "词汇列表" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /排名/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "按名次跳转" })).not.toBeInTheDocument();
  });

  it("uses the shared lexicon wording for the three states and reads the word aloud", async () => {
    const user = userEvent.setup();
    renderShelf("scope-wording");

    await user.click(wordTile("ser"));
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
