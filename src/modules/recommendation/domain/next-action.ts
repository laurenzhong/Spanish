export const recommendationInputModes = ["speech", "typing"] as const;
export type RecommendationInputMode = (typeof recommendationInputModes)[number];

export const recommendationReasons = [
  "core-goal-gap",
  "oral-coverage-gap",
  "confidence-gap",
  "historical-weakness",
  "conversation-need",
  "fresh-content",
  "fallback",
] as const;
export type RecommendationReason = (typeof recommendationReasons)[number];

export type RecommendationSkillSignal = Readonly<{
  skillKey: string;
  mastery: number | null;
  confidence: number | null;
  oralCoverage: number | null;
}>;

export type RecommendationCandidate = Readonly<{
  id: string;
  contentKey: string;
  title: string;
  skillKeys: readonly string[];
  supportedInputModes: readonly RecommendationInputMode[];
  lastPracticedAt: string | null;
  recentAttemptCount: number;
}>;

export type RecommendationFallback = Readonly<{
  id: string;
  contentKey: string;
  title: string;
  supportedInputModes: readonly RecommendationInputMode[];
}>;

export type RecommendationContext = Readonly<{
  profileStatus: "available" | "insufficient";
  coreGoalSkillKeys: readonly string[];
  historicalWeakSkillKeys: readonly string[];
  recentConversationSkillKeys: readonly string[];
  skillSignals: readonly RecommendationSkillSignal[];
  availableInputModes: readonly RecommendationInputMode[];
  candidates: readonly RecommendationCandidate[];
  fallback: RecommendationFallback;
  now: string;
}>;

export type NextAction = Readonly<{
  candidateId: string;
  contentKey: string;
  title: string;
  inputMode: RecommendationInputMode;
  reason: RecommendationReason;
  explanation: string;
  score: number;
  isFallback: boolean;
}>;

export function selectInputMode(
  supportedInputModes: readonly RecommendationInputMode[],
  availableInputModes: readonly RecommendationInputMode[],
): RecommendationInputMode | null {
  if (availableInputModes.includes("speech") && supportedInputModes.includes("speech")) {
    return "speech";
  }
  if (availableInputModes.includes("typing") && supportedInputModes.includes("typing")) {
    return "typing";
  }
  return null;
}

export function explanationFor(
  reason: RecommendationReason,
  title: string,
): string {
  switch (reason) {
    case "core-goal-gap":
      return `“${title}”直接对应当前最重要的沟通目标。`;
    case "oral-coverage-gap":
      return `“${title}”可以补充当前目标缺少的口语验证。`;
    case "confidence-gap":
      return `“${title}”可以先验证目前证据不足的能力。`;
    case "historical-weakness":
      return `“${title}”针对你过去较薄弱的能力。`;
    case "conversation-need":
      return `“${title}”回应了最近对话中自然出现的表达需要。`;
    case "fresh-content":
      return `“${title}”提供一个新鲜的练习情境，帮助你继续迁移。`;
    case "fallback":
      return `画像还在建立，先完成“${title}”来获得下一条可靠证据。`;
  }
}
