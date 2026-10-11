import {
  suggestScenario,
  type ScenarioSuggestionCandidate,
  type ScenarioSuggestionContext,
  type ScenarioSuggestionMode,
  type ScenarioSuggestionCefr,
  type ScenarioSuggestionModality,
} from "../domain/scenario-suggestion";

export interface ScenarioSuggestionCandidateRepository {
  listForUser(userId: string): Promise<readonly ScenarioSuggestionCandidate[]>;
}

export interface ScenarioSuggestionContextRepository {
  getForUser(userId: string): Promise<ScenarioSuggestionContext>;
}

export type SuggestScenarioForUserInput = Readonly<{
  userId: string;
  mode: ScenarioSuggestionMode;
  excludedScenarioIds: readonly string[];
  category?: string;
  cefr?: ScenarioSuggestionCefr;
  modality?: ScenarioSuggestionModality;
}>;

export async function suggestScenarioForUser(
  candidateRepository: ScenarioSuggestionCandidateRepository,
  contextRepository: ScenarioSuggestionContextRepository,
  input: SuggestScenarioForUserInput,
  random: () => number = Math.random,
) {
  // Candidates and context are both keyed only by the user, so they share one
  // round trip; the context keeps its own fallback (an unavailable context is
  // an empty one, an unavailable candidate list still fails the suggestion).
  const [candidates, context] = await Promise.all([
    candidateRepository.listForUser(input.userId),
    contextRepository.getForUser(input.userId).catch((): ScenarioSuggestionContext => emptyScenarioSuggestionContext),
  ]);
  return suggestScenario({
    mode: input.mode,
    candidates,
    context,
    excludedScenarioIds: input.excludedScenarioIds,
    ...(input.category ? { category: input.category } : {}),
    ...(input.cefr ? { cefr: input.cefr } : {}),
    ...(input.modality ? { modality: input.modality } : {}),
    random,
  });
}

export const emptyScenarioSuggestionContext: ScenarioSuggestionContext = {
  cefr: null,
  savedExpressionTexts: [],
  reliableGapGoalKeys: [],
  practicedScenarioKeys: [],
  practicedCategories: [],
  practicedGoalKeys: [],
  recentScenarioKeys: [],
  activeScenarioKeys: [],
};
