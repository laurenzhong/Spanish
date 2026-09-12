import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import bundle from "@/content/bundles/alpha-core-v1.json";
import { ArticleReader } from "@/app/(product)/read/article/[articleId]/article-reader";
import { BundleArticleRepository } from "@/src/modules/content/repositories";
import { getArticle } from "@/src/modules/content/application";
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

describe("normalized article reader", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: nativeSpeechSynthesis });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: nativeSpeechSynthesisUtterance });
    vi.restoreAllMocks();
  });

  it("returns only published article versions with ordered segments", async () => {
    const source = publishedBundle();
    const repository = new BundleArticleRepository(source);
    const result = await getArticle(repository, "article.sueno-first-cafe@1");
    expect(result.reason).toBe("found");
    expect(result.article?.segments.map((segment) => segment.position)).toEqual([0, 1, 2, 3, 4]);
    const draftSource = publishedBundle();
    draftSource.articles[0] = { ...draftSource.articles[0], status: "draft" };
    const draft = await getArticle(new BundleArticleRepository(draftSource), "article.sueno-first-cafe@1");
    expect(draft.reason).toBe("unpublished");
    expect(draft.article).toBeNull();
  });

  it("renders the reading workbench and keeps notes private", async () => {
    const source = publishedBundle();
    const result = await getArticle(new BundleArticleRepository(source), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    expect(screen.getByRole("heading", { name: result.article.title })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "文章阅读进度" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("button", { name: "词典" })).toBeInTheDocument();
    expect(document.querySelector(".article-reader__layout")?.children).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "阅读工具" })).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${result.article.cefr}.*${result.article.estimatedReadingMinutes} 分钟`, "u"))).toBeInTheDocument();
    const token = screen.getAllByRole("button").find((button) => button.classList.contains("reader-token"));
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");
    await user.click(token);
    expect(screen.getByRole("button", { name: "解释" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "保存词语" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getAllByText(token.textContent ?? "").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "字号" }), "large");
    expect(screen.getByRole("combobox", { name: "字号" })).toHaveValue("large");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("textbox", { name: "文章个人笔记" })).toBeInTheDocument();
  });

  it("keeps the reader focused on the article workbench", async () => {
    const source = publishedBundle();
    const result = await getArticle(new BundleArticleRepository(source), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    expect(screen.queryByTestId("article-transfer")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "文章个人笔记" })).not.toBeInTheDocument();
    expect(screen.getByText(/来源已审核/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "朗读" }));
    expect(screen.getByRole("button", { name: "朗读本段" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "口语" }));
    expect(screen.getByTestId("article-transfer")).toBeInTheDocument();
  });

  it("lists Spanish browser voices and reuses the selected voice in Explain", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const elvira = { name: "Microsoft Elvira Online (Natural) - Spanish (Spain)", lang: "es-ES", voiceURI: "elvira-es" } as SpeechSynthesisVoice;
    const sofia = { name: "Microsoft Sofia Online (Natural) - Spanish (Bolivia)", lang: "es-BO", voiceURI: "sofia-es" } as SpeechSynthesisVoice;
    const spoken: SpeechSynthesisUtterance[] = [];
    const synthesis = {
      getVoices: () => [elvira, sofia],
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      speak: (utterance: SpeechSynthesisUtterance) => { spoken.push(utterance); utterance.onend?.(new Event("end") as SpeechSynthesisEvent); },
    } as unknown as SpeechSynthesis;
    class FakeUtterance {
      lang = "";
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(public readonly text: string) {}
    }
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "Spanish voices" })).toBeInTheDocument();
    const elviraLabels = screen.getAllByText(elvira.name);
    expect(elviraLabels.length).toBeGreaterThan(0);
    expect(elviraLabels.at(-1)?.closest("li")).toHaveClass("is-selected");
    const sofiaLabel = screen.getAllByText(sofia.name).at(-1);
    expect(sofiaLabel).toBeDefined();
    if (!sofiaLabel?.parentElement) throw new Error("voice option missing");
    await user.click(sofiaLabel.parentElement);
    expect(screen.getAllByText(sofia.name).at(-1)?.closest("li")).toHaveClass("is-selected");
    expect(window.localStorage.getItem("sueno-reader-tts-voice:es")).toBe(sofia.voiceURI);

    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("word token missing");
    await user.click(token);
    await user.click(screen.getByRole("button", { name: "朗读 cafetería" }));
    expect(spoken.at(-1)?.voice).toBe(sofia);
    await user.click(screen.getByRole("button", { name: "朗读" }));
    await user.click(screen.getByRole("button", { name: "朗读本段" }));
    expect(spoken.at(-1)?.voice).toBe(sofia);
    await user.click(screen.getByRole("button", { name: "朗读全文" }));
    expect(spoken.at(-1)?.voice).toBe(sofia);
  });

  it("opens the assist panel on demand and shows the context-aware Explain and Dictionary states", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);

    const toggle = screen.getByRole("button", { name: "解释" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("点击正文中的词语查看语境解释。")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".article-reader")?.className).toContain("article-reader--tools-open");
    expect(screen.getByText("点击正文中的词语查看语境解释。")).toBeInTheDocument();

    const café = screen.getAllByRole("button").find((button) => button.textContent?.startsWith("café"));
    expect(café).toBeDefined();
    if (!café) throw new Error("glossary token missing");
    await user.click(café);
    expect(screen.getByText("咖啡这种饮料；咖啡馆")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "词典" }));
    expect(screen.getByRole("combobox", { name: "词典源语言" })).toHaveValue("Spanish");
    expect(screen.getByRole("combobox", { name: "词典目标语言" })).toHaveValue("Chinese");
    expect(screen.getByText("还没有配置 Spanish → Chinese 词典。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "词典" }));
    expect(screen.getByRole("button", { name: "词典" })).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".article-reader")?.className).not.toContain("article-reader--tools-open");
  });

  it("requests a MiniMax explanation when a word is selected and renders the response", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("word-explanation")) {
        return new Response(JSON.stringify({ apiVersion: "v1", data: {
          partOfSpeech: "名词",
          meaning: "咖啡",
          contextualMeaning: "这里指见面的咖啡馆。",
          example: "Nos vemos en el café.",
          provider: "minimax",
          modelVersion: "MiniMax-M3",
          providerRequestId: "request-1",
          latencyMs: 20,
          estimatedCostMicros: null,
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      void init;
      return new Response(null, { status: 401 });
    });
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("word token missing");
    await user.click(token);
    await waitFor(() => expect(screen.getByText("这里指见面的咖啡馆。"))
      .toBeInTheDocument());
    expect(screen.getByText("词性")).toBeInTheDocument();
    expect(screen.getByText("基本释义")).toBeInTheDocument();
    expect(screen.getByText("本句语境义")).toBeInTheDocument();
    expect(screen.getByText("例句")).toBeInTheDocument();
    expect(screen.queryByText(/^上下文：/u)).not.toBeInTheDocument();
    expect(screen.queryByText("正在使用 MiniMax M3 生成解释……")).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "解释" })).queryByRole("button", { name: "朗读全文" })).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/read/word-explanation",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("cafetería") }),
    );
  });

  it("renders streamed explanation text before the final done event", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!String(input).includes("word-explanation")) return new Response(null, { status: 401 });
      const stream = new ReadableStream<Uint8Array>({ start(next) { controller = next; } });
      return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    });
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("word token missing");
    await user.click(token);
    await waitFor(() => expect(controller).toBeDefined());
    controller?.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: '{"meaning":"咖' }) + "\n"));
    await waitFor(() => expect(screen.getByText("咖")).toBeInTheDocument());
    controller?.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: '啡","partOfSpeech":"名词","contextualMeaning":"这里指咖啡馆。","example":"Voy a la cafetería."' }) + "\n"));
    controller?.enqueue(encoder.encode(JSON.stringify({ type: "done", explanation: { partOfSpeech: "名词", meaning: "咖啡", contextualMeaning: "这里指咖啡馆。", example: "Voy a la cafetería.", provider: "minimax", modelVersion: "MiniMax-M3", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null } }) + "\n"));
    controller?.close();
    await waitFor(() => expect(screen.getByText("这里指咖啡馆。")).toBeInTheDocument());
  });

  it("offers sentence explanation for a dragged text selection", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("word-explanation")) {
        return new Response(JSON.stringify({ apiVersion: "v1", data: {
          partOfSpeech: "句子",
          meaning: "下课后，玛尔塔走进校园里的咖啡馆。",
          contextualMeaning: "这句话交代了人物进入咖啡馆的时间、地点和原因。",
          example: "Después de clase, voy a una cafetería.",
          provider: "minimax",
          modelVersion: "MiniMax-M3",
          providerRequestId: "request-sentence-1",
          latencyMs: 20,
          estimatedCostMicros: null,
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      void init;
      return new Response(null, { status: 401 });
    });
    render(<ArticleReader article={result.article} />);
    const paragraph = document.querySelector<HTMLElement>('[data-reader-position="0"]');
    expect(paragraph).not.toBeNull();
    const tokens = paragraph ? within(paragraph).getAllByRole("button") : [];
    expect(tokens.length).toBeGreaterThan(2);
    const selection = {
      anchorNode: tokens[0]?.firstChild,
      focusNode: tokens[2]?.firstChild,
      toString: () => "clase, Marta entra en",
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(selection);
    if (!paragraph) throw new Error("article paragraph missing");
    fireEvent.mouseUp(paragraph);
    expect(screen.queryByRole("button", { name: "解析所选句子" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("这句话交代了人物进入咖啡馆的时间、地点和原因。")).toBeInTheDocument());
    const requestBody = JSON.parse(String(fetchMock.mock.calls.find(([input]) => String(input).includes("word-explanation"))?.[1]?.body)) as { word?: string; selectionType?: string };
    expect(requestBody).toMatchObject({ word: "clase, Marta entra en", selectionType: "sentence" });
  });

  it("moves focus into the assist dialog and restores it on Escape", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    const toggle = screen.getByRole("button", { name: "解释" });
    await user.click(toggle);
    const close = document.querySelector<HTMLButtonElement>(".article-reader__tools-close");
    expect(close).not.toBeNull();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
