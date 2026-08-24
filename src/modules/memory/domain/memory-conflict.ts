import { normalizeMemoryText, type MemoryCandidate } from "./memory-candidate";

export type ExistingMemory = Readonly<{
  id: string;
  factKey: string;
  content: string;
  status: "candidate" | "confirmed" | "rejected" | "conflict";
}>;

export type MemoryConflict =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "duplicate"; existing: ExistingMemory }>
  | Readonly<{ kind: "conflict"; existing: ExistingMemory }>;

export function classifyMemoryCandidate(
  candidate: MemoryCandidate,
  existing: readonly ExistingMemory[],
): MemoryConflict {
  const sameKey = existing.filter((memory) => memory.factKey === candidate.factKey);
  const sameContent = sameKey.find(
    (memory) => normalizeMemoryText(memory.content) === normalizeMemoryText(candidate.content),
  );
  if (sameContent) return { kind: "duplicate", existing: sameContent };
  const conflict = sameKey.find((memory) => memory.status !== "rejected");
  return conflict ? { kind: "conflict", existing: conflict } : { kind: "new" };
}
