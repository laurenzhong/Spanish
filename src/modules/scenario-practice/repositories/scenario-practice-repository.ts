import type {
  ScenarioRepetitionItem,
  ScenarioTurn,
  ScenarioTurnReview,
  TemporaryCharacterSnapshot,
} from "../domain";

export type PersistedScenarioSession = Readonly<{
  sessionId: string;
  userId: string;
  clientAttemptId: string;
  personalScenarioId: string | null;
  scenarioId: string | null;
  scenarioKey: string | null;
  scenarioTitle: string | null;
  primaryModality: "speech" | "typing";
  contentVersion: number;
  status: string;
  revision: number;
  currentTurn: number;
  hintLevel: 0 | 1 | 2 | 3;
  generationId: string | null;
  communicationGoal: string;
  temporaryCharacter: TemporaryCharacterSnapshot;
  reviewStatus: "not-requested" | "pending" | "ready" | "unavailable";
  completionIdempotencyKey: string | null;
  completedAt: Date | null;
}>;

export type ScenarioHistoryItem = Readonly<{
  sessionId: string;
  scenarioKey: string | null;
  title: string;
  communicationGoal: string;
  temporaryCharacterName: string;
  primaryModality: "speech" | "typing";
  reviewStatus: PersistedScenarioSession["reviewStatus"];
  completedAt: Date;
  userTurnCount: number;
}>;

export type CreateScenarioSessionInput = Readonly<{
  sessionId: string;
  userId: string;
  clientAttemptId: string;
  scenarioId?: string;
  personalScenarioId?: string;
  primaryModality: "speech" | "typing";
  contentVersion: number;
  communicationGoal: string;
  temporaryCharacter: TemporaryCharacterSnapshot;
}>;

export type AppendScenarioTurnInput = Readonly<{
  id: string;
  userId: string;
  sessionId: string;
  clientAttemptId: string;
  turnIndex: number;
  speaker: "user" | "temporary-character" | "condition";
  modality: "speech" | "typing" | "system";
  text: string;
  attemptId?: string | null;
  generationId?: string | null;
  replyToTurnId?: string | null;
  providerKey?: string | null;
  modelVersion?: string | null;
  providerRequestId?: string | null;
}>;

export type SaveScenarioTurnReviewInput = Readonly<{
  id: string;
  userId: string;
  turnId: string;
  communicationSuccess: boolean | null;
  errorSpans: readonly Readonly<Record<string, unknown>>[];
  naturalAlternatives: readonly string[];
  hintLevel: 0 | 1 | 2 | 3;
  transcriptConfidence: number | null;
  algorithmVersion: string;
  providerKey: string | null;
  modelVersion: string | null;
  providerRequestId: string | null;
  status: "ready" | "unavailable";
}>;

export interface ScenarioPracticeRepository {
  createSession(input: CreateScenarioSessionInput): Promise<PersistedScenarioSession>;
  getSession(userId: string, sessionId: string): Promise<PersistedScenarioSession | null>;
  getTurn(userId: string, sessionId: string, turnId: string): Promise<ScenarioTurn | null>;
  listTurns(userId: string, sessionId: string): Promise<readonly ScenarioTurn[]>;
  listTurnReviews(userId: string, sessionId: string): Promise<readonly ScenarioTurnReview[]>;
  listHistory(userId: string, limit: number, before?: Date): Promise<readonly ScenarioHistoryItem[]>;
  listRepetitionItems(userId: string, sourceSessionId: string): Promise<readonly ScenarioRepetitionItem[]>;
  listDueRepetitionItems(userId: string, dueAt: Date, limit: number): Promise<readonly ScenarioRepetitionItem[]>;
  getRepetitionItem(userId: string, repetitionId: string): Promise<ScenarioRepetitionItem | null>;
  compareAndSwapState(input: Readonly<{
    userId: string;
    sessionId: string;
    expectedRevision: number;
    status: string;
    generationId?: string | null;
    hintLevel?: 0 | 1 | 2 | 3;
    currentTurn?: number;
    reviewStatus?: "not-requested" | "pending" | "ready" | "unavailable";
    completedAt?: Date | null;
  }>): Promise<PersistedScenarioSession>;
  appendCompletedUserTurn(input: AppendScenarioTurnInput & Readonly<{
    speaker: "user";
    modality: "speech" | "typing";
  }>): Promise<ScenarioTurn>;
  appendCompletedRoleplayTurn(input: AppendScenarioTurnInput & Readonly<{
    speaker: "temporary-character";
    modality: "system";
    done: boolean;
  }>): Promise<ScenarioTurn>;
  appendCompletedConditionTurn(input: AppendScenarioTurnInput & Readonly<{
    speaker: "condition";
    modality: "system";
  }>): Promise<ScenarioTurn>;
  saveTurnReview(input: SaveScenarioTurnReviewInput): Promise<ScenarioTurnReview>;
  createRepetitionItems(items: readonly ScenarioRepetitionItem[]): Promise<number>;
  completeRepetitionItem(userId: string, repetitionId: string, input: Readonly<{
    completionKey: string;
    completedAt: Date;
    result: Exclude<ScenarioRepetitionItem["result"], null | "technical-failure">;
  }>): Promise<ScenarioRepetitionItem>;
  completeSession(input: Readonly<{
    userId: string;
    sessionId: string;
    expectedRevision: number;
    idempotencyKey: string;
    completedAt: Date;
    repetitionItems: readonly ScenarioRepetitionItem[];
  }>): Promise<PersistedScenarioSession>;
}
