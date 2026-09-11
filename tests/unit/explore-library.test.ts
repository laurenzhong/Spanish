import { describe, expect, it } from "vitest";

import {
  filterExploreLibrary,
  normalizeExploreSearchText,
  type ExploreLibraryDto,
} from "@/src/modules/explore/domain/explore-library";

const library: ExploreLibraryDto = {
  privateState: "available",
  scenarios: [
    {
      stableKey: "scenario.campus-administration",
      title: "校园办事：注册与材料",
      description: "在学校行政窗口说明来意。",
      cefr: "A2",
      region: "es-ES",
      category: "study",
      categoryLabel: "学习办事",
      role: "校园行政工作人员",
      communicationGoal: "说明来意并确认材料",
      expressionTexts: ["Quisiera entregar estos documentos."],
      sourceKind: "public",
      route: "/explore/scenarios/scenario.campus-administration",
    },
  ],
  expressions: [
    {
      id: "formal.como-va@1",
      text: "¿Cómo va todo?",
      translation: "一切都怎么样？",
      intent: "轻松询问近况",
      cefr: "A1",
      region: "es-ES",
      category: "communication.start",
      categoryLabel: "开始交流",
      sourceKind: "formal",
      saved: false,
      saveSource: { sourceType: "formal-expression", expressionKey: "start.como-va-todo", version: 1 },
    },
    {
      id: "saved-1",
      text: "¿Me puede ayudar?",
      translation: "您能帮我吗？",
      intent: null,
      cefr: null,
      region: null,
      category: "saved",
      categoryLabel: "我的收藏",
      sourceKind: "saved",
      saved: true,
      savedExpressionId: "saved-1",
      generationSource: { sourceType: "saved-expression", sourceId: "saved-1" },
    },
    {
      id: "review-1",
      text: "Necesito explicar el problema.",
      translation: null,
      intent: "来自已确认的近期表达问题",
      cefr: null,
      region: null,
      category: "recent-error",
      categoryLabel: "近期难点",
      sourceKind: "recent-error",
      saved: false,
      saveSource: { sourceType: "scenario-review", reviewId: "review-1" },
      generationSource: { sourceType: "recent-error", sourceId: "review-1" },
    },
  ],
};

describe("explore library search and filters", () => {
  it("normalizes Spanish accents, case, punctuation, and repeated whitespace", () => {
    expect(normalizeExploreSearchText("  ¿CÓMO   está? ")).toBe("como esta");
  });

  it("matches every query token across scenario metadata and expressions", () => {
    expect(filterExploreLibrary(library, { query: "A2 entregar", filter: "all" }).scenarios).toHaveLength(1);
    expect(filterExploreLibrary(library, { query: "como", filter: "all" }).expressions.map((item) => item.id)).toEqual(["formal.como-va@1"]);
  });

  it("keeps source filters mutually exclusive and gives available to startable scenarios", () => {
    expect(filterExploreLibrary(library, { query: "", filter: "saved" }).expressions.map((item) => item.id)).toEqual(["saved-1"]);
    expect(filterExploreLibrary(library, { query: "", filter: "recent-error" }).expressions.map((item) => item.id)).toEqual(["review-1"]);
    const available = filterExploreLibrary(library, { query: "", filter: "available" });
    expect(available.scenarios).toHaveLength(1);
    expect(available.expressions).toHaveLength(0);
  });

  it("returns empty groups without changing the authorized source DTO", () => {
    const result = filterExploreLibrary(library, { query: "不存在", filter: "all" });
    expect(result).toMatchObject({ scenarios: [], expressions: [] });
    expect(library.scenarios).toHaveLength(1);
    expect(library.expressions).toHaveLength(3);
  });
});
