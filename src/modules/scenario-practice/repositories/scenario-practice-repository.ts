import type {
  ScenarioRepetitionItem,
  ScenarioTurn,
  TemporaryCharacterSnapshot,
} from "../domain";

export type PersistedScenarioSession = Readonly<{
  sessionId: string;
  userId: string;
  clientAttemptId: string;
  personalScenarioId: string | null;
  scenarioId: string | null;
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

export interface ScenarioPracticeRepository {
  createSession(input: CreateScenarioSessionInput): Promise<PersistedScenarioSession>;
  getSession(userId: string, sessionId: string): Promise<PersistedScenarioSession | null>;
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
  createRepetitionItems(items: readonly ScenarioRepetitionItem[]): Promise<number>;
  completeSession(input: Readonly<{
    userId: string;
    sessionId: string;
    expectedRevision: number;
    idempotencyKey: string;
    completedAt: Date;
    repetitionItems: readonly ScenarioRepetitionItem[];
  }>): Promise<PersistedScenarioSession>;
}
