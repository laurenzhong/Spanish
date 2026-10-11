export const exploreLibraryFilters = ["all", "formal", "saved", "recent-error", "reading", "available"] as const;
export type ExploreLibraryFilter = (typeof exploreLibraryFilters)[number];

export type ExploreScenarioLibraryCard = Readonly<{
  stableKey: string;
  title: string;
  description: string;
  cefr: string;
  region: string;
  category: string;
  categoryLabel: string;
  role: string;
  communicationGoal: string;
  expressionTexts: readonly string[];
  sourceKind: "public" | "personal";
  route: string;
}>;

export type ExploreExpressionSaveSource =
  | Readonly<{ sourceType: "formal-expression"; expressionKey: string; version: number }>
  | Readonly<{ sourceType: "reading-selection"; highlightId: string }>
  | Readonly<{ sourceType: "scenario-review"; reviewId: string }>;

export type ExploreExpressionGenerationSource =
  | Readonly<{ sourceType: "saved-expression" | "reading" | "recent-error"; sourceId: string }>;

export type ExploreExpressionLibraryCard = Readonly<{
  id: string;
  text: string;
  translation: string | null;
  intent: string | null;
  cefr: string | null;
  region: string | null;
  category: string;
  categoryLabel: string;
  sourceKind: "formal" | "saved" | "reading" | "recent-error";
  saved: boolean;
  savedExpressionId?: string;
  saveSource?: ExploreExpressionSaveSource;
  generationSource?: ExploreExpressionGenerationSource;
}>;

/**
 * Whether the owned part of the library (personal scenarios, saved
 * expressions, reading highlights, recent errors) is present in this DTO.
 *
 * `"loading"` is not a synonym for `"unavailable"`: the public catalogue paints
 * before the per-user reads are issued, so a library that has not been
 * decorated yet must say so instead of reporting a failure. The saved and
 * personal filters are dishonest under `"unavailable"` copy while the read is
 * still in flight.
 */
export const explorePrivateStates = ["loading", "available", "unavailable"] as const;
export type ExplorePrivateState = (typeof explorePrivateStates)[number];

export type ExploreLibraryDto = Readonly<{
  scenarios: readonly ExploreScenarioLibraryCard[];
  expressions: readonly ExploreExpressionLibraryCard[];
  privateState: ExplorePrivateState;
}>;

export function normalizeExploreSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function matchesQuery(values: readonly (string | null | undefined)[], query: string): boolean {
  const tokens = normalizeExploreSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeExploreSearchText(values.filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

export function filterExploreLibrary(
  library: ExploreLibraryDto,
  input: Readonly<{ query: string; filter: ExploreLibraryFilter }>,
): ExploreLibraryDto {
  const scenarios = input.filter === "all" || input.filter === "available"
    ? library.scenarios.filter((scenario) => matchesQuery([
      scenario.title,
      scenario.description,
      scenario.cefr,
      scenario.region,
      scenario.category,
      scenario.categoryLabel,
      scenario.role,
      scenario.communicationGoal,
      ...scenario.expressionTexts,
    ], input.query))
    : [];
  const expressions = input.filter === "available"
    ? []
    : library.expressions.filter((expression) => {
      const sourceMatches = input.filter === "all"
        || (input.filter === "formal" && expression.sourceKind === "formal")
        || (input.filter === "saved" && expression.saved)
        || (input.filter === "recent-error" && expression.sourceKind === "recent-error")
        || (input.filter === "reading" && expression.sourceKind === "reading");
      return sourceMatches && matchesQuery([
        expression.text,
        expression.translation,
        expression.intent,
        expression.cefr,
        expression.region,
        expression.category,
        expression.categoryLabel,
      ], input.query);
    });
  return { scenarios, expressions, privateState: library.privateState };
}
