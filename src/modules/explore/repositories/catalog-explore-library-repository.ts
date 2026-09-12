import historicCoreBundle from "@/content/bundles/alpha-core-v1.json";
import coreBundle from "@/content/bundles/alpha-core-v2.json";

import { validateContentBundle } from "@/src/modules/content/import";
import type { ContentBundle } from "@/src/modules/content/schemas";
import { listScenarioPracticeDetails } from "@/src/modules/scenario-practice/content";
import type { ScenarioLibraryRepository } from "@/src/modules/scenario-practice/repositories";
import type {
  ExploreExpressionLibraryCard,
  ExploreLibraryDto,
  ExploreScenarioLibraryCard,
} from "../domain/explore-library";

const content = validateContentBundle(coreBundle) as ContentBundle;
const historicContent = validateContentBundle(historicCoreBundle) as ContentBundle;

export type ExploreLibraryRepositoryOptions = Readonly<{ allowDraft?: boolean }>;
export type ExplorePrivateLibrarySource = Pick<
  ScenarioLibraryRepository,
  "listGenerationSources" | "listPersonalSuggestionCandidates" | "listSavedExpressions"
>;
export interface ExploreLibraryRepository {
  getForUser(userId: string, options?: ExploreLibraryRepositoryOptions): Promise<ExploreLibraryDto>;
}

function localized(value: Record<string, string>): string {
  return value["zh-CN"] ?? value.zh ?? Object.values(value)[0] ?? "";
}

function categoryFor(relationshipType: string): Readonly<{ key: string; label: string }> {
  if (relationshipType.includes("campus")) return { key: "study", label: "学习办事" };
  if (relationshipType.includes("rental")) return { key: "housing", label: "居住沟通" };
  if (relationshipType.includes("restaurant")) return { key: "daily-life", label: "日常生活" };
  return { key: "social", label: "社交沟通" };
}

function publicScenarios(allowDraft: boolean): ExploreScenarioLibraryCard[] {
  return listScenarioPracticeDetails()
    .filter((scenario) => scenario.status === "published" || (allowDraft && scenario.status !== "archived"))
    .map((scenario) => {
      const category = categoryFor(scenario.relationshipType);
      return {
        stableKey: scenario.stableKey,
        title: scenario.title,
        description: scenario.description,
        cefr: scenario.cefr,
        region: scenario.temporaryCharacter.locale,
        category: category.key,
        categoryLabel: category.label,
        role: scenario.temporaryCharacter.role,
        communicationGoal: scenario.tasks.map((task) => task.prompt).join("；"),
        expressionTexts: scenario.expressions.flatMap((expression) => [expression.text, ...expression.variants]),
        sourceKind: "public" as const,
        route: `/explore/scenarios/${encodeURIComponent(scenario.stableKey)}`,
      };
    });
}

function publicExpressions(
  allowDraft: boolean,
  savedByFormalKey: ReadonlyMap<string, Readonly<{ id: string }>>,
): ExploreExpressionLibraryCard[] {
  const goals = new Map(content.goals.map((goal) => [goal.stableKey, goal]));
  const domains = new Map(content.domains.map((domain) => [domain.stableKey, domain]));
  return content.expressions
    .filter((expression) => expression.status === "published" || (allowDraft && expression.status !== "archived"))
    .map((expression) => {
      const goal = goals.get(expression.goalKey);
      const domain = goal ? domains.get(goal.domainKey) : undefined;
      const saved = savedByFormalKey.get(`${expression.stableKey}@${expression.version}`);
      return {
        id: `formal:${expression.stableKey}@${expression.version}`,
        text: expression.text,
        translation: localized(expression.translations),
        intent: localized(expression.communicativeIntent),
        cefr: expression.cefr,
        region: expression.region,
        category: domain?.stableKey ?? expression.goalKey,
        categoryLabel: domain ? localized(domain.title) : goal ? localized(goal.title) : "正式表达",
        sourceKind: "formal" as const,
        saved: Boolean(saved),
        ...(saved ? {
          savedExpressionId: saved.id,
          generationSource: { sourceType: "saved-expression" as const, sourceId: saved.id },
        } : {
          saveSource: { sourceType: "formal-expression" as const, expressionKey: expression.stableKey, version: expression.version },
        }),
      };
    });
}

function historicalSavedFormalExpressions(
  saved: Awaited<ReturnType<ExplorePrivateLibrarySource["listSavedExpressions"]>>,
): ExploreExpressionLibraryCard[] {
  const currentKeys = new Set(
    content.expressions.map(
      (expression) => `${expression.stableKey}@${expression.version}`,
    ),
  );
  const goals = new Map(
    historicContent.goals.map((goal) => [goal.stableKey, goal]),
  );
  const domains = new Map(
    historicContent.domains.map((domain) => [domain.stableKey, domain]),
  );

  return saved.flatMap((item) => {
    if (
      item.sourceType !== "formal-expression" ||
      !item.sourceEntityId ||
      !item.sourceVersion
    ) {
      return [];
    }
    const version = Number(item.sourceVersion);
    const formalKey = `${item.sourceEntityId}@${version}`;
    if (currentKeys.has(formalKey)) return [];

    const expression = historicContent.expressions.find(
      (candidate) =>
        candidate.stableKey === item.sourceEntityId &&
        candidate.version === version,
    );
    if (!expression) return [];

    const goal = goals.get(expression.goalKey);
    const domain = goal ? domains.get(goal.domainKey) : undefined;
    return [{
      id: `formal:${formalKey}`,
      text: expression.text,
      translation: localized(expression.translations),
      intent: localized(expression.communicativeIntent),
      cefr: expression.cefr,
      region: expression.region,
      category: domain?.stableKey ?? expression.goalKey,
      categoryLabel: domain
        ? localized(domain.title)
        : goal
          ? localized(goal.title)
          : "正式表达",
      sourceKind: "formal" as const,
      saved: true,
      savedExpressionId: item.id,
      generationSource: {
        sourceType: "saved-expression" as const,
        sourceId: item.id,
      },
    }];
  });
}

export class CatalogExploreLibraryRepository implements ExploreLibraryRepository {
  constructor(private readonly privateSource?: ExplorePrivateLibrarySource) {}

  async getForUser(userId: string, options: ExploreLibraryRepositoryOptions = {}): Promise<ExploreLibraryDto> {
    const allowDraft = options.allowDraft === true;
    if (!this.privateSource) {
      return { scenarios: publicScenarios(allowDraft), expressions: publicExpressions(allowDraft, new Map()), privateState: "unavailable" };
    }

    try {
      const [personal, saved, sources] = await Promise.all([
        this.privateSource.listPersonalSuggestionCandidates(userId),
        this.privateSource.listSavedExpressions(userId),
        this.privateSource.listGenerationSources(userId),
      ]);
      const savedByFormalKey = new Map(saved.flatMap((item) => item.sourceType === "formal-expression" && item.sourceEntityId && item.sourceVersion
        ? [[`${item.sourceEntityId}@${item.sourceVersion}`, { id: item.id }]]
        : []));
      const savedBySource = new Map(saved.flatMap((item) => item.sourceEntityId ? [[`${item.sourceType}:${item.sourceEntityId}`, item]] : []));
      const visibleSourceKeys = new Set([
        ...sources.readingHighlights.map((item) => `reading-selection:${item.id}`),
        ...sources.recentErrors.map((item) => `scenario-review:${item.id}`),
      ]);
      const personalScenarios: ExploreScenarioLibraryCard[] = personal.map((scenario) => ({
        stableKey: `personal.${scenario.id}`,
        title: scenario.title,
        description: scenario.description,
        cefr: scenario.cefr,
        region: scenario.region ?? "es-ES",
        category: "personal",
        categoryLabel: "私人场景",
        role: scenario.role,
        communicationGoal: scenario.communicationGoal,
        expressionTexts: scenario.expressionTexts,
        sourceKind: "personal",
        route: `/explore/scenarios/${encodeURIComponent(`personal.${scenario.id}`)}`,
      }));
      const readingExpressions: ExploreExpressionLibraryCard[] = sources.readingHighlights.map((item) => {
        const savedItem = savedBySource.get(`reading-selection:${item.id}`);
        return {
          id: `reading:${item.id}`,
          text: item.label,
          translation: null,
          intent: item.detail,
          cefr: null,
          region: null,
          category: "reading",
          categoryLabel: "阅读来源",
          sourceKind: "reading",
          saved: Boolean(savedItem),
          ...(savedItem ? { savedExpressionId: savedItem.id } : { saveSource: { sourceType: "reading-selection" as const, highlightId: item.id } }),
          generationSource: { sourceType: "reading" as const, sourceId: item.id },
        };
      });
      const recentExpressions: ExploreExpressionLibraryCard[] = sources.recentErrors.map((item) => {
        const savedItem = savedBySource.get(`scenario-review:${item.id}`);
        return {
          id: `recent-error:${item.id}`,
          text: item.label,
          translation: null,
          intent: item.detail,
          cefr: null,
          region: null,
          category: "recent-error",
          categoryLabel: "近期难点",
          sourceKind: "recent-error",
          saved: Boolean(savedItem),
          ...(savedItem ? { savedExpressionId: savedItem.id } : { saveSource: { sourceType: "scenario-review" as const, reviewId: item.id } }),
          generationSource: { sourceType: "recent-error" as const, sourceId: item.id },
        };
      });
      const standaloneSaved: ExploreExpressionLibraryCard[] = saved
        .filter((item) => item.sourceType !== "formal-expression" && (!item.sourceEntityId || !visibleSourceKeys.has(`${item.sourceType}:${item.sourceEntityId}`)))
        .map((item) => ({
          id: `saved:${item.id}`,
          text: item.sourceText,
          translation: item.translation,
          intent: null,
          cefr: null,
          region: null,
          category: "saved",
          categoryLabel: "我的收藏",
          sourceKind: "saved" as const,
          saved: true,
          savedExpressionId: item.id,
          generationSource: { sourceType: "saved-expression" as const, sourceId: item.id },
        }));
      const historicalFormal = historicalSavedFormalExpressions(saved);
      return {
        scenarios: [...personalScenarios, ...publicScenarios(allowDraft)],
        expressions: [
          ...publicExpressions(allowDraft, savedByFormalKey),
          ...historicalFormal,
          ...standaloneSaved,
          ...readingExpressions,
          ...recentExpressions,
        ],
        privateState: "available",
      };
    } catch {
      return { scenarios: publicScenarios(allowDraft), expressions: publicExpressions(allowDraft, new Map()), privateState: "unavailable" };
    }
  }
}
