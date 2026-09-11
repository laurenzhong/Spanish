import { describe, expect, it } from "vitest";

import { getExploreLibraryForUser } from "@/src/modules/explore/application/get-explore-library";
import { CatalogExploreLibraryRepository } from "@/src/modules/explore/repositories/catalog-explore-library-repository";

const privateSource = {
  async listPersonalSuggestionCandidates() {
    return [{
      id: "10000000-0000-4000-8000-000000000001",
      title: "药店沟通",
      description: "说明症状并询问用法。",
      cefr: "A2" as const,
      role: "药剂师",
      communicationGoal: "询问药物用法",
      goalKeys: ["personal.goal.1"],
      expressionTexts: ["¿Cómo debo tomarlo?"],
    }];
  },
  async listSavedExpressions() {
    return [{
      id: "20000000-0000-4000-8000-000000000001",
      sourceText: "¿Cómo va todo?",
      translation: "一切都怎么样？",
      sourceType: "formal-expression" as const,
      sourceEntityId: "start.como-va-todo",
      sourceVersion: "1",
      createdAt: "2026-09-11T00:00:00.000Z",
    }];
  },
  async listGenerationSources() {
    return {
      savedExpressions: [{ id: "20000000-0000-4000-8000-000000000001", label: "¿Cómo va todo?", detail: "一切都怎么样？" }],
      readingHighlights: [{ id: "30000000-0000-4000-8000-000000000001", label: "Necesito más información.", detail: "来自你的阅读选区" }],
      recentErrors: [{ id: "40000000-0000-4000-8000-000000000001", label: "Quisiera explicarlo mejor.", detail: "来自已确认的近期表达问题" }],
    };
  },
};

describe("explore library projection", () => {
  it("combines previewable catalog content with owned private sources", async () => {
    const library = await getExploreLibraryForUser(
      new CatalogExploreLibraryRepository(privateSource),
      "user-1",
      { allowDraft: true },
    );

    expect(library.scenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({ stableKey: "scenario.campus-administration", sourceKind: "public", categoryLabel: "学习办事" }),
      expect.objectContaining({ stableKey: "personal.10000000-0000-4000-8000-000000000001", sourceKind: "personal" }),
    ]));
    expect(library.expressions).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "¿Cómo va todo?", sourceKind: "formal", saved: true, savedExpressionId: "20000000-0000-4000-8000-000000000001" }),
      expect.objectContaining({ text: "Necesito más información.", sourceKind: "reading", saved: false }),
      expect.objectContaining({ text: "Quisiera explicarlo mejor.", sourceKind: "recent-error", saved: false }),
    ]));
    expect(library.privateState).toBe("available");
  });

  it("keeps unreviewed public content out while retaining complete owned scenarios", async () => {
    const library = await getExploreLibraryForUser(
      new CatalogExploreLibraryRepository(privateSource),
      "user-1",
      { allowDraft: false },
    );

    expect(library.scenarios).toEqual([
      expect.objectContaining({ stableKey: "personal.10000000-0000-4000-8000-000000000001" }),
    ]);
    expect(library.expressions.some((item) => item.sourceKind === "formal")).toBe(false);
    expect(library.expressions.map((item) => item.sourceKind)).toEqual(["reading", "recent-error"]);
  });

  it("degrades to the authorized public catalog when private storage is unavailable", async () => {
    const failingSource = {
      ...privateSource,
      async listPersonalSuggestionCandidates() { throw new Error("offline"); },
    };
    const library = await getExploreLibraryForUser(
      new CatalogExploreLibraryRepository(failingSource),
      "user-1",
      { allowDraft: true },
    );

    expect(library.privateState).toBe("unavailable");
    expect(library.scenarios.some((item) => item.sourceKind === "public")).toBe(true);
    expect(library.scenarios.some((item) => item.sourceKind === "personal")).toBe(false);
  });
});
