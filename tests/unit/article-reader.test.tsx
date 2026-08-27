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

describe("normalized article reader", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
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
    expect(screen.getByRole("link", { name: /返回文章库/ })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("tab", { name: "Dictionary" })).toBeInTheDocument();
    expect(document.querySelector(".article-reader__layout")?.children).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "阅读辅助" })).toBeInTheDocument();
    expect(screen.getAllByText("阅读辅助").length).toBeGreaterThan(0);
    expect(screen.queryByText(result.article.cefr)).not.toBeInTheDocument();
    expect(screen.queryByText(result.article.estimatedReadingMinutes + " 分钟")).not.toBeInTheDocument();
    const token = screen.getAllByRole("button").find((button) => button.classList.contains("reader-token"));
    expect(token).toBeDefined();
    if (!token) throw new Error("reader token missing");
    await user.click(token);
    expect(screen.getByRole("tab", { name: "Explain" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "保存词语" }));
    await user.click(screen.getByRole("tab", { name: "Words" }));
    expect(screen.getAllByText(token.textContent ?? "").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "字号" }), "large");
    expect(screen.getByRole("combobox", { name: "字号" })).toHaveValue("large");
    expect(screen.getByRole("textbox", { name: "文章个人笔记" })).toBeInTheDocument();
  });

  it("keeps the reader focused on the article workbench", async () => {
    const source = publishedBundle();
    const result = await getArticle(new BundleArticleRepository(source), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    render(<ArticleReader article={result.article} />);
    expect(screen.getByTestId("article-transfer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "朗读本段" })).toBeInTheDocument();
    expect(screen.getByText("西语原文", { exact: true })).toBeInTheDocument();
  });

  it("opens the assist panel on demand and shows the context-aware Explain and Dictionary states", async () => {
    const result = await getArticle(new BundleArticleRepository(publishedBundle()), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);

    const toggle = screen.getByRole("button", { name: "打开阅读辅助" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Click any word on the left for a context-aware explanation.")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".article-reader")?.className).toContain("article-reader--tools-open");

    const café = screen.getAllByRole("button").find((button) => button.textContent?.startsWith("café"));
    expect(café).toBeDefined();
    if (!café) throw new Error("glossary token missing");
    await user.click(café);
    expect(screen.getByText("咖啡；也可以指喝咖啡的场所")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Dictionary" }));
    expect(screen.getByRole("combobox", { name: "词典源语言" })).toHaveValue("Spanish");
    expect(screen.getByRole("combobox", { name: "词典目标语言" })).toHaveValue("Chinese");
    expect(screen.getByText("还没有配置 Spanish → Chinese 词典。")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
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
    const café = screen.getAllByRole("button").find((button) => button.textContent?.startsWith("café"));
    expect(café).toBeDefined();
    if (!café) throw new Error("word token missing");
    await user.click(café);
    await waitFor(() => expect(screen.getByText("这里指见面的咖啡馆。"))
      .toBeInTheDocument());
    expect(screen.getByText("词性")).toBeInTheDocument();
    expect(screen.getByText("基本释义")).toBeInTheDocument();
    expect(screen.getByText("本句语境义")).toBeInTheDocument();
    expect(screen.getByText("例句")).toBeInTheDocument();
    expect(screen.queryByText(/^上下文：/u)).not.toBeInTheDocument();
    expect(screen.queryByText("正在使用 MiniMax M3 生成解释……")).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "阅读辅助" })).queryByRole("button", { name: "朗读全文" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/read/word-explanation",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("café") }),
    );
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
    const toggle = screen.getByRole("button", { name: "打开阅读辅助" });
    await user.click(toggle);
    const close = document.querySelector<HTMLButtonElement>(".article-reader__tools-close");
    expect(close).not.toBeNull();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
