import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArticleReader } from "@/app/(product)/read/article/[articleId]/article-reader";
import type { ArticleReaderProjection } from "@/src/modules/content/domain";

/**
 * Render-cost harness for the reading workbench.
 *
 * Every article word is rendered as its own token element, so a full body
 * re-render is proportional to the article length (a real article has
 * 1,000-2,600 words). Counting React element creation therefore measures
 * exactly the work a reader interaction performs, independently of jsdom
 * timing noise.
 */
const counters = vi.hoisted(() => ({ elements: 0, resets: 0 }));

vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { counters.elements += 1; return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { counters.elements += 1; return actual.jsxs(...args); },
  };
});

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => { counters.elements += 1; return actual.jsxDEV(...args); },
  };
});

const SEGMENT_TEXT = "Cuando Marta entró en la pequeña cafetería del barrio, el dueño levantó la vista y sonrió con calma mientras preparaba el primer café de la mañana.";

function longArticle(segmentCount = 40): ArticleReaderProjection {
  return {
    id: "article.render-cost@1",
    stableKey: "article.render-cost",
    version: 1,
    locale: "es-ES",
    title: "Coste de renderizado",
    summary: "",
    cefr: "A2",
    topics: [],
    region: "es-ES",
    register: "neutral",
    format: "story",
    estimatedReadingMinutes: 8,
    sourceName: "fixture",
    author: null,
    publicationDate: null,
    assets: { audio: false, chineseSummary: false, wordHelp: false, image: false },
    oralTransferType: "none",
    contentHash: "hash-render-cost",
    sourceUrl: null,
    attribution: null,
    segments: Array.from({ length: segmentCount }, (_, position) => ({ position, text: SEGMENT_TEXT })),
  };
}

function resetCounter(): void {
  counters.elements = 0;
  counters.resets += 1;
}

function createdElements(): number {
  return counters.elements;
}

function ndjsonResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

function selectSentenceInFirstParagraph(): void {
  const paragraph = document.querySelector<HTMLElement>('[data-reader-position="0"]');
  if (!paragraph) throw new Error("paragraph missing");
  const tokens = within(paragraph).getAllByRole("button");
  vi.spyOn(window, "getSelection").mockReturnValue({
    anchorNode: tokens[0]?.firstChild,
    focusNode: tokens[3]?.firstChild,
    toString: () => "Cuando Marta entró en",
    removeAllRanges: vi.fn(),
  } as unknown as Selection);
  fireEvent.mouseUp(paragraph);
}

describe("article reader render cost", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps a drag selection from re-rendering the whole article body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("word-explanation")) return ndjsonResponse([JSON.stringify({ type: "done", explanation: { partOfSpeech: "句子", meaning: "翻译", contextualMeaning: "解析", example: "Ejemplo.", provider: "minimax", modelVersion: "test", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null } }) + "\n"]);
      return new Response(null, { status: 401 });
    });
    render(<ArticleReader article={longArticle()} />);
    expect(screen.queryByRole("dialog", { name: "解释" })).not.toBeInTheDocument();
    resetCounter();
    selectSentenceInFirstParagraph();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "解释" })).toBeInTheDocument());
    const selectionCost = createdElements();
    console.log("[render-cost] sentence selection", selectionCost);
    expect(selectionCost).toBeLessThan(800);
  });

  it("keeps streamed translation deltas from re-rendering the whole article body", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!String(input).includes("word-explanation")) return new Response(null, { status: 401 });
      const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    });
    render(<ArticleReader article={longArticle()} />);
    selectSentenceInFirstParagraph();
    await waitFor(() => expect(streamController).toBeDefined());
    const deltas = Array.from({ length: 20 }, (_, index) => JSON.stringify({ type: "delta", text: `{"meaning":"翻译第${index}段` }) + "\n");
    resetCounter();
    for (const delta of deltas) streamController?.enqueue(encoder.encode(delta));
    streamController?.enqueue(encoder.encode(JSON.stringify({ type: "done", explanation: { partOfSpeech: "句子", meaning: "最终翻译", contextualMeaning: "最终解析", example: "Ejemplo.", provider: "minimax", modelVersion: "test", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null } }) + "\n"));
    streamController?.close();
    await waitFor(() => expect(screen.getByText("最终解析")).toBeInTheDocument());
    const streamingCost = createdElements();
    console.log("[render-cost] 20 streamed deltas", streamingCost);
    expect(streamingCost).toBeLessThan(600);
  });

  it("keeps scroll position updates from re-rendering the whole article body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 401 }));
    render(<ArticleReader article={longArticle()} />);
    resetCounter();
    fireEvent.scroll(window);
    await waitFor(() => expect(Number(screen.getByRole("progressbar", { name: "文章阅读进度" }).getAttribute("aria-valuenow"))).toBeGreaterThan(0));
    const scrollCost = createdElements();
    console.log("[render-cost] scroll position update", scrollCost);
    expect(scrollCost).toBeLessThan(600);
  });
});
