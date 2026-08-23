import {
  explanationFor,
  selectInputMode,
  type NextAction,
  type RecommendationContext,
} from "../domain/next-action";
import { rankRecommendationCandidates } from "../domain/rank-candidates";

export function getNextAction(context: RecommendationContext): NextAction {
  if (context.profileStatus === "insufficient") {
    return fallbackAction(context);
  }

  const ranked = rankRecommendationCandidates(context);
  const best = ranked[0];
  if (!best) return fallbackAction(context);

  return {
    candidateId: best.candidate.id,
    contentKey: best.candidate.contentKey,
    title: best.candidate.title,
    inputMode: best.inputMode,
    reason: best.reason,
    explanation: explanationFor(best.reason, best.candidate.title),
    score: best.score,
    isFallback: false,
  };
}

function fallbackAction(context: RecommendationContext): NextAction {
  const inputMode = selectInputMode(
    context.fallback.supportedInputModes,
    context.availableInputModes,
  ) ?? "typing";

  return {
    candidateId: context.fallback.id,
    contentKey: context.fallback.contentKey,
    title: context.fallback.title,
    inputMode,
    reason: "fallback",
    explanation: explanationFor("fallback", context.fallback.title),
    score: 0,
    isFallback: true,
  };
}
