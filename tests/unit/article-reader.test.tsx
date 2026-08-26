import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(screen.getByRole("complementary", { name: "阅读辅助" })).toBeInTheDocument();
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
    expect(screen.queryByRole("textbox", { name: "文章个人笔记" })).not.toBeInTheDocument();
  });

  it("keeps the reader focused on the article workbench", async () => {
    const source = publishedBundle();
    const result = await getArticle(new BundleArticleRepository(source), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    render(<ArticleReader article={result.article} />);
    expect(screen.queryByTestId("article-transfer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "朗读本段" })).not.toBeInTheDocument();
    expect(screen.queryByText("西语原文 · 点击词语查看辅助")).not.toBeInTheDocument();
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
});
