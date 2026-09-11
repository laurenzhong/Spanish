import type { ScenarioPracticeDetail } from "../content";

export const savedExpressionSourceTypes = ["formal-expression", "reading-selection", "scenario-review", "manual"] as const;
export type SavedExpressionSourceType = (typeof savedExpressionSourceTypes)[number];
export const generationSourceTypes = ["topic", "reading", "saved-expression", "recent-error"] as const;
export type GenerationSourceType = (typeof generationSourceTypes)[number];

export type SavedExpressionDto = Readonly<{
  id: string;
  sourceText: string;
  translation: string | null;
  sourceType: SavedExpressionSourceType;
  sourceEntityId: string | null;
  sourceVersion: string | null;
  createdAt: string;
}>;

export type SavedExpressionSourceInput =
  | Readonly<{ sourceType: "formal-expression"; expressionKey: string; version: number }>
  | Readonly<{ sourceType: "reading-selection"; highlightId: string }>
  | Readonly<{ sourceType: "scenario-review"; reviewId: string }>
  | Readonly<{ sourceType: "manual"; text: string; translation?: string }>;

export type ResolvedSavedExpression = Readonly<{
  sourceText: string;
  translation: string | null;
  register: string | null;
  usageNotes: string | null;
  sourceType: SavedExpressionSourceType;
  sourceEntityId: string | null;
  sourceVersion: string | null;
  expressionId: string | null;
  contentHash: string | null;
}>;

export type CreateSavedExpressionInput = ResolvedSavedExpression & Readonly<{
  userId: string;
  clientSaveId: string;
}>;

export type GenerationSourceInput =
  | Readonly<{ sourceType: "topic"; topic: string }>
  | Readonly<{ sourceType: "reading" | "saved-expression" | "recent-error"; sourceId: string }>;

export type ResolvedGenerationSource = Readonly<{
  sourceType: GenerationSourceType;
  sourceEntityId: string | null;
  topic: string;
  expressions: readonly Readonly<{ text: string; translation: string | null }>[];
  sourceVersion: string | null;
}>;

export type ScenarioGenerationSourcesDto = Readonly<{
  savedExpressions: readonly Readonly<{ id: string; label: string; detail: string | null }>[];
  readingHighlights: readonly Readonly<{ id: string; label: string; detail: string | null }>[];
  recentErrors: readonly Readonly<{ id: string; label: string; detail: string | null }>[];
}>;

export type PersonalScenarioRecord = Readonly<{
  id: string;
  userId: string;
  idempotencyKey: string;
  inputFingerprint: string;
  detail: ScenarioPracticeDetail;
  sourceType: GenerationSourceType;
  sourceEntityId: string | null;
  providerKey: string;
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  createdAt: string;
}>;

export type CreatePersonalScenarioInput = Omit<PersonalScenarioRecord, "createdAt">;

export type PersonalSuggestionCandidate = Readonly<{
  id: string;
  title: string;
  description: string;
  cefr: "A1" | "A2" | "B1" | "B2";
  region?: string;
  role: string;
  communicationGoal: string;
  goalKeys: readonly string[];
  expressionTexts: readonly string[];
}>;

export interface ScenarioLibraryRepository {
  listSavedExpressions(userId: string): Promise<readonly SavedExpressionDto[]>;
  resolveSavedExpressionSource(userId: string, source: SavedExpressionSourceInput): Promise<ResolvedSavedExpression | null>;
  findSavedExpressionByClientSaveId(userId: string, clientSaveId: string): Promise<SavedExpressionDto | null>;
  createSavedExpression(input: CreateSavedExpressionInput): Promise<SavedExpressionDto>;
  archiveSavedExpression(userId: string, savedExpressionId: string): Promise<boolean>;
  listGenerationSources(userId: string): Promise<ScenarioGenerationSourcesDto>;
  resolveGenerationSource(userId: string, source: GenerationSourceInput): Promise<ResolvedGenerationSource | null>;
  findPersonalScenarioByIdempotencyKey(userId: string, idempotencyKey: string): Promise<PersonalScenarioRecord | null>;
  createPersonalScenario(input: CreatePersonalScenarioInput): Promise<PersonalScenarioRecord>;
  getPersonalScenario(userId: string, personalScenarioId: string): Promise<PersonalScenarioRecord | null>;
  archivePersonalScenario(userId: string, personalScenarioId: string): Promise<boolean>;
  listPersonalSuggestionCandidates(userId: string): Promise<readonly PersonalSuggestionCandidate[]>;
}
