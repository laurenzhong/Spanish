export const memoryCategories = [
  "interest",
  "location",
  "background",
  "habit",
] as const;

export type MemoryCategory = (typeof memoryCategories)[number];
export type MemorySensitivity = "normal" | "sensitive" | "private";
export type MemoryShareScope = "private" | "character" | "explicit";

export type MemoryCandidate = Readonly<{
  candidateId: string;
  userId: string;
  characterKey: string;
  characterVersion: number;
  conversationId: string;
  sourceMessageId: string | null;
  factKey: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
  sensitivity: MemorySensitivity;
  shareScope: MemoryShareScope;
}>;

export type CompletedConversationTurn = Readonly<{
  status: "done" | "cancelled" | "failed" | "streaming";
  userMessage: Readonly<{
    id: string;
    role: "user";
    status: "completed";
    content: string;
  }>;
  assistantMessage: Readonly<{
    id: string;
    role: "character";
    status: "completed";
    content: string;
  }>;
}>;

// A small dependency-free stable hash keeps candidate IDs deterministic in every runtime.
export function stableMemoryHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeMemoryText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[¿¡.,!?;:()[\]{}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function createCandidateId(input: Readonly<{
  userId: string;
  characterKey: string;
  conversationId: string;
  sourceMessageId: string | null;
  factKey: string;
  content: string;
}>): string {
  return `memory-candidate-${stableMemoryHash([
    input.userId,
    input.characterKey,
    input.conversationId,
    input.sourceMessageId ?? "",
    input.factKey,
    normalizeMemoryText(input.content),
  ].join("|"))}`;
}
