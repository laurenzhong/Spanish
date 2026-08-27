import type {
  MemoryCandidate,
  MemoryCategory,
  MemorySensitivity,
  MemoryShareScope,
} from "../domain/memory-candidate";

export type MemoryStatus = "candidate" | "confirmed" | "rejected" | "conflict";

export type MemoryRecord = Readonly<{
  id: string;
  userId: string;
  characterKey: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  factKey: string;
  category: MemoryCategory;
  content: string;
  confidence: number;
  sensitivity: MemorySensitivity;
  shareScope: MemoryShareScope;
  status: MemoryStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

export type MemoryRepository = Readonly<{
  transaction<T>(work: (repository: MemoryRepository) => Promise<T>): Promise<T>;
  findByFactKey(userId: string, characterKey: string, factKey: string): Promise<readonly MemoryRecord[]>;
  insertCandidate(candidate: MemoryCandidate, status?: MemoryStatus): Promise<MemoryRecord>;
  listAllMemories(userId: string): Promise<readonly MemoryRecord[]>;
  listMemories(userId: string, characterKey: string): Promise<readonly MemoryRecord[]>;
  listReadableMemories(userId: string, characterKey: string): Promise<readonly MemoryRecord[]>;
  deleteMemory(userId: string, memoryId: string): Promise<boolean>;
  deleteBySourceMessage?(userId: string, sourceMessageId: string): Promise<number>;
  grantPermission(userId: string, memoryId: string, targetCharacterKey: string): Promise<void>;
  revokePermission(userId: string, memoryId: string, targetCharacterKey: string): Promise<void>;
}>;
