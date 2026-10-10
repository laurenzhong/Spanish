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
    vi.unstubAllGlobals();
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
    expect(screen.getAllByRole("heading", { name: result.article.title })).toHaveLength(1);
    expect(document.querySelector(".article-reader__document-header")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "文章阅读进度" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("heading", { name: result.article.title })).toBeVisible();
    expect(screen.queryByText(result.article.summary)).not.toBeInTheDocument();
    expect(screen.queryByText(/来源已审核/u)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${result.article.cefr}.*${result.article.estimatedReadingMinutes} 分钟`, "u"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "朗读" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解释" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "词典" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "口语" })).not.toBeInTheDocument();
    expect(document.querySelector(".article-reader__layout")?.children).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "阅读工具" })).not.toBeInTheDocument();
    const token = screen.getAllByRole("button").find((button) => button.classList.contains("reader-token"));
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");
    await user.click(token);
    expect(screen.getByRole("dialog", { name: "解释" })).toBeInTheDocument();
    expect(token).toHaveClass("is-translation-selection");
    await user.click(screen.getByRole("button", { name: "保存词语" }));
    await user.click(screen.getByRole("button", { name: "收藏" }));
    expect(screen.getAllByText(token.textContent ?? "").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "字号" }), "large");
    expect(screen.getByRole("combobox", { name: "字号" })).toHaveValue("large");
    await user.click(screen.getByRole("button", { name: "收藏" }));
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
    await user.click(screen.getByRole("button", { name: "朗读" }));
    expect(screen.getByText("当前：第 1 段")).toBeInTheDocument();
    expect(screen.getByText(result.article.segments[0]?.text.slice(0, 56) ?? "", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "朗读第 1 段" })).toBeInTheDocument();
    expect(document.querySelector('[data-reader-position="0"]')).toHaveClass("is-listen-target");
    await user.click(screen.getByText("读完后练口语", { selector: "summary" }));
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
    await user.click(screen.getByRole("button", { name: "朗读第 1 段" }));
    expect(spoken.at(-1)?.voice).toBe(sofia);
    await user.click(screen.getByRole("button", { name: "朗读全文" }));
    expect(spoken.at(-1)?.voice).toBe(sofia);
  });

  it("opens the contextual explanation only after selecting text", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);

    expect(screen.queryByRole("button", { name: "解释" })).not.toBeInTheDocument();
    expect(screen.queryByText("点击正文中的词语查看语境解释。")).not.toBeInTheDocument();

    const café = screen.getAllByRole("button").find((button) => button.textContent?.startsWith("café"));
    expect(café).toBeDefined();
    if (!café) throw new Error("glossary token missing");
    await user.click(café);
    expect(screen.getByRole("dialog", { name: "解释" })).toBeInTheDocument();
    expect(screen.getByText("咖啡这种饮料；咖啡馆")).toBeInTheDocument();
    expect(screen.queryByText("还没有配置 Spanish → Chinese 词典。")).not.toBeInTheDocument();
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
    expect(tokens.slice(0, 3).every((token) => token.classList.contains("is-translation-selection"))).toBe(true);
    await waitFor(() => expect(screen.getByText("这句话交代了人物进入咖啡馆的时间、地点和原因。")).toBeInTheDocument());
    const requestBody = JSON.parse(String(fetchMock.mock.calls.find(([input]) => String(input).includes("word-explanation"))?.[1]?.body)) as { word?: string; selectionType?: string };
    expect(requestBody).toMatchObject({ word: "clase, Marta entra en", selectionType: "sentence" });
  });

  it("keeps a sentence selection that ends on the whitespace between words", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("word-explanation")) {
        return new Response(JSON.stringify({ apiVersion: "v1", data: {
          partOfSpeech: "句子",
          meaning: "下课后，玛尔塔走进校园里的咖啡馆。",
          contextualMeaning: "整句仍然可以被解析，即使拖选停在词间空白。",
          example: "Después de clase, voy a una cafetería.",
          provider: "minimax",
          modelVersion: "MiniMax-M3",
          providerRequestId: "request-whitespace-boundary",
          latencyMs: 20,
          estimatedCostMicros: null,
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      void init;
      return new Response(null, { status: 401 });
    });
    render(<ArticleReader article={result.article} />);
    const paragraph = document.querySelector<HTMLElement>('[data-reader-position="0"]');
    if (!paragraph) throw new Error("article paragraph missing");
    const tokens = within(paragraph).getAllByRole("button");
    const startWhitespace = tokens[1]?.nextSibling;
    const endWhitespace = tokens[4]?.nextSibling;
    if (!startWhitespace || !endWhitespace) throw new Error("whitespace boundaries missing");
    const range = document.createRange();
    range.setStart(startWhitespace, 0);
    range.setEnd(endWhitespace, endWhitespace.textContent?.length ?? 0);
    const selectedText = range.toString().trim();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(paragraph);

    await waitFor(() => expect(screen.getByText("整句仍然可以被解析，即使拖选停在词间空白。")).toBeInTheDocument());
    expect(tokens.slice(2, 5).every((token) => token.classList.contains("is-translation-selection"))).toBe(true);
    expect(tokens[1]).not.toHaveClass("is-translation-selection");
    const requestBody = JSON.parse(String(fetchMock.mock.calls.find(([input]) => String(input).includes("word-explanation"))?.[1]?.body)) as { word?: string; selectionType?: string };
    expect(requestBody).toMatchObject({ word: selectedText, selectionType: "sentence" });
  });

  it("keeps a sentence drag that is released outside the paragraph", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("word-explanation")) {
        return new Response(JSON.stringify({ apiVersion: "v1", data: {
          partOfSpeech: "句子",
          meaning: "松手落在段落外也必须解析整句。",
          contextualMeaning: "段落之间的空白与页边距同样属于拖选手势。",
          example: "Después de clase, voy a una cafetería.",
          provider: "minimax",
          modelVersion: "MiniMax-M3",
          providerRequestId: "request-outside-paragraph",
          latencyMs: 20,
          estimatedCostMicros: null,
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 401 });
    });
    render(<ArticleReader article={result.article} />);
    const paragraph = document.querySelector<HTMLElement>('[data-reader-position="0"]');
    const body = document.querySelector<HTMLElement>(".article-reader__body");
    if (!paragraph || !body) throw new Error("article paragraph missing");
    const tokens = within(paragraph).getAllByRole("button");
    const range = document.createRange();
    range.setStart(tokens[1]?.firstChild ?? paragraph, 0);
    range.setEnd(tokens[3]?.firstChild ?? paragraph, tokens[3]?.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(body);

    await waitFor(() => expect(screen.getByText("段落之间的空白与页边距同样属于拖选手势。")).toBeInTheDocument());
    expect(paragraph.querySelectorAll(".reader-token.is-translation-selection")).toHaveLength(3);
  });

  it("keeps a backward drag that starts in a later paragraph", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("word-explanation")) {
        return new Response(JSON.stringify({ apiVersion: "v1", data: {
          partOfSpeech: "句子",
          meaning: "反向跨段拖选时解析起点段落。",
          contextualMeaning: "鼠标按下的段落决定解析目标。",
          example: "Después de clase, voy a una cafetería.",
          provider: "minimax",
          modelVersion: "MiniMax-M3",
          providerRequestId: "request-cross-paragraph",
          latencyMs: 20,
          estimatedCostMicros: null,
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 401 });
    });
    render(<ArticleReader article={result.article} />);
    const first = document.querySelector<HTMLElement>('[data-reader-position="0"]');
    const second = document.querySelector<HTMLElement>('[data-reader-position="1"]');
    if (!first || !second) throw new Error("article paragraphs missing");
    const firstTokens = within(first).getAllByRole("button");
    const secondTokens = within(second).getAllByRole("button");
    const selection = window.getSelection();
    selection?.removeAllRanges();
    // Backward drag: the pointer goes down inside the second paragraph and is released in the first one.
    selection?.setBaseAndExtent(secondTokens[2]?.firstChild ?? second, 0, firstTokens[1]?.firstChild ?? first, 0);
    fireEvent.mouseUp(document.querySelector(".article-reader") ?? second);

    await waitFor(() => expect(screen.getByText("鼠标按下的段落决定解析目标。")).toBeInTheDocument());
    // Only the pressed paragraph is translated, and only up to the pressed word.
    expect(second.querySelectorAll(".reader-token.is-translation-selection")).toHaveLength(3);
    expect(first.querySelectorAll(".reader-token.is-translation-selection")).toHaveLength(0);
  });

  it("dismisses a temporary explanation on outside click", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");

    await user.click(token);
    expect(screen.getByRole("dialog", { name: "解释" })).toBeInTheDocument();
    expect(token).toHaveClass("is-translation-selection");
    await user.click(screen.getByRole("heading", { name: result.article.title }));
    expect(screen.queryByRole("dialog", { name: "解释" })).not.toBeInTheDocument();
    expect(token).not.toHaveClass("is-translation-selection");
  });

  it("lets the unpinned translator be dragged within the desktop viewport", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
    render(<ArticleReader article={result.article} />);
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");
    await user.click(token);
    const translator = screen.getByRole("dialog", { name: "解释" });
    vi.spyOn(translator, "getBoundingClientRect").mockReturnValue({ x: 1000, y: 80, width: 360, height: 500, top: 80, right: 1360, bottom: 580, left: 1000, toJSON: () => ({}) });
    const handle = screen.getByTestId("translator-drag-handle");
    fireEvent.pointerDown(handle, { button: 0, clientX: 1060, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 420, clientY: 230, pointerId: 1 });
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(translator).toHaveStyle({ left: "360px", top: "210px" });
  });

  it("keeps a pinned translator open until it is unpinned", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");

    await user.click(token);
    const pin = screen.getByRole("button", { name: "固定翻译器" });
    await user.click(pin);
    expect(pin).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".article-reader")).toHaveClass("article-reader--tools-pinned");
    await user.click(screen.getByRole("heading", { name: result.article.title }));
    expect(screen.getByRole("dialog", { name: "解释" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消固定翻译器" }));
    await user.click(screen.getByRole("heading", { name: result.article.title }));
    expect(screen.queryByRole("dialog", { name: "解释" })).not.toBeInTheDocument();
  });

  it("keeps word tokens out of the tab order until the keyboard is used", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    render(<ArticleReader article={result.article} />);
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");
    // A focusable word token makes Chrome swallow drag selections that start on a
    // word boundary, so tokens stay out of the tab order for pointer reading.
    expect(token).not.toHaveAttribute("tabindex");
    fireEvent.keyDown(document, { key: "Tab" });
    await waitFor(() => expect(token).toHaveAttribute("tabindex", "0"));
    fireEvent.pointerUp(document);
    await waitFor(() => expect(token).not.toHaveAttribute("tabindex"));
  });

  it("moves focus to the pin control and restores it on Escape", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    await user.keyboard("{Tab}");
    const token = screen.getAllByRole("button").find((button) => button.textContent === "cafetería");
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");
    expect(token).toHaveAttribute("tabindex", "0");
    token.focus();
    await user.keyboard("{Enter}");
    const pin = screen.getByRole("button", { name: "固定翻译器" });
    expect(pin).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(token).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes a deleted saved phrase from an open reader", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const key = `reading-reader:v1:${result.article.stableKey}`;
    const initial = {
      stableKey: result.article.stableKey,
      version: result.article.version,
      contentHash: result.article.contentHash,
      position: 0,
      savedPhrases: [{ id: "0:cafetería", text: "cafetería", position: 0 }],
      highlights: [],
      note: "",
      saved: false,
    };
    window.localStorage.setItem(key, JSON.stringify(initial));
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    await user.click(screen.getByRole("button", { name: "收藏" }));
    await waitFor(() => expect(screen.getByText("cafetería", { selector: ".article-reader__saved-list span" })).toBeInTheDocument());

    window.localStorage.setItem(key, JSON.stringify({ ...initial, savedPhrases: [] }));
    window.dispatchEvent(new CustomEvent("sueno:reading-saved-item-removed", {
      detail: { stableKey: result.article.stableKey, version: result.article.version },
    }));

    await waitFor(() => expect(screen.queryByText("cafetería", { selector: ".article-reader__saved-list span" })).not.toBeInTheDocument());
    expect(screen.getByText("尚未保存词语或高亮。")).toBeInTheDocument();
  });

  it("does not restore annotations from another article version with the same hash", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    window.localStorage.setItem(`reading-reader:v1:${result.article.stableKey}`, JSON.stringify({
      stableKey: result.article.stableKey,
      version: result.article.version - 1,
      contentHash: result.article.contentHash,
      position: 0,
      savedPhrases: [{ id: "0:old phrase", text: "old phrase", position: 0 }],
      highlights: [],
      note: "",
      saved: false,
    }));
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    await user.click(screen.getByRole("button", { name: "收藏" }));
    expect(screen.queryByText("old phrase", { selector: ".article-reader__saved-list span" })).not.toBeInTheDocument();
    expect(screen.getByText("尚未保存词语或高亮。")).toBeInTheDocument();
  });
});
