import { listScenarioPracticeDetails } from "@/src/modules/scenario-practice/content";
import type { ScenarioSuggestionCandidateRepository, ScenarioSuggestionContextRepository } from "../application/suggest-scenario";
import { emptyScenarioSuggestionContext } from "../application/suggest-scenario";
import type { ScenarioSuggestionCandidate, ScenarioSuggestionCefr } from "../domain/scenario-suggestion";

function categoryFor(relationshipType: string): Readonly<{ key: string; label: string }> {
  if (relationshipType.includes("campus")) return { key: "study", label: "学习办事" };
  if (relationshipType.includes("rental")) return { key: "housing", label: "居住沟通" };
  if (relationshipType.includes("restaurant")) return { key: "daily-life", label: "日常生活" };
  return { key: "social", label: "社交沟通" };
}

function cefr(value: string): ScenarioSuggestionCefr {
  return (["A1", "A2", "B1", "B2", "C1", "C2"] as const).find((candidate) => candidate === value) ?? "A2";
}

export class CatalogScenarioSuggestionRepository implements ScenarioSuggestionCandidateRepository {
  async listForUser(): Promise<readonly ScenarioSuggestionCandidate[]> {
    return listScenarioPracticeDetails().map((scenario) => {
      const category = categoryFor(scenario.relationshipType);
      return {
        stableKey: scenario.stableKey,
        title: scenario.title,
        description: scenario.description,
        cefr: cefr(scenario.cefr),
        category: category.key,
        categoryLabel: category.label,
        role: scenario.temporaryCharacter.role,
        communicationGoal: scenario.tasks[0]?.prompt ?? scenario.description,
        goalKeys: scenario.tasks.map((task) => task.goalKey),
        expressionTexts: scenario.expressions.flatMap((expression) => [expression.text, ...expression.variants]),
        modalities: ["speech", "typing"],
        sourceKind: "public",
        status: scenario.status === "published" ? "published" : scenario.status === "archived" ? "archived" : "draft",
        route: `/explore/scenarios/${encodeURIComponent(scenario.stableKey)}`,
      } satisfies ScenarioSuggestionCandidate;
    });
  }
}

export const emptyScenarioSuggestionContextRepository: ScenarioSuggestionContextRepository = {
  async getForUser() {
    return emptyScenarioSuggestionContext;
  },
};
