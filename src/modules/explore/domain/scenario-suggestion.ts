export const scenarioSuggestionModes = ["best_fit", "discover", "random"] as const;
export type ScenarioSuggestionMode = (typeof scenarioSuggestionModes)[number];

export const scenarioSuggestionReasonCodes = [
  "saved-expression",
  "reliable-gap",
  "level-match",
  "new-category",
  "new-goal",
  "fresh-scenario",
  "safe-start",
  "personal-scenario",
] as const;
export type ScenarioSuggestionReasonCode = (typeof scenarioSuggestionReasonCodes)[number];

export type ScenarioSuggestionCefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type ScenarioSuggestionModality = "speech" | "typing";

export type ScenarioSuggestionCandidate = Readonly<{
  stableKey: string;
  title: string;
  description: string;
  cefr: ScenarioSuggestionCefr;
  category: string;
  categoryLabel: string;
  role: string;
  communicationGoal: string;
  goalKeys: readonly string[];
  expressionTexts: readonly string[];
  modalities: readonly ScenarioSuggestionModality[];
  sourceKind: "public" | "personal";
  status: "published" | "personal-ready" | "draft" | "archived" | "unavailable";
  route: string | null;
}>;

export type ScenarioSuggestionContext = Readonly<{
  cefr: ScenarioSuggestionCefr | null;
  savedExpressionTexts: readonly string[];
  reliableGapGoalKeys: readonly string[];
  practicedScenarioKeys: readonly string[];
  practicedCategories: readonly string[];
  practicedGoalKeys: readonly string[];
  recentScenarioKeys: readonly string[];
  activeScenarioKeys: readonly string[];
}>;

export type ScenarioSuggestionReason = Readonly<{
  code: ScenarioSuggestionReasonCode;
  text: string;
}>;

export type ScenarioSuggestionResult = Readonly<{
  scenario: ScenarioSuggestionCandidate | null;
  reasons: readonly ScenarioSuggestionReason[];
  eligibleCount: number;
  canSwap: boolean;
  limitReached: boolean;
}>;

export type SuggestScenarioInput = Readonly<{
  mode: ScenarioSuggestionMode;
  candidates: readonly ScenarioSuggestionCandidate[];
  context: ScenarioSuggestionContext;
  excludedScenarioIds: readonly string[];
  category?: string;
  cefr?: ScenarioSuggestionCefr;
  modality?: ScenarioSuggestionModality;
  random?: () => number;
}>;

const cefrRank: Readonly<Record<ScenarioSuggestionCefr, number>> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
};
const suggestionSessionLimit = 5;

type RankedCandidate = Readonly<{
  candidate: ScenarioSuggestionCandidate;
  score: number;
  savedExpressionMatch: boolean;
  reliableGapMatch: boolean;
  newCategory: boolean;
  newGoal: boolean;
  exactLevel: boolean;
  fresh: boolean;
}>;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left.map(normalized).filter(Boolean));
  return right.some((value) => values.has(normalized(value)));
}

function isDifficultySafe(candidate: ScenarioSuggestionCandidate, requested: ScenarioSuggestionCefr | null): boolean {
  const baseline = requested ?? "A2";
  return Math.abs(cefrRank[candidate.cefr] - cefrRank[baseline]) <= 1;
}

function rankCandidate(
  candidate: ScenarioSuggestionCandidate,
  context: ScenarioSuggestionContext,
  mode: ScenarioSuggestionMode,
  requestedCefr: ScenarioSuggestionCefr | null,
): RankedCandidate {
  const savedExpressionMatch = overlaps(candidate.expressionTexts, context.savedExpressionTexts);
  const reliableGapMatch = overlaps(candidate.goalKeys, context.reliableGapGoalKeys);
  const newCategory = !context.practicedCategories.includes(candidate.category);
  const newGoal = candidate.goalKeys.some((goal) => !context.practicedGoalKeys.includes(goal));
  const exactLevel = requestedCefr !== null && candidate.cefr === requestedCefr;
  const fresh = !context.recentScenarioKeys.includes(candidate.stableKey);

  let score = exactLevel ? 30 : 12;
  if (fresh) score += 8;
  if (candidate.sourceKind === "personal") score += 3;
  if (mode === "best_fit") {
    if (savedExpressionMatch) score += 45;
    if (reliableGapMatch) score += 32;
    if (newCategory) score += 5;
  } else {
    if (newCategory) score += 50;
    if (newGoal) score += 28;
    if (!context.practicedScenarioKeys.includes(candidate.stableKey)) score += 16;
  }
  if (context.recentScenarioKeys.includes(candidate.stableKey)) score -= 18;

  return { candidate, score, savedExpressionMatch, reliableGapMatch, newCategory, newGoal, exactLevel, fresh };
}

function reasonsFor(ranked: RankedCandidate, mode: ScenarioSuggestionMode, hasProfile: boolean): readonly ScenarioSuggestionReason[] {
  const reasons: ScenarioSuggestionReason[] = [];
  if (mode === "best_fit") {
    if (ranked.savedExpressionMatch) reasons.push({ code: "saved-expression", text: "可以复用你收藏过的表达。" });
    if (ranked.reliableGapMatch) reasons.push({ code: "reliable-gap", text: "可以练习近期确认过的沟通难点。" });
    if (ranked.exactLevel) reasons.push({ code: "level-match", text: `适合你当前的 ${ranked.candidate.cefr} 难度。` });
  } else if (mode === "discover") {
    if (ranked.newCategory) reasons.push({ code: "new-category", text: `你还没有练过${ranked.candidate.categoryLabel}类场景。` });
    if (ranked.newGoal) reasons.push({ code: "new-goal", text: "包含一个还没覆盖的沟通目标。" });
  }
  if (mode === "random" && ranked.fresh) reasons.push({ code: "fresh-scenario", text: "这是近期没有出现过的场景。" });
  if (ranked.candidate.sourceKind === "personal") reasons.push({ code: "personal-scenario", text: "这是你自己的私人场景。" });
  if (reasons.length === 0) {
    reasons.push(hasProfile
      ? { code: "level-match", text: `难度与你当前的 ${ranked.candidate.cefr} 水平接近。` }
      : { code: "safe-start", text: "适合作为一轮轻量基础练习。" });
  }
  return reasons.slice(0, 2);
}

function selectWeighted(ranked: readonly RankedCandidate[], random: () => number): RankedCandidate {
  const pool = ranked.slice(0, 8);
  const minimum = Math.min(...pool.map((item) => item.score));
  const weights = pool.map((item) => Math.max(1, item.score - minimum + 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const raw = random();
  const target = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), 0.999999999) * total;
  let cursor = 0;
  for (let index = 0; index < pool.length; index += 1) {
    cursor += weights[index] ?? 0;
    if (target < cursor) return pool[index]!;
  }
  return pool[pool.length - 1]!;
}

export function suggestScenario(input: SuggestScenarioInput): ScenarioSuggestionResult {
  if (input.excludedScenarioIds.length >= suggestionSessionLimit) {
    return { scenario: null, reasons: [], eligibleCount: 0, canSwap: false, limitReached: true };
  }

  const excluded = new Set(input.excludedScenarioIds);
  const active = new Set(input.context.activeScenarioKeys);
  const requestedCefr = input.cefr ?? input.context.cefr;
  const eligible = input.candidates.filter((candidate) => (
    (candidate.status === "published" || candidate.status === "personal-ready") &&
    candidate.route !== null &&
    !excluded.has(candidate.stableKey) &&
    !active.has(candidate.stableKey) &&
    (!input.category || candidate.category === input.category) &&
    (!input.modality || candidate.modalities.includes(input.modality)) &&
    isDifficultySafe(candidate, requestedCefr)
  ));

  if (eligible.length === 0) {
    return { scenario: null, reasons: [], eligibleCount: 0, canSwap: false, limitReached: false };
  }

  const ranked = eligible
    .map((candidate) => rankCandidate(candidate, input.context, input.mode, requestedCefr))
    .sort((left, right) => right.score - left.score || left.candidate.stableKey.localeCompare(right.candidate.stableKey));
  const selected = input.mode === "random" ? selectWeighted(ranked, input.random ?? Math.random) : ranked[0]!;

  return {
    scenario: selected.candidate,
    reasons: reasonsFor(selected, input.mode, input.context.cefr !== null),
    eligibleCount: eligible.length,
    canSwap: eligible.length > 1 && input.excludedScenarioIds.length + 1 < suggestionSessionLimit,
    limitReached: false,
  };
}
