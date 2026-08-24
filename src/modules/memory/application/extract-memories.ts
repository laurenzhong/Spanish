import {
  createCandidateId,
  normalizeMemoryText,
  type CompletedConversationTurn,
  type MemoryCandidate,
  type MemoryCategory,
} from "../domain/memory-candidate";

type ExtractionInput = Readonly<{
  userId: string;
  characterKey: string;
  characterVersion?: number;
  conversationId: string;
  turn: CompletedConversationTurn;
}>;

type Pattern = Readonly<{
  category: MemoryCategory;
  factKey: string;
  expression: RegExp;
  confidence: number;
  sensitivity?: "normal" | "sensitive" | "private";
}>;

const patterns: readonly Pattern[] = [
  { category: "interest", factKey: "interest.preference", expression: /\bme gusta(?:n)?\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.9 },
  { category: "interest", factKey: "interest.preference", expression: /\bme encanta(?:n)?\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.92 },
  { category: "interest", factKey: "interest.preference", expression: /\bme interesa(?:n)?\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.86 },
  { category: "location", factKey: "location.current", expression: /\bvivo en\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.95, sensitivity: "sensitive" },
  { category: "location", factKey: "location.origin", expression: /\bsoy de\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.93, sensitivity: "sensitive" },
  { category: "background", factKey: "background.origin", expression: /\bnac[ií] en\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.94, sensitivity: "sensitive" },
  { category: "background", factKey: "background.study", expression: /\bestudio\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.85 },
  { category: "background", factKey: "background.work", expression: /\btrabajo(?: en)?\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.85 },
  { category: "habit", factKey: "habit.routine", expression: /\bsuelo\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.82 },
  { category: "habit", factKey: "habit.routine", expression: /\bnormalmente\s+(.+?)(?=[.!?]|$)/iu, confidence: 0.78 },
];

function cleanValue(value: string): string {
  return value
    .split(/\s+(?=(?:y|pero)\s+(?:me|vivo|soy|nac[ií]|estudio|trabajo|suelo|normalmente)\b)/iu, 1)[0]
    .replace(/^(?:mucho|bastante|un poco)\s+/iu, "")
    .replace(/[.!?\s]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function isUsefulValue(value: string): boolean {
  return value.length >= 2 && value.length <= 120 && value.split(/\s+/u).length <= 16;
}

/** Extracts only explicit first-person facts from a completed user turn. */
export function extractMemories(input: ExtractionInput): readonly MemoryCandidate[] {
  const { turn } = input;
  if (
    turn.status !== "done" ||
    turn.userMessage.role !== "user" ||
    turn.userMessage.status !== "completed" ||
    turn.assistantMessage.role !== "character" ||
    turn.assistantMessage.status !== "completed"
  ) return [];

  const source = turn.userMessage.content.trim();
  if (!source) return [];
  const characterVersion = input.characterVersion ?? 1;
  const candidates: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const match = pattern.expression.exec(source);
    const value = match?.[1] ? cleanValue(match[1]) : "";
    if (!value || !isUsefulValue(value)) continue;
    const dedupeKey = `${pattern.factKey}|${normalizeMemoryText(value)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const content = value;
    candidates.push({
      candidateId: createCandidateId({
        userId: input.userId,
        characterKey: input.characterKey,
        conversationId: input.conversationId,
        sourceMessageId: turn.userMessage.id,
        factKey: pattern.factKey,
        content,
      }),
      userId: input.userId,
      characterKey: input.characterKey,
      characterVersion,
      conversationId: input.conversationId,
      sourceMessageId: turn.userMessage.id,
      factKey: pattern.factKey,
      category: pattern.category,
      content,
      confidence: pattern.confidence,
      sensitivity: pattern.sensitivity ?? "normal",
      shareScope: "private",
    });
  }
  return candidates;
}
