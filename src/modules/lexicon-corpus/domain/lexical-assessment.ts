import { normalizeSpanishSurface } from "./spanish-token";

export type LexicalAssessmentPromptType = "choice" | "judgement" | "cloze" | "recall";

export type LexicalAssessmentItem = Readonly<{
  id: string;
  version: number;
  promptType: LexicalAssessmentPromptType;
  prompt: string;
  options: readonly string[];
  acceptedAnswers: readonly string[];
  skillKey: string;
  contentVersion: number;
}>;

export type LexicalAnswerResult = Readonly<{
  passed: boolean;
  score: 0 | 1;
  normalizedAnswer: string;
}>;

export function normalizeAssessmentAnswer(answer: string): string {
  return answer.trim().split(/\s+/u).map(normalizeSpanishSurface).join(" ");
}

export function evaluateLexicalAnswer(item: LexicalAssessmentItem, answer: string): LexicalAnswerResult {
  if (!item.skillKey.startsWith("lexical.")) throw new Error("LEXICAL_SKILL_INVALID");
  const normalizedAnswer = normalizeAssessmentAnswer(answer);
  const accepted = item.acceptedAnswers.map(normalizeAssessmentAnswer);
  const passed = normalizedAnswer.length > 0 && accepted.includes(normalizedAnswer);
  return { passed, score: passed ? 1 : 0, normalizedAnswer };
}

export function buildLexicalEvidenceDraft(input: Readonly<{
  userId: string;
  assessmentAttemptId: string;
  idempotencyKey: string;
  assessmentItemId: string;
  contentVersion: number;
  skillKey: string;
  score: 0 | 1;
  confidence: number;
  occurredAt: Date;
}>) {
  if (!input.skillKey.startsWith("lexical.")) throw new Error("LEXICAL_SKILL_INVALID");
  return {
    algorithmVersion: "lexical-assessment-v1",
    confidence: Math.min(1, Math.max(0, input.confidence)),
    contentVersion: input.contentVersion,
    evidenceWeight: input.score === 1 ? 0.54 : 0.27,
    idempotencyKey: input.idempotencyKey,
    modality: "typing" as const,
    occurredAt: input.occurredAt,
    outcomeScore: input.score,
    practiceAttemptId: null,
    skillKey: input.skillKey,
    sourceReference: { assessmentAttemptId: input.assessmentAttemptId, assessmentItemId: input.assessmentItemId },
    sourceType: "lexical_assessment" as const,
    userId: input.userId,
  };
}
