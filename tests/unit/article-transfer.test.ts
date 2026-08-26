import { describe, expect, it } from "vitest";

import {
  articleTransferTask,
  parseArticleTransferType,
  recommendedArticleTransferType,
} from "@/src/modules/content/domain";

describe("article oral transfer", () => {
  it("accepts the four explicit transfer directions and rejects unknown values", () => {
    expect(parseArticleTransferType("summary")).toBe("summary");
    expect(parseArticleTransferType("character_dialogue")).toBe("character_dialogue");
    expect(parseArticleTransferType("typing")).toBeNull();
    expect(parseArticleTransferType(null)).toBeNull();
  });

  it("builds a contextual prompt without changing the article's recommendation", () => {
    const task = articleTransferTask({ title: "Una mañana tranquila" }, "opinion");
    expect(task.label).toBe("说说你的看法");
    expect(task.prompt).toContain("Una mañana tranquila");
    expect(recommendedArticleTransferType("personal_transfer")).toBe("personal_transfer");
    expect(recommendedArticleTransferType("none")).toBeNull();
  });
});
