import { readAloudFake as speech } from "../helpers/read-aloud-fake";
vi.mock("@/src/modules/providers/tts/read-aloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/providers/tts/read-aloud")>();
  const { readAloudFake } = await import("../helpers/read-aloud-fake");
  return { ...actual, createReadAloud: readAloudFake.create };
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VocabularyShelf, type VocabularyShelfGlossary } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";
import { VocabularyShelfList, type VocabularyShelfItem } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf-list";
import { groupRanks } from "@/src/modules/lexicon-corpus/ui/vocabulary-rank";
import { shelfItem } from "@/src/modules/lexicon-corpus/ui/word-entry";
import { findCommonGlossaryEntry } from "@/src/modules/reading/domain/common-glossary";

/**
 * jsdom ships no IntersectionObserver. The frame watches a single line near the
 * top of the viewport to know which band the reader is in, so the test drives
 * that line directly instead of pretending to scroll.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets: Element[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void { this.targets.push(target); }
  unobserve(): void { /* nothing to do */ }
  disconnect(): void { this.targets.length = 0; }
  takeRecords(): IntersectionObserverEntry[] { return []; }

  enter(target: Element): void {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

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
    // Tatoeba's example, with the sentence's and the translation's own attribution:
    // the panel must show the credit, so the fixture carries what the asset holds.
    tatoeba: [{
      text: "Hoy me quedo en casa.",
      translation: "今天我呆在家里。",
      sentenceId: 1234567,
      sentenceLicense: "CC BY 2.0 FR",
      sentenceOwner: "Shishir",
      translationId: 7654321,
      translationLicense: "CC BY 2.0 FR",
      translationOwner: "sadhen",
      isDirect: true,
      tags: ["whole-token", "script-hans"],
      // This sentence contains the headword itself, so no inflected form is named.
      matchedForm: null,
      audio: { id: 505729, author: "arh", license: "CC BY-NC-ND 3.0", attributionUrl: "https://tatoeba.org/user/profile/arh", url: "https://api.tatoeba.org/v1/audios/505729/file" },
    }],
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

type ShelfOptions = Readonly<{
  ranked?: boolean;
  total?: number;
  /** Language Reactor's translations by mark key, as the page passes them. */
  dictionary?: Readonly<Record<string, readonly string[]>>;
  /** The reviewed entries the page passes; defaults to the shared `casa` fixture. */
  glossary?: Readonly<Record<string, VocabularyShelfGlossary>>;
}>;

function renderShelf(scope: string, shelfItems: readonly VocabularyShelfItem[] = items, options: ShelfOptions = {}) {
  const ranked = options.ranked ?? true;
  const total = options.total ?? 7_922;
  const bands = ranked ? groupRanks(shelfItems, 1, total).map((group) => group.band) : [];
  return render(<VocabularyShelf storageScope={scope} glossary={options.glossary ?? glossary} dictionary={options.dictionary ?? {}} bands={bands} total={total} ranked={ranked}>
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
/**
 * The panel's meaning rows, read per meaning rather than per row: the panel keeps
 * one main meaning on its own and the rest on a single row, so counting rows would
 * measure the layout instead of the meanings. The `·` separators are drawn by CSS
 * and are not elements, so nothing has to be filtered out here.
 */
function cardMeanings(card: HTMLElement): readonly string[] {
  return [...card.querySelectorAll<HTMLElement>(
    ".vocabulary-study__meaning-main strong, .vocabulary-study__meaning-terms li",
  )].map((item) => item.textContent ?? "");
}

const speechSpeak = speech.speak;

/**
 * jsdom has no media pipeline, so the frame's one `HTMLAudioElement` is this
 * stand-in: it records what was asked of it and lets the test drive the clock
 * the frame watches (`currentTime`) and the end the media reports (`ended`).
 */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  currentTime = 0;
  preload = "";
  ended = false;
  onended: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onwaiting: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly play = vi.fn(() => Promise.resolve());
  readonly pause = vi.fn();
  readonly load = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();

  constructor() {
    FakeAudio.instances.push(this);
  }
}

type WordAudioReply = Readonly<{ ok: boolean; status: number; body: unknown }>;

/** The route's answer for the word under test; each test sets its own. */
let wordAudioReply: WordAudioReply;

type FetchReply = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** The lookup route's answer for the word under test; each test sets its own. */
let wordLookupReply: FetchReply | null = null;

/**
 * One stub for both routes, told apart by URL: reading a word and looking one up are
 * different requests with different answers, and a stub that answered both the same
 * way would let a wiring mistake pass.
 */
const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<FetchReply>>(async (input) => {
  if (String(input).includes("word-lookup")) {
    if (!wordLookupReply) throw new Error("the test did not stage a lookup reply");
    return wordLookupReply;
  }
  return { ok: wordAudioReply.ok, status: wordAudioReply.status, json: async () => wordAudioReply.body };
});

/**
 * The fetch calls made to one endpoint.
 *
 * Opening a word now makes two requests — its recording, and once per word Tatoeba's examples
 * — so a test that asserts "the sound was asked for once" must count that request rather than
 * every request.
 */
function callsTo(endpoint: string): readonly (readonly [string, RequestInit])[] {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(endpoint)) as readonly (readonly [string, RequestInit])[];
}

/** The route's `{ apiVersion, data }` envelope, carrying a clip of real speech. */
function clipReply(overrides: Readonly<Record<string, unknown>> = {}): WordAudioReply {
  return {
    ok: true,
    status: 200,
    body: {
      apiVersion: "v1",
      data: {
        outcome: "clip",
        clip: {
          url: "https://media.example/casa.m4a",
          expiresAt: null,
          startMs: 1_200,
          stopAtMs: 2_400,
          segmentStartMs: 1_000,
          segmentEndMs: 6_000,
          segmentIndex: 0,
          stableKey: "media:podcast-1",
          sourceTitle: "Podcast publicado",
          segmentText: "Mi casa y tu casa son casa.",
          ...overrides,
        },
      },
    },
  };
}

/** The route's answer when the corpus holds no recording of the word. */
const syntheticReply: WordAudioReply = {
  ok: true,
  status: 200,
  body: { apiVersion: "v1", data: { outcome: "synthetic", reason: "no_example" } },
};


describe("vocabulary shelf", () => {
  it("reads only suponer with Spanish TTS even when a media clip is available", async () => {
    const user = userEvent.setup();
    wordAudioReply = clipReply({ startMs: 164160, stopAtMs: 164930 });
    renderShelf("scope-suponer", [{ id: "word:suponer", markKey: "suponer", text: "suponer", context: "Una frase del podcast con suponer.", source: "Podcast publicado", meaning: null }]);

    await user.click(wordTile("suponer"));
    expect(speechSpeak).toHaveBeenCalledTimes(1);
    const utterance = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("suponer");
    expect(utterance.lang).toBe("es-ES");
    expect(callsTo("word-audio")).toHaveLength(0);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(screen.queryByText(/原声 · Podcast/u)).not.toBeInTheDocument();
  });

  beforeEach(() => {
    window.localStorage.clear();
    speech.reset();
    FakeIntersectionObserver.instances.length = 0;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    // Nothing is read aloud unless a test asks for it: the default reply is the
    // route's "no recording for this word" answer.
    FakeAudio.instances.length = 0;
    wordAudioReply = syntheticReply;
    wordLookupReply = null;
    fetchMock.mockClear();
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("fetch", fetchMock);
    // jsdom only ships requestAnimationFrame when it is built with
    // `pretendToBeVisual`; the frame throttles its scroll marker with it.
    if (typeof window.requestAnimationFrame !== "function") {
      Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0) });
      Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: (handle: number) => window.clearTimeout(handle) });
    }

  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders every word it is given, in rank bands, with no paging and no count", () => {
    renderShelf("scope-whole", manyItems, { total: 105 });

    expect(screen.getByRole("heading", { name: "排名 1 - 100" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "排名 101 - 105" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "排名 1 - 100" })).getAllByRole("button")).toHaveLength(100);
    expect(within(screen.getByRole("list", { name: "排名 101 - 105" })).getAllByRole("button")).toHaveLength(5);
    // The whole shelf is one document: no paging control, and nothing that fetches more.
    expect(screen.getAllByRole("button")).toHaveLength(107);
    expect(within(screen.getByRole("group", { name: "默写模式" })).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("navigation", { name: "词句分页" })).not.toBeInTheDocument();
    // The occurrence count is gone and must not come back with the full render.
    expect(document.querySelectorAll(".vocabulary-study__word small")).toHaveLength(0);
  });

  it("shows all estar forms without expanding usage, including the forms after the eighth", async () => {
    const user = userEvent.setup();
    const entries: Record<string, VocabularyShelfGlossary> = {};
    const estar = shelfItem({ id: "word:estar", word: "estar", context: null, sourceTitle: null }, entries, {});
    renderShelf("scope-estar-forms", [estar], { glossary: entries });
    await user.click(wordTile("estar"));
    const card = screen.getByRole("complementary", { name: "estar 词汇卡片" });
    expect(within(card).getByRole("heading", { name: "常见变位 / 形式" })).toBeVisible();
    const forms = within(card).getByRole("region", { name: "常见变位 / 形式" });
    expect([...forms.querySelectorAll(".vocabulary-study__chips span")].map((item) => item.textContent))
      .toEqual(findCommonGlossaryEntry("estar")!.forms);
    expect(card.querySelector("details")).not.toHaveAttribute("open");
    await user.click(within(card).getByText("用法与搭配", { exact: true }));
    expect(within(forms).getByText("estando", { exact: true })).toBeVisible();
  });

  it("puts marks and attributed examples before collapsed usage and the lookup form", async () => {
    const user = userEvent.setup();
    renderShelf("scope-panel-order");
    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    const marking = within(card).getByRole("group", { name: "标记 casa" });
    const examples = within(card).getByRole("heading", { name: /^例句$/u }).parentElement!;
    const details = card.querySelector("details")!;
    const lookup = within(card).getByRole("searchbox", { name: "查另一个词" }).closest("form")!;
    expect(marking.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(examples.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(lookup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details).not.toHaveAttribute("open");
    expect(within(examples).getByRole("link", { name: "Shishir" })).toHaveAttribute("href", "https://tatoeba.org/en/users/show/Shishir");
    expect(within(examples).getByRole("link", { name: "sadhen" })).toBeInTheDocument();
    await user.click(within(card).getByText("用法与搭配", { exact: true }));
    expect(details).toHaveAttribute("open");
    expect(within(card).getByRole("heading", { name: "词表用法" })).toBeInTheDocument();
    await user.click(wordTile("vez"));
    await user.click(wordTile("casa"));
    expect(screen.getByRole("complementary", { name: "casa 词汇卡片" }).querySelector("details")).not.toHaveAttribute("open");
  });

  it("compensates the selected word's vertical movement only when the panel opens or closes", () => {
    renderShelf("scope-panel-anchor");
    const tile = wordTile("casa");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const rect = vi.spyOn(tile, "getBoundingClientRect");
    rect.mockReturnValueOnce({ top: 260 } as DOMRect).mockReturnValue({ top: 380 } as DOMRect);
    fireEvent.click(tile);
    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: "instant" });
    scrollTo.mockClear();
    rect.mockReturnValueOnce({ top: 260 } as DOMRect).mockReturnValue({ top: 180 } as DOMRect);
    fireEvent.click(within(screen.getByRole("complementary", { name: "casa 词汇卡片" })).getByRole("button", { name: "关闭" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: -80, behavior: "instant" });
  });

  it("keeps the reference order it is given and the translation under each word", () => {
    renderShelf("scope-order");

    const words = within(screen.getByRole("list", { name: "排名 1 - 100" })).getAllByRole("button");
    expect(words.map((word) => word.querySelector(".vocabulary-study__word-text")?.textContent)).toEqual(["ser", "casa", "vez"]);
    expect(wordTile("casa")).toHaveTextContent("房子、家");
    expect(wordTile("ser")).toHaveTextContent("释义待补充");
  });

  it("shows Language Reactor's meanings in order without the panel header metadata", async () => {
    const user = userEvent.setup();
    renderShelf("scope-lr", items, { dictionary: { casa: ["家", "房子", "住宅"] } });

    await user.hover(wordTile("casa"));

    const tooltip = translation() as HTMLElement;
    expect(within(tooltip).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["家", "房子", "住宅"]);
    // Nothing claims the order means anything: it is LR's own order.
    expect(tooltip).not.toHaveTextContent(/最常用|按频率|常用度/u);

    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(card).not.toHaveTextContent("Language Reactor 词典释义");
    expect(card.querySelector(".vocabulary-study__eyebrow")).toBeNull();
    expect(cardMeanings(card)).toEqual(["家", "房子", "住宅"]);
    // The reviewed usage line survives, in its own block rather than as a
    // position inside LR's list.
    await user.click(within(card).getByText("用法与搭配", { exact: true }));
    expect(within(card).getByRole("heading", { name: "词表用法" })).toBeInTheDocument();
    expect(card).toHaveTextContent("en casa 表示在家");
  });

  it("never pads a short Language Reactor list", async () => {
    const user = userEvent.setup();
    renderShelf("scope-lr-short", items, { dictionary: { casa: ["家"] } });

    await user.hover(wordTile("casa"));

    expect(within(translation() as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the reviewed meanings for a word Language Reactor does not carry", async () => {
    const user = userEvent.setup();
    renderShelf("scope-lr-missing", items, { dictionary: { vez: ["次"] } });

    await user.hover(wordTile("casa"));

    const tooltip = translation() as HTMLElement;
    expect(within(tooltip).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["房子、家en casa 表示在家", "家、住所"]);
    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(card.querySelector(".vocabulary-study__eyebrow")).toBeNull();
    expect(cardMeanings(card)).toEqual(["房子、家", "家、住所"]);
  });

  it("marks the hovered word from the layer, through the same local storage contract", async () => {
    const user = userEvent.setup();
    renderShelf("scope-layer-mark");

    await user.hover(wordTile("casa"));
    const actions = screen.getByRole("group", { name: "标记 casa" });
    await user.click(within(actions).getByRole("button", { name: "标为已知" }));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("sueno:vocabulary-status:v1:scope-layer-mark") ?? "{}")).toEqual({ casa: "familiar" });
    });
    await waitFor(() => expect(wordTile("casa")).toHaveClass("is-familiar"));
  });

  it("keeps 正在学习 as its own local state instead of reusing 想复现", async () => {
    const user = userEvent.setup();
    renderShelf("scope-learning");

    await user.hover(wordTile("casa"));
    const actions = screen.getByRole("group", { name: "标记 casa" });
    const button = within(actions).getByRole("button", { name: "标为正在学习" });
    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(wordTile("casa")).toHaveClass("is-learning");
    expect(wordTile("casa")).not.toHaveClass("is-revisit");
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("sueno:vocabulary-status:v1:scope-learning") ?? "{}")).toEqual({ casa: "learning" });
    });
  });

  it("keeps the layer open while the keyboard moves into its buttons", async () => {
    const user = userEvent.setup();
    renderShelf("scope-layer-keyboard");

    // The autoplay switch, two recall modes and ser precede casa in this harness.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(wordTile("casa")).toHaveFocus();
    expect(translation()).not.toBeNull();

    await user.tab();
    expect(translation()).not.toBeNull();
    expect(screen.getByRole("button", { name: "标为已知" })).toHaveFocus();
  });

  it("shows every reviewed meaning on hover, in the reviewed order, and describes the tile for assistive tech", async () => {
    const user = userEvent.setup();
    renderShelf("scope-hover");

    await user.hover(wordTile("casa"));

    const tooltip = translation();
    expect(tooltip).not.toBeNull();
    // The word is not repeated in the layer: the reader is hovering it.
    expect(within(tooltip as HTMLElement).queryByText("casa")).toBeNull();
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
    // it must not invent one. The autoplay switch and both recall modes precede it.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(wordTile("ser")).toHaveFocus();
    expect(translation()).toBeNull();

    await user.tab();
    expect(wordTile("casa")).toHaveFocus();
    expect(translation()).toHaveTextContent("房子、家");
    expect(wordTile("casa")).toHaveAttribute("aria-describedby", "vocabulary-translation");
  });

  it("keeps the translation inside the word's own row, so it cannot go stale, and drops it on blur", async () => {
    const user = userEvent.setup();
    renderShelf("scope-follow");

    const tile = wordTile("casa");
    await user.hover(tile);
    const tooltip = translation() as HTMLElement;
    // Anchored by CSS inside the same list row as the word: it follows that word
    // through any scroll without the component ever reading a coordinate. The
    // layer's wrapper is portalled into the row, and the tooltip element sits
    // inside it.
    expect(tooltip.closest("li")).toBe(tile.parentElement);
    expect(tile.parentElement?.tagName).toBe("LI");

    await user.unhover(tile);
    // Closing is deliberately delayed (180 ms) so the pointer can travel from the
    // word onto the card's buttons; the assertion waits for it rather than
    // reading the state mid-flight.
    await waitFor(() => expect(translation()).toBeNull());

    await user.hover(tile);
    expect(translation()).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /ser/u }));
    await waitFor(() => expect(translation()).toBeNull());
  });

  it("keeps the layer open when the pointer moves from the word onto its card", async () => {
    const user = userEvent.setup();
    renderShelf("scope-group");
    const tile = wordTile("casa");
    await user.hover(tile);
    const layer = document.getElementById("vocabulary-translation-layer") as HTMLElement;
    expect(layer).not.toBeNull();

    // The word and its card sit in the same row, so a pointer moving onto the card
    // has only left the *tile*. `relatedTarget` names the card, and the row
    // contains it: the layer stays open no matter how slow the hand is.
    const card = layer.querySelector(".vocabulary-shelf__translation") as HTMLElement;
    fireEvent.mouseOut(tile, { relatedTarget: card });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(translation()).not.toBeNull();

    // Stepping out of the row to another word does close it, after the grace.
    fireEvent.mouseOut(tile, { relatedTarget: wordTile("vez") });
    await waitFor(() => expect(translation()).toBeNull(), { timeout: 1_500 });
  });

  it("reads no geometry while the page scrolls", async () => {
    const user = userEvent.setup();
    renderShelf("scope-scroll-cost");
    const tile = wordTile("casa");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

    // The worst case: the translation is showing while the reader scrolls.
    await user.hover(tile);
    expect(translation()).not.toBeNull();
    const before = (HTMLElement.prototype.getBoundingClientRect as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    for (let step = 0; step < 60; step += 1) window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Scrolling must not cost a single layout read: this guard fails if a
    // per-frame "follow the word" handler ever comes back.
    expect((HTMLElement.prototype.getBoundingClientRect as unknown as { mock: { calls: unknown[] } }).mock.calls.length - before).toBe(0);
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

  it("opens the card with the meanings, and closes it again", async () => {
    const user = userEvent.setup();
    renderShelf("scope-card");

    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(card.querySelector(".vocabulary-study__eyebrow")).toBeNull();
    expect(cardMeanings(card)).toEqual(["房子、家", "家、住所"]);
    // The first meaning's usage note stays in the panel, twice over: as the note
    // under the main meaning and as the 词表用法 entry. Both are real places it
    // belongs, so this asserts it is present rather than that it appears once.
    expect(within(card).getAllByText("en casa 表示在家").length).toBeGreaterThan(0);
    // Opening a word pronounces it, so the control is already the stop control.
    expect(within(card).getByRole("button", { name: "停止朗读" })).toBeInTheDocument();

    await user.click(wordTile("casa"));
    expect(screen.queryByRole("complementary", { name: "casa 词汇卡片" })).not.toBeInTheDocument();
  });

  it("pronounces the word as it opens the panel, in the one click, without a status line", async () => {
    const user = userEvent.setup();
    renderShelf("scope-click-reads");
    await user.click(wordTile("casa"));
    expect(speechSpeak).toHaveBeenCalledTimes(1);
    expect(speechSpeak.mock.calls[0]![0]).toMatchObject({ text: "casa", lang: "es-ES" });
    expect(callsTo("word-audio")).toHaveLength(0);
    // The owner asked for no "synthesis"/"preparing" wording (2026-10-20): the
    // read control itself says the word is sounding, and nothing else does.
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止朗读" })).toHaveAttribute("aria-busy", "true");
    act(() => (speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance).onstart?.(new Event("start") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "停止朗读" })).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
  });

  it("closes the word again without re-reading it", async () => {
    const user = userEvent.setup();
    renderShelf("scope-reclick");
    await user.click(wordTile("casa"));
    expect(speechSpeak).toHaveBeenCalledTimes(1);
    await user.click(wordTile("casa"));
    expect(screen.queryByRole("complementary", { name: "casa 词汇卡片" })).not.toBeInTheDocument();
    expect(speechSpeak).toHaveBeenCalledTimes(1);
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("keeps the panel to one main meaning and one row for the rest", async () => {
    const user = userEvent.setup();
    renderShelf("scope-compact-meanings");

    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    const main = card.querySelector(".vocabulary-study__meaning-main");
    const rest = card.querySelector(".vocabulary-study__meaning-rest");

    // `casa` carries two meanings with a usage note on the first.
    expect(main?.textContent).toBe("房子、家en casa 表示在家");
    expect(rest?.textContent).toBe("家、住所");
    // Two rows, not one row per meaning with its note underneath: that shape cost
    // three lines for two meanings in a 350-440px column.
    expect(card.querySelectorAll(".vocabulary-study__meanings > li")).toHaveLength(2);
  });

  it("stops reading on open when the autoplay switch is turned off", async () => {
    const user = userEvent.setup();
    wordAudioReply = clipReply();
    renderShelf("scope-autoplay-off");

    // On by default: the switch reads as checked, and opening a word reads it.
    const toggle = screen.getByRole("checkbox", { name: "点词自动发音" });
    expect(toggle).toBeChecked();
    await user.click(wordTile("casa"));
    await waitFor(() => expect(speechSpeak).toHaveBeenCalledTimes(1));

    // Turned off, the panel still opens — only the sound goes away, so the switch
    // never costs the reader the panel or the read button.
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await user.click(wordTile("vez"));
    expect(screen.getByRole("complementary", { name: "vez 词汇卡片" })).toBeInTheDocument();
    expect(speechSpeak).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "朗读单词" })).toBeInTheDocument();

    // And the read button still reads, so the choice is about the automatic sound.
    await user.click(screen.getByRole("button", { name: "朗读单词" }));
    await waitFor(() => expect(speechSpeak).toHaveBeenCalledTimes(2));
    // The choice is stored, not session-only.
    expect(window.localStorage.getItem("sueno:vocabulary-autoplay:v1:scope-autoplay-off")).toBe("off");
  });

  it("looks up another word from the panel and shows it", async () => {
    const user = userEvent.setup();
    renderShelf("scope-lookup");

    // Open a word so the panel (and its form) is on screen.
    await user.click(wordTile("casa"));
    wordLookupReply = {
      ok: true,
      status: 200,
      json: async () => ({
        apiVersion: "v1",
        data: {
          found: true,
          word: "parque",
          markKey: "parque",
          meanings: [{ meaning: "公园", usage: "" }, { meaning: "停车场", usage: "" }],
          meaningSource: "language-reactor",
          usageNotes: [],
          cefr: null,
          partOfSpeech: null,
          collocations: [],
          examples: [],
          forms: [],
          context: null,
          sourceTitle: null,
        },
      }),
    };

    const input = screen.getByRole("searchbox", { name: "查另一个词" });
    await user.type(input, "parque");
    await user.click(screen.getByRole("button", { name: "查" }));

    // The full lookup, not the examples-only request the panel makes when a word opens.
    const lookupCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("word-lookup") && !String(call[0]).includes("fields=tatoeba"));
    expect(lookupCall).toBeDefined();
    expect(JSON.parse(String(lookupCall![1].body))).toEqual({ word: "parque" });

    await waitFor(() => expect(screen.getByRole("complementary", { name: "parque 词汇卡片" })).toBeInTheDocument());
    const card = screen.getByRole("complementary", { name: "parque 词汇卡片" });
    expect(cardMeanings(card)).toEqual(["公园", "停车场"]);
    // Looked-up words use the same header without source/level/POS metadata.
    expect(within(card).queryByText(/Language Reactor/)).not.toBeInTheDocument();
  });

  it("says so when the looked-up word is not in the reference list", async () => {
    const user = userEvent.setup();
    renderShelf("scope-lookup-missing");

    await user.click(wordTile("casa"));
    wordLookupReply = {
      ok: true,
      status: 200,
      json: async () => ({ apiVersion: "v1", data: { found: false, word: "zzz" } }),
    };

    await user.type(screen.getByRole("searchbox", { name: "查另一个词" }), "zzz");
    await user.click(screen.getByRole("button", { name: "查" }));

    // A word the list does not carry is an answer, not an error, and the panel keeps
    // showing the word the reader was already reading.
    await waitFor(() => expect(screen.getByText("参考词表里没有这个词，换一个拼写试试。")).toBeInTheDocument());
    expect(screen.getByRole("complementary", { name: "casa 词汇卡片" })).toBeInTheDocument();
  });

  it("closes the panel when the reader presses Back, and does not leave a history step behind", async () => {
    const user = userEvent.setup();
    renderShelf("scope-back");

    // jsdom implements neither method; only those two are stood in for, so the test
    // exercises the real `pushState`/`popstate` wiring rather than a fake history.
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    await user.click(wordTile("casa"));
    expect(screen.getByRole("complementary", { name: "casa 词汇卡片" })).toBeInTheDocument();
    // Opening pushed one entry, so Back means "close the panel" rather than "leave".
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0][0]).toEqual({ vocabularyPanel: true });
    expect(back).not.toHaveBeenCalled();

    // The reader presses Back: the browser pops the entry and reports it.
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "casa 词汇卡片" })).not.toBeInTheDocument());
    // The entry is already gone, so the panel must not ask for another `back()`.
    expect(back).not.toHaveBeenCalled();

    // Closing with 关闭 consumes the entry it pushed, rather than leaving a step that
    // would make the reader's next Back do nothing.
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(back).toHaveBeenCalledTimes(1);

    pushState.mockRestore();
    back.mockRestore();
  });

  it("shows Tatoeba's example with the credit its licence requires", async () => {
    const user = userEvent.setup();
    renderShelf("scope-tatoeba");

    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });

    expect(within(card).getByRole("heading", { name: "例句 · Tatoeba" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Hoy me quedo en casa.");
    expect(card).toHaveTextContent("今天我呆在家里。");

    // CC BY 2.0 FR needs the author and the licence for the sentence *and* for the
    // translation, plus a way back to the sentence itself.
    const sentenceLink = within(card).getByRole("link", { name: "#1234567" });
    expect(sentenceLink).toHaveAttribute("href", "https://tatoeba.org/en/sentences/show/1234567");
    expect(within(card).getByRole("link", { name: "Shishir" })).toHaveAttribute("href", "https://tatoeba.org/en/users/show/Shishir");
    expect(within(card).getByRole("link", { name: "sadhen" })).toHaveAttribute("href", "https://tatoeba.org/en/users/show/sadhen");
    expect(card).toHaveTextContent("CC BY 2.0 FR");
    expect(card).toHaveTextContent("例句来自 Tatoeba");
    // External links must not hand the opener over to the other site.
    for (const link of within(card).getAllByRole("link")) {
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("copies only the Spanish Tatoeba sentence", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderShelf("scope-copy-example");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "复制例句" }));
    expect(copy).toHaveBeenCalledWith("Hoy me quedo en casa.");
    expect(screen.getByText("已复制西语例句")).toBeInTheDocument();
  });

  it("plays the exact Tatoeba recording, waits for progress, stops, and ignores an old callback", async () => {
    const user = userEvent.setup();
    renderShelf("scope-play-example");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    const audio = FakeAudio.instances.at(-1)!;
    expect(audio.src).toBe("https://api.tatoeba.org/v1/audios/505729/file");
    expect(audio.currentTime).toBe(0);
    // Playback state is carried by the button only; clicking play shows no status line.
    expect(screen.queryByText(/正在(加载|播放)例句原声/u)).not.toBeInTheDocument();
    const stopButton = screen.getByRole("button", { name: "停止例句原声" });
    expect(stopButton).toHaveAttribute("aria-busy", "true");
    const late = audio.onplaying!;
    act(() => audio.onplaying?.());
    // A playing event without media progress is still only loading.
    expect(stopButton).toHaveAttribute("aria-busy", "true");
    act(() => { audio.currentTime = .25; audio.ontimeupdate?.(); });
    expect(stopButton).not.toHaveAttribute("aria-busy");
    await user.click(stopButton);
    act(() => late());
    expect(screen.getByRole("button", { name: "播放例句原声" })).toBeInTheDocument();
    expect(audio.pause).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "arh" })).toHaveAttribute("href", "https://tatoeba.org/user/profile/arh");
    expect(screen.getByText(/录音.*CC BY-NC-ND 3.0/u)).toBeInTheDocument();
  });

  it("shows a retry after a Tatoeba recording fails without substituting synthesized speech", async () => {
    const user = userEvent.setup();
    renderShelf("scope-error-example");
    await user.click(wordTile("casa"));
    speechSpeak.mockClear();
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    act(() => FakeAudio.instances.at(-1)!.onerror?.());
    expect(screen.getByText("例句原声暂时无法播放，请重试。")).toBeInTheDocument();
    expect(speechSpeak).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    expect(screen.getByRole("button", { name: "停止例句原声" })).toHaveAttribute("aria-busy", "true");
  });

  it("offers explicitly labelled synthesis when a sentence has no reusable recording", async () => {
    const user = userEvent.setup();
    renderShelf("scope-no-recording", items, { glossary: { casa: { ...glossary.casa!, tatoeba: [{ ...glossary.casa!.tatoeba[0]!, audio: null }] } } });
    await user.click(wordTile("casa"));
    expect(screen.getByRole("button", { name: "合成朗读例句" })).toBeEnabled();
    expect(screen.queryByText("暂无录音 · 合成朗读")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制例句" })).toBeEnabled();
    speechSpeak.mockClear();
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    const utterance = speechSpeak.mock.calls.at(-1)![0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("Hoy me quedo en casa.");
    expect(utterance.lang).toBe("es-ES");
    expect(screen.queryByText(/正在(准备)?合成朗读/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止合成朗读" })).toHaveAttribute("aria-busy", "true");
    act(() => utterance.onstart?.(new Event("start") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "停止合成朗读" })).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("正在合成朗读例句")).not.toBeInTheDocument();
    await act(async () => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "合成朗读例句" })).toBeEnabled();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("reports a synthetic example failure on its sentence and permits retry", async () => {
    const user = userEvent.setup();
    renderShelf("scope-synthetic-example-error", items, { glossary: { casa: { ...glossary.casa!, tatoeba: [{ ...glossary.casa!.tatoeba[0]!, audio: null }] } } });
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    const utterance = speechSpeak.mock.calls.at(-1)![0] as SpeechSynthesisUtterance;
    await act(async () => utterance.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent));
    expect(screen.getByText("暂时无法朗读，请检查网络后再试一次。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合成朗读例句" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    expect(screen.queryByText("暂时无法朗读，请检查网络后再试一次。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止合成朗读" })).toHaveAttribute("aria-busy", "true");
  });

  it("stops synthetic examples before original audio and ignores old speech events", async () => {
    const user = userEvent.setup();
    const missing = { ...glossary.casa!.tatoeba[0]!, sentenceId: 9, text: "¿Habéis despertado?", audio: null };
    renderShelf("scope-example-sources", items, { glossary: { casa: { ...glossary.casa!, tatoeba: [missing, glossary.casa!.tatoeba[0]!] } } });
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    const utterance = speechSpeak.mock.calls.at(-1)![0] as SpeechSynthesisUtterance;
    const lateStart = utterance.onstart!;
    const lateEnd = utterance.onend!;
    const synthesisCancel = speech.cancel;
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    expect(synthesisCancel).toHaveBeenCalled();
    act(() => { lateStart.call(utterance, new Event("start") as SpeechSynthesisEvent); lateEnd.call(utterance, new Event("end") as SpeechSynthesisEvent); });
    expect(screen.getByRole("button", { name: "停止例句原声" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/正在(准备|合成)朗读/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    expect(FakeAudio.instances.at(-1)!.removeAttribute).toHaveBeenCalledWith("src");
    await user.click(screen.getByRole("button", { name: "停止合成朗读" }));
    expect(screen.queryByText("正在准备合成朗读…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合成朗读例句" })).toBeEnabled();
  });

  it("keeps a failed synthetic preparation distinct from playing", async () => {
    const user = userEvent.setup();
    renderShelf("scope-silent-synthetic-example", items, { glossary: { casa: { ...glossary.casa!, tatoeba: [{ ...glossary.casa!.tatoeba[0]!, audio: null }] } } });
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    expect(screen.queryByText("正在合成朗读例句")).not.toBeInTheDocument();
    await act(async () => { speech.attempts.at(-1)!.onerror?.(); });
    expect(screen.getByText("暂时无法朗读，请检查网络后再试一次。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合成朗读例句" })).toBeEnabled();
  });

  it("stops a synthetic example on page hiding and discards its pending start", async () => {
    const user = userEvent.setup();
    renderShelf("scope-hide-synthetic-example", items, { glossary: { casa: { ...glossary.casa!, tatoeba: [{ ...glossary.casa!.tatoeba[0]!, audio: null }] } } });
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "合成朗读例句" }));
    const utterance = speechSpeak.mock.calls.at(-1)![0] as SpeechSynthesisUtterance;
    const lateStart = utterance.onstart!;
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    act(() => lateStart.call(utterance, new Event("start") as SpeechSynthesisEvent));
    expect(screen.queryByText("正在准备合成朗读…")).not.toBeInTheDocument();
    expect(screen.queryByText("正在合成朗读例句")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "合成朗读例句" })).toBeEnabled();
    hidden.mockRestore();
  });

  it("stops the example on word changes", async () => {
    const user = userEvent.setup();
    renderShelf("scope-cancel-example");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    const audio = FakeAudio.instances.at(-1)!;
    const late = audio.onplaying!;
    await user.click(wordTile("ser"));
    act(() => late());
    expect(screen.queryByRole("button", { name: "停止例句原声" })).not.toBeInTheDocument();
    expect(audio.pause).toHaveBeenCalled();
  });

  it("reports clipboard rejection and lets the reader retry", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied")).mockResolvedValue();
    renderShelf("scope-copy-retry");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "复制例句" }));
    expect(screen.getByText("复制失败，请选择例句后手动复制。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "复制例句" }));
    expect(copy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("已复制西语例句")).toBeInTheDocument();
  });

  it("resets after a recording ends and rejects late errors", async () => {
    const user = userEvent.setup();
    renderShelf("scope-end-example");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    const audio = FakeAudio.instances.at(-1)!;
    const lateError = audio.onerror!;
    act(() => { audio.onplaying?.(); audio.onended?.(); lateError(); });
    expect(screen.getByRole("button", { name: "播放例句原声" })).toBeEnabled();
    expect(screen.queryByText("例句原声暂时无法播放，请重试。")).not.toBeInTheDocument();
  });

  it("bounds a recording that never starts and ignores its late playing event", async () => {
    const user = userEvent.setup();
    renderShelf("scope-timeout-example");
    await user.click(wordTile("casa"));
    // Use fake timers only for the media timeout, after userEvent has finished clicking.
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "播放例句原声" }));
      const audio = FakeAudio.instances.at(-1)!;
      const late = audio.onplaying!;
      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.getByText("例句原声暂时无法播放，请重试。")).toBeInTheDocument();
      act(() => late());
      expect(screen.getByRole("button", { name: "播放例句原声" })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("times out a playing event with no media progress and ignores late progress", async () => {
    const user = userEvent.setup();
    renderShelf("scope-false-playing-example");
    await user.click(wordTile("casa"));
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "播放例句原声" }));
      const audio = FakeAudio.instances.at(-1)!;
      const late = audio.ontimeupdate;
      act(() => audio.onplaying?.());
      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.getByText("例句原声暂时无法播放，请重试。")).toBeInTheDocument();
      act(() => { audio.currentTime = 1; late?.(); });
      expect(screen.getByRole("button", { name: "播放例句原声" })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("shows buffering and bounds a stalled recording even after it starts", async () => {
    const user = userEvent.setup();
    renderShelf("scope-stalled-example");
    await user.click(wordTile("casa"));
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "播放例句原声" }));
      const audio = FakeAudio.instances.at(-1)!;
      act(() => { audio.onplaying?.(); audio.currentTime = .25; audio.ontimeupdate?.(); });
      const stopButton = screen.getByRole("button", { name: "停止例句原声" });
      expect(stopButton).not.toHaveAttribute("aria-busy");
      act(() => audio.onwaiting?.());
      expect(stopButton).toHaveAttribute("aria-busy", "true");
      act(() => { vi.advanceTimersByTime(10_000); audio.ontimeupdate?.(); });
      // Repeated events at the same position cannot prolong the deadline.
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText("例句原声暂时无法播放，请重试。")).toBeInTheDocument();
      expect(audio.ontimeupdate).toBeNull();
      expect(audio.onwaiting).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("renews the stall deadline only when the recording advances and recovers from buffering", async () => {
    const user = userEvent.setup();
    renderShelf("scope-progress-example");
    await user.click(wordTile("casa"));
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "播放例句原声" }));
      const audio = FakeAudio.instances.at(-1)!;
      act(() => { audio.currentTime = .25; audio.ontimeupdate?.(); });
      act(() => { vi.advanceTimersByTime(15_000); audio.onwaiting?.(); });
      act(() => { audio.currentTime = .5; audio.ontimeupdate?.(); });
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByRole("button", { name: "停止例句原声" })).not.toHaveAttribute("aria-busy");
      act(() => audio.onended?.());
      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.queryByText("例句原声暂时无法播放，请重试。")).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("reports a rejected play promise without claiming playback began", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("Audio", class extends FakeAudio {
      readonly play = vi.fn(() => Promise.reject(new Error("play blocked")));
    });
    renderShelf("scope-rejected-example");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    await waitFor(() => expect(screen.getByText("例句原声暂时无法播放，请重试。")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "播放例句原声" })).toBeInTheDocument();
  });

  it("releases the recording on page hiding and unmount", async () => {
    const user = userEvent.setup();
    const view = renderShelf("scope-hide-example");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    const audio = FakeAudio.instances.at(-1)!;
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(screen.getByRole("button", { name: "播放例句原声" })).toBeInTheDocument();
    hidden.mockRestore();
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    view.unmount();
    expect(audio.onplaying).toBeNull();
    expect(audio.onerror).toBeNull();
    expect(audio.load).toHaveBeenCalled();
  });

  it("never displays or plays the corpus sentence as word pronunciation", async () => {
    const user = userEvent.setup();
    wordAudioReply = clipReply();
    renderShelf("scope-clip-sentence");
    await user.click(wordTile("casa"));
    expect(speechSpeak.mock.calls[0]![0]).toMatchObject({ text: "casa" });
    expect(FakeAudio.instances).toHaveLength(0);
    expect(screen.queryByText("Mi casa y tu casa son casa.")).not.toBeInTheDocument();
    expect(callsTo("word-audio")).toHaveLength(0);
  });

  it("does not show a sentence while the word is being read aloud", async () => {
    const user = userEvent.setup();
    wordAudioReply = syntheticReply;
    renderShelf("scope-synthetic-no-sentence");

    await user.click(wordTile("casa"));

    expect(screen.getByRole("button", { name: "停止朗读" })).toHaveAttribute("aria-busy", "true");
    // A synthesized word has no published sentence behind it, so claiming one would be
    // inventing text for a sound that never said it.
    expect(screen.queryByText("Mi casa y tu casa son casa.")).not.toBeInTheDocument();
  });

  it("says which inflected form a lemma example matched", async () => {
    const user = userEvent.setup();
    // `haber` is the case this exists for: the sentence contains `Habéis`, not `haber`, and
    // without saying so the panel looks like it put the wrong sentence under the word.
    const withForm: Record<string, VocabularyShelfGlossary> = {
      haber: {
        ...glossary.casa!,
        meanings: [{ meaning: "有、存在", usage: "" }],
        tatoeba: [{
          ...glossary.casa!.tatoeba[0]!,
          text: "¿Habéis despertado?",
          translation: "你醒来了没？",
          matchedForm: "Habéis",
        }],
      },
    };
    renderShelf("scope-lemma-credit", [{ id: "word:haber", markKey: "haber", text: "haber", context: null, source: null, meaning: "有、存在" }], {
      total: 1,
      glossary: withForm,
    });

    await user.click(wordTile("haber"));
    const card = screen.getByRole("complementary", { name: "haber 词汇卡片" });
    const credit = card.querySelector(".vocabulary-study__tatoeba-credit");
    expect(credit?.textContent).toContain("含 Habéis");
    // And it stays inside the credit line, so the example reads as before.
    expect(card).toHaveTextContent("¿Habéis despertado?");
    expect(card).toHaveTextContent("你醒来了没？");
  });

  it("does not show the published-content example, whose place Tatoeba takes", async () => {    const user = userEvent.setup();
    renderShelf("scope-no-corpus-example");

    await user.click(wordTile("casa"));
    const card = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    // The owner asked for this block to go: the example source is Tatoeba, whose
    // sentences carry their own licence and attribution. The shelf still renders
    // the corpus example on the tile's own data, so this pins the *panel* only.
    expect(within(card).queryByText("Mi casa y tu casa son casa.")).toBeNull();
    expect(within(card).queryByText("已发布内容中的真实例句")).toBeNull();
    expect(within(card).queryByText("Podcast publicado")).toBeNull();
  });

  it("states honestly when a word has no reviewed meaning", async () => {
    const user = userEvent.setup();
    renderShelf("scope-honest");

    await user.click(wordTile("vez"));
    const card = screen.getByRole("complementary", { name: "vez 词汇卡片" });
    expect(within(card).getByText("这个词还没有可显示的中文释义，先按下面的语境理解它。")).toBeInTheDocument();
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

  // The fix that made the mark buttons reachable (owner-reported twice): the
  // buttons live *inside* the card box, so there is no second box for the pointer
  // to fall between. jsdom has no layout, so the pointer proof itself lives in
  // `scripts/verify-vocabulary-page-browser.ts`; this pins the structure that
  // makes that proof possible — move the actions back out as a sibling of the
  // card and both assertions below fail.
  it("keeps the mark buttons inside the card box, with no strip between them", async () => {
    const user = userEvent.setup();
    renderShelf("scope-card-structure");

    await user.hover(wordTile("casa"));
    const layer = document.getElementById("vocabulary-translation-layer");
    expect(layer).not.toBeNull();

    const card = layer?.querySelector(".vocabulary-shelf__translation-card") ?? null;
    const actions = layer?.querySelector(".vocabulary-shelf__translation-actions") ?? null;
    expect(card).not.toBeNull();
    expect(actions).not.toBeNull();

    // One box: the actions are the card's child, not its sibling.
    expect(actions?.parentElement).toBe(card);
    // And the layer holds nothing else — a second box would be a strip between
    // the pointer's path and the buttons with no hit target of its own.
    expect([...(layer?.children ?? [])]).toEqual([card]);
    // Both shortcuts are the card's own buttons. Reading is deliberately not
    // here: it lives on the word panel the click opens, so the hover card stays
    // a "what does this word mean" surface with no second control to reach for.
    expect(card?.querySelectorAll("button")).toHaveLength(2);
    expect(card?.querySelector(".vocabulary-shelf__translation-read")).toBeNull();
  });

  it("turns the rail into band fragments and tracks the band in view by observation, not by scrolling", async () => {
    renderShelf("scope-rail", manyItems, { total: 105 });

    expect(within(rail()).getByRole("link", { name: "跳到第 1 名" })).toHaveAttribute("href", "#vocabulary-band-1");
    expect(within(rail()).getByRole("link", { name: "跳到第 100 名" })).toHaveAttribute("href", "#vocabulary-band-1");
    expect(within(rail()).getByRole("link", { name: "跳到第 1 名" })).toHaveAttribute("aria-current", "true");

    // jsdom has no IntersectionObserver: the frame's one observation line is
    // driven directly, which is exactly what a scroll would do in a browser.
    // Selected by what it observes rather than by position: the shelf's continuation
    // installs its own observer for the loader, so "the last one" is no longer the bands'.
    const secondBand = document.querySelector<HTMLElement>('[data-band-start="101"]');
    expect(secondBand).not.toBeNull();
    const observer = FakeIntersectionObserver.instances.find((instance) => instance.targets.includes(secondBand!));
    expect(observer).toBeDefined();

    await act(async () => { observer?.enter(secondBand as Element); });

    expect(within(rail()).getByRole("link", { name: "跳到第 100 名" })).toHaveAttribute("aria-current", "true");
  });

  it("offers no bands and no rail for a search result", () => {
    renderShelf("scope-search", items, { ranked: false, total: 3 });

    expect(screen.getByRole("list", { name: "词汇列表" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /排名/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "按名次跳转" })).not.toBeInTheDocument();
  });

  it("offers the four local states in the card and reads the word aloud", async () => {
    const user = userEvent.setup();
    renderShelf("scope-wording");

    await user.click(wordTile("ser"));
    const card = screen.getByRole("complementary", { name: "ser 词汇卡片" });
    const marking = within(card).getByRole("group", { name: "标记 ser" });
    // `正在学习` is the owner's addition: a distinct local state, so it is a
    // fourth button here rather than a relabelling of 想复现. This assertion used
    // to lock the old three-state wording and had to be corrected with it.
    for (const label of ["已熟悉", "正在学习", "想复现", "暂不学习"]) {
      expect(within(marking).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(marking).queryByRole("button", { name: /掌握/u })).not.toBeInTheDocument();

    // Opening the word already asked the route: its answer carries no clip, so
    // the browser voice answered without a second click.
    await waitFor(() => expect(speechSpeak).toHaveBeenCalledTimes(1));
    expect(speechSpeak.mock.calls[0]![0]).toMatchObject({ text: "ser", lang: "es-ES" });
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止朗读" })).toHaveAttribute("aria-busy", "true");
  });


  it("does not claim playback before TTS starts and resets after successful end", async () => {
    const user = userEvent.setup();
    renderShelf("scope-word-start-end");
    await user.click(wordTile("casa"));
    const utterance = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    const stopControl = screen.getByRole("button", { name: "停止朗读" });
    expect(stopControl).toHaveAttribute("aria-busy", "true");
    expect(stopControl).toHaveAttribute("aria-pressed", "true");
    act(() => utterance.onstart?.(new Event("start") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "停止朗读" })).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    act(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
    await waitFor(() => expect(screen.getByRole("button", { name: "朗读单词" })).toHaveAttribute("aria-pressed", "false"));
  });

  it("stops a pending word and discards its late start", async () => {
    const user = userEvent.setup();
    renderShelf("scope-word-stop");
    await user.click(wordTile("casa"));
    const utterance = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    const lateStart = utterance.onstart!;
    const cancels = vi.mocked(speech.cancel).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "停止朗读" }));
    expect(vi.mocked(speech.cancel).mock.calls.length).toBeGreaterThan(cancels);
    act(() => lateStart.call(utterance, new Event("start") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "朗读单词" })).toBeInTheDocument();
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
  });

  it("does not label word synthesis beside its control and does not request media", async () => {
    const user = userEvent.setup();
    renderShelf("scope-synthetic");
    await user.click(wordTile("casa"));
    act(() => (speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance).onstart?.(new Event("start") as SpeechSynthesisEvent));
    expect(FakeAudio.instances).toHaveLength(0);
    expect(callsTo("word-audio")).toHaveLength(0);
    const panel = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    // No status line, and nothing about synthesis or preparing: the read control
    // alone carries the state (owner request, 2026-10-20).
    expect(within(panel).queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    expect(within(panel).queryByRole("status")).not.toBeInTheDocument();
    expect(document.querySelector(".vocabulary-toolbar")).not.toHaveTextContent(/合成音|原声/u);
    expect(screen.queryByText(/这个词暂时取不到原声/u)).not.toBeInTheDocument();
  });

  it("keeps an unsupported voice notice beside the panel's retry control", async () => {
    const user = userEvent.setup();
    speech.state.supported = false;
    renderShelf("scope-no-voice");
    await user.click(wordTile("casa"));
    const panel = screen.getByRole("complementary", { name: "casa 词汇卡片" });
    expect(within(panel).getByText("当前浏览器不支持音频播放，单词仍可正常学习。")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "朗读单词" })).toBeInTheDocument();
    expect(document.querySelector(".vocabulary-toolbar")).not.toHaveTextContent("不支持朗读");
  });

  it("reports synthesis failure beside the word and permits retry", async () => {
    const user = userEvent.setup();
    renderShelf("scope-word-error");
    await user.click(wordTile("casa"));
    const utterance = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    act(() => utterance.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent));
    await waitFor(() => expect(screen.getByRole("button", { name: "朗读单词" })).toBeInTheDocument());
    expect(screen.getByRole("complementary", { name: "casa 词汇卡片" }).querySelector(".vocabulary-study__notice")).toHaveTextContent("暂时无法朗读，请检查网络后再试一次。");
    await user.click(screen.getByRole("button", { name: "朗读单词" }));
    expect(speechSpeak).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "停止朗读" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
  });

  it("reports a failed preparation and permits retry", async () => {
    const user = userEvent.setup();
    renderShelf("scope-word-timeout");
    await user.click(wordTile("casa"));
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    await act(async () => { speech.attempts[0].onerror?.(); });
    expect(screen.getByRole("button", { name: "朗读单词" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "casa 词汇卡片" }).querySelector(".vocabulary-study__notice")).toHaveTextContent("暂时无法朗读");
    await user.click(screen.getByRole("button", { name: "朗读单词" }));
    expect(speechSpeak).toHaveBeenCalledTimes(2);
  });

  it("cancels the old word when another word is read and rejects old completion", async () => {
    const user = userEvent.setup();
    renderShelf("scope-next-word");
    await user.click(wordTile("casa"));
    const old = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    const oldEnd = old.onend!;
    const cancels = vi.mocked(speech.cancel).mock.calls.length;
    await user.click(wordTile("vez"));
    expect(vi.mocked(speech.cancel).mock.calls.length).toBeGreaterThan(cancels);
    expect(speechSpeak.mock.calls[1]![0]).toMatchObject({ text: "vez" });
    act(() => oldEnd.call(old, new Event("end") as SpeechSynthesisEvent));
    // The late completion of the previous word is dropped: the panel still shows the
    // new word's pending read, and no status line is displayed for either.
    expect(screen.getByRole("complementary", { name: "vez 词汇卡片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止朗读" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("stops word TTS before a Tatoeba original and ignores late word events", async () => {
    const user = userEvent.setup();
    renderShelf("scope-word-to-example");
    await user.click(wordTile("casa"));
    const old = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    const lateStart = old.onstart!;
    const cancels = vi.mocked(speech.cancel).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    expect(vi.mocked(speech.cancel).mock.calls.length).toBeGreaterThan(cancels);
    act(() => lateStart.call(old, new Event("start") as SpeechSynthesisEvent));
    expect(screen.getByRole("button", { name: "停止例句原声" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "朗读单词" })).toBeInTheDocument();
  });

  it("releases the Tatoeba original before reading just the word", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("sueno:vocabulary-autoplay:v1:scope-example-to-word", "off");
    renderShelf("scope-example-to-word");
    await user.click(wordTile("casa"));
    await user.click(screen.getByRole("button", { name: "播放例句原声" }));
    const audio = FakeAudio.instances[0]!;
    const lateProgress = audio.ontimeupdate!;
    const pauses = audio.pause.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "朗读单词" }));
    expect(audio.pause.mock.calls.length).toBeGreaterThan(pauses);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(speechSpeak.mock.calls[0]![0]).toMatchObject({ text: "casa", lang: "es-ES" });
    audio.currentTime = 1;
    act(() => lateProgress());
    expect(screen.queryByRole("button", { name: "停止例句原声" })).not.toBeInTheDocument();
  });

  it.each(["close", "unmount", "Escape", "hidden"])("cancels word speech on %s and ignores late starts", async (action) => {
    const user = userEvent.setup();
    const view = renderShelf("scope-word-dismiss-" + action);
    await user.click(wordTile("casa"));
    const utterance = speechSpeak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    const lateStart = utterance.onstart!;
    const cancels = vi.mocked(speech.cancel).mock.calls.length;
    if (action === "close") await user.click(screen.getByRole("button", { name: "关闭" }));
    if (action === "unmount") view.unmount();
    if (action === "Escape") await user.keyboard("{Escape}");
    if (action === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      fireEvent(document, new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
    }
    expect(vi.mocked(speech.cancel).mock.calls.length).toBeGreaterThan(cancels);
    act(() => lateStart.call(utterance, new Event("start") as SpeechSynthesisEvent));
    expect(screen.queryByText(/合成音|准备中/u)).not.toBeInTheDocument();
  });
});
