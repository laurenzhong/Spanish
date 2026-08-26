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
    expect(screen.getByRole("progressbar", { name: "文章阅读进度" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "阅读设置" })).toBeInTheDocument();
    expect(screen.getAllByText("阅读辅助").length).toBeGreaterThan(0);
    expect(screen.getByText(result.article.cefr)).toBeInTheDocument();
    expect(screen.getByText(result.article.estimatedReadingMinutes + " 分钟")).toBeInTheDocument();
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
    await user.type(screen.getByRole("textbox", { name: "文章个人笔记" }), "下次复习这一段");
    await user.click(screen.getByRole("button", { name: "保存笔记" }));
    expect(screen.getByRole("status")).toHaveTextContent("笔记已保存在本机阅读状态中。");
  });

  it("offers optional oral transfer without treating a typed draft as evidence", async () => {
    const source = publishedBundle();
    const result = await getArticle(new BundleArticleRepository(source), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);

    await user.click(screen.getByRole("button", { name: /说说你的看法/ }));
    expect(screen.getByLabelText("口语迁移草稿")).toBeInTheDocument();
    expect(screen.getByText("只有主动进入口语复核才会开始训练。", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入口语复核" })).toHaveAttribute(
      "href",
      `/learn/practice?article=${encodeURIComponent(result.article.id)}&transfer=opinion`,
    );

    await user.type(screen.getByLabelText("口语迁移草稿"), "Creo que...");
    await user.click(screen.getByRole("button", { name: "先保存草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("尚未进入口语评估");
    await user.click(screen.getByRole("button", { name: "跳过这一步" }));
    expect(screen.getByRole("status")).toHaveTextContent("已跳过这次口语迁移");
  });
});
