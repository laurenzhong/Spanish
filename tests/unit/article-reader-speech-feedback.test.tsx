import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bundle from "@/content/bundles/alpha-core-v1.json";
import { ArticleReader } from "@/app/(product)/read/article/[articleId]/article-reader";
import { getArticle } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";
import type { ContentBundle } from "@/src/modules/content/schemas";

const publishedBundle = (): ContentBundle => {
  const source = structuredClone(bundle) as unknown as ContentBundle;
  source.articles[0] = {
    ...source.articles[0],
    status: "published",
    publishedAt: "2026-08-26T08:00:00Z",
    source: { ...source.articles[0].source, copyrightStatus: "cleared" },
  };
  return source;
};

const nativeSpeechSynthesis = window.speechSynthesis;
const nativeSpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance;

type FakeUtterance = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

async function renderReader() {
  const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
  if (!result.article) throw new Error("fixture article not found");
  render(<ArticleReader article={result.article} />);
  // Open the Explain panel on the first word, exactly like a reader would.
  const token = screen.getAllByRole("button").find((button) => button.classList.contains("reader-token"));
  if (!token) throw new Error("reader token missing");
  const user = userEvent.setup();
  await user.click(token);
  const panel = screen.getByRole("dialog", { name: "解释" });
  return { user, panel, word: token.textContent ?? "" };
}

function stubSynthesis(speak: (utterance: FakeUtterance) => void) {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [],
      resume: vi.fn(),
      speak,
      speaking: false,
      pending: false,
    },
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class {
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public readonly text: string) {}
    },
  });
}

describe("article reader read-aloud feedback", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The word lookup is unrelated here; keep it pending so the panel stays open.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: nativeSpeechSynthesis });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: nativeSpeechSynthesisUtterance });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("tells the reader when the browser produced no audio", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spoken: FakeUtterance[] = [];
    // The engine accepts the utterance and never fires anything: the state that
    // used to leave the translate panel's speaker button doing nothing at all.
    stubSynthesis((utterance) => spoken.push(utterance));
    const { user, panel, word } = await renderReader();

    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    expect(spoken).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(12_000);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("浏览器没有出声"));
    // The button stays usable so a second attempt is possible.
    expect(within(panel).getByRole("button", { name: `朗读 ${word}` })).toBeEnabled();
  });

  it("clears the error and speaks after the reader switches to a working voice", async () => {
    let broken = true;
    stubSynthesis((utterance) => {
      if (broken) return;
      utterance.onstart?.();
      utterance.onend?.();
    });
    const { user, panel, word } = await renderReader();

    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    // Real timers here: the adapter needs its startup budget before reporting.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("浏览器没有出声"), { timeout: 15_000 });

    broken = false;
    await user.click(within(panel).getByRole("button", { name: `朗读 ${word}` }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(within(panel).getByRole("button", { name: `朗读 ${word}` })).toBeEnabled();
  }, 30_000);
});
