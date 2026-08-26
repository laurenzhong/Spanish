import { describe, expect, it } from "vitest";

import { getArticles } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";

describe("public texts bundle", () => {
  it("exposes the authorized Readlang import alongside the original alpha articles", async () => {
    const repository = new BundleArticleRepository();
    const result = await getArticles(repository, { pageSize: 24 });
    const imported = await repository.findById("article.readlang.6a8970cc201825d7541080f8@1");

    expect(result.articles).toHaveLength(24);
    expect(result.hasMore).toBe(true);
    expect(imported.reason).toBe("found");
    expect(imported.article?.sourceName).toBe("Readlang public library");
    expect(imported.article?.segments.length).toBeGreaterThan(0);
  });
});
