import {
  type RecommendationCandidate,
  type RecommendationContext,
  type RecommendationInputMode,
  type RecommendationReason,
  type RecommendationSkillSignal,
} from "./next-action";

export type RankedRecommendation = Readonly<{
  candidate: RecommendationCandidate;
  inputMode: RecommendationInputMode;
  score: number;
  reason: RecommendationReason;
}>;

type ScoreBreakdown = Readonly<{
  score: number;
  reason: RecommendationReason;
}>;

const weights = {
  coreGoal: 45,
  oralCoverage: 25,
  confidence: 20,
  historicalWeakness: 18,
  conversationNeed: 15,
  freshness: 10,
  repeatPenalty: 12,
} as const;

export function rankRecommendationCandidates(
  context: RecommendationContext,
): readonly RankedRecommendation[] {
  const ranked = context.candidates
    .map((candidate) => {
      const inputMode = selectCandidateInputMode(candidate, context);
      if (!inputMode) return null;
      const breakdown = scoreCandidate(candidate, context, inputMode);
      return {
        candidate,
        inputMode,
        score: breakdown.score,
        reason: breakdown.reason,
      } satisfies RankedRecommendation;
    })
    .filter((item): item is RankedRecommendation => item !== null);

  return ranked.sort((left, right) =>
    right.score - left.score || left.candidate.id.localeCompare(right.candidate.id),
  );
}

export function scoreCandidate(
  candidate: RecommendationCandidate,
  context: RecommendationContext,
  inputMode: RecommendationInputMode,
): ScoreBreakdown {
  const skills = candidate.skillKeys;
  const signals = context.skillSignals.filter((signal) => skills.includes(signal.skillKey));
  const coreGoalMatch = overlapCount(skills, context.coreGoalSkillKeys);
  const historicalWeaknessMatch = overlapCount(skills, context.historicalWeakSkillKeys);
  const conversationNeedMatch = overlapCount(skills, context.recentConversationSkillKeys);
  const coreGoalScore = coreGoalMatch > 0 ? weights.coreGoal * averageGap(signals, "mastery") : 0;
  const oralCoverageScore = inputMode === "speech" && skills.length > 0
    ? weights.oralCoverage * averageGap(signals, "oralCoverage")
    : 0;
  const confidenceScore = weights.confidence * averageGap(signals, "confidence");
  const historicalWeaknessScore = historicalWeaknessMatch > 0 ? weights.historicalWeakness : 0;
  const conversationNeedScore = conversationNeedMatch > 0 ? weights.conversationNeed : 0;
  const freshnessScore = weights.freshness * freshness(candidate.lastPracticedAt, context.now);
  const repeatPenalty = weights.repeatPenalty * Math.min(candidate.recentAttemptCount, 3);
  const score = round(
    coreGoalScore +
      oralCoverageScore +
      confidenceScore +
      historicalWeaknessScore +
      conversationNeedScore +
      freshnessScore -
      repeatPenalty,
  );

  return {
    score,
    reason: reasonFor({
      coreGoalMatch,
      coreGoalScore,
      oralCoverageScore,
      confidenceScore,
      historicalWeaknessMatch,
      conversationNeedMatch,
      freshnessScore,
    }),
  };
}

function selectCandidateInputMode(
  candidate: RecommendationCandidate,
  context: RecommendationContext,
): RecommendationInputMode | null {
  if (context.availableInputModes.includes("speech") && candidate.supportedInputModes.includes("speech")) {
    return "speech";
  }
  if (context.availableInputModes.includes("typing") && candidate.supportedInputModes.includes("typing")) {
    return "typing";
  }
  return null;
}

function averageGap(
  signals: readonly RecommendationSkillSignal[],
  key: "mastery" | "confidence" | "oralCoverage",
): number {
  if (signals.length === 0) return 1;
  return signals.reduce((sum, signal) => sum + (signal[key] === null ? 1 : 1 - clamp(signal[key])), 0) / signals.length;
}

function overlapCount(left: readonly string[], right: readonly string[]): number {
  return left.filter((item) => right.includes(item)).length;
}

function freshness(lastPracticedAt: string | null, now: string): number {
  if (!lastPracticedAt) return 1;
  const ageMs = Date.parse(now) - Date.parse(lastPracticedAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  return clamp(ageMs / (1000 * 60 * 60 * 24 * 14));
}

function reasonFor(input: {
  coreGoalMatch: number;
  coreGoalScore: number;
  oralCoverageScore: number;
  confidenceScore: number;
  historicalWeaknessMatch: number;
  conversationNeedMatch: number;
  freshnessScore: number;
}): RecommendationReason {
  const priorities: readonly [RecommendationReason, number][] = [
    ["core-goal-gap", input.coreGoalScore],
    ["oral-coverage-gap", input.oralCoverageScore],
    ["confidence-gap", input.confidenceScore],
    ["historical-weakness", input.historicalWeaknessMatch],
    ["conversation-need", input.conversationNeedMatch],
    ["fresh-content", input.freshnessScore],
  ];
  const match = priorities.find(([, score]) => score > 0);
  return match?.[0] ?? "fresh-content";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
