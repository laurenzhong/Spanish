import { describe, expect, it } from "vitest";

import { getArticles } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";

describe("public texts bundle", () => {
  it("exposes the authorized Readlang import alongside the original alpha articles", async () => {
    const repository = new BundleArticleRepository();
    const result = await getArticles(repository, { pageSize: 24 });
    const imported = await repository.findById("article.readlang.6a8970cc201825d7541080f8@1");

    expect(result.articles).toHaveLength(24);
    expect(result.totalCount).toBe(105);
    expect(result.hasMore).toBe(true);
    expect(imported.reason).toBe("found");
    expect(imported.article?.sourceName).toBe("Readlang public library");
    expect(imported.article?.segments.length).toBeGreaterThan(0);
  });

  it("keeps a fixed twelve-article page while reporting the complete result count", async () => {
    const repository = new BundleArticleRepository();
    const secondPage = await getArticles(repository, { pageSize: 12, cursor: "12" });
    const lastPage = await getArticles(repository, { pageSize: 12, cursor: "96" });

    expect(secondPage.articles).toHaveLength(12);
    expect(secondPage.totalCount).toBe(105);
    expect(lastPage.articles).toHaveLength(9);
    expect(lastPage.nextCursor).toBeNull();
    expect(lastPage.hasMore).toBe(false);
  });
});
