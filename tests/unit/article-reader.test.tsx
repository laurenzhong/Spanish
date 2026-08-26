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
    expect(result.article?.segments.map((segment) => segment.position)).toEqual([0, 1, 2]);
    const draft = await getArticle(new BundleArticleRepository(), "article.sueno-first-cafe@1");
    expect(draft.reason).toBe("unpublished");
    expect(draft.article).toBeNull();
  });

  it("exposes reader settings, progress semantics, and private notes", async () => {
    const source = publishedBundle();
    const result = await getArticle(new BundleArticleRepository(source), "article.sueno-first-cafe@1");
    if (!result.article) throw new Error("fixture article not found");
    const user = userEvent.setup();
    render(<ArticleReader article={result.article} />);
    expect(screen.getByRole("heading", { name: result.article.title })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "文章阅读进度" })).toHaveAttribute("aria-valuenow", "33");
    await user.click(screen.getByRole("button", { name: "阅读设置" }));
    expect(screen.getByLabelText("字号")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "文章个人笔记" }), "下次复习这一段");
    await user.click(screen.getByRole("button", { name: "保存笔记" }));
    expect(screen.getByRole("status")).toHaveTextContent("笔记已保存在本机阅读状态中。");
  });
});
