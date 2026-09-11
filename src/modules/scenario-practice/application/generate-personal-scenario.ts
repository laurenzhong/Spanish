import { createHash, randomUUID } from "node:crypto";

import { ScenarioProviderError, type ScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation";
import type { ScenarioPracticeDetail } from "../content";
import type { GenerationSourceInput, PersonalScenarioRecord, ScenarioLibraryRepository } from "../repositories/scenario-library-repository";

export class PersonalScenarioSourceError extends Error {
  constructor() { super("The generation source is unavailable or not owned by the current user."); this.name = "PersonalScenarioSourceError"; }
}

export class PersonalScenarioConflictError extends Error {
  constructor() { super("The idempotency key was already used with different input."); this.name = "PersonalScenarioConflictError"; }
}

export type GeneratePersonalScenarioInput = Readonly<{
  userId: string;
  idempotencyKey: string;
  requestId: string;
  generationId: string;
  cefr: "A1" | "A2" | "B1" | "B2";
  locale: "es-ES" | "es-MX";
  source: GenerationSourceInput;
}>;

function fingerprint(input: GeneratePersonalScenarioInput): string {
  const normalizedSource = input.source.sourceType === "topic"
    ? { sourceType: input.source.sourceType, topic: input.source.topic.trim().replace(/\s+/gu, " ").toLocaleLowerCase() }
    : input.source;
  return createHash("sha256").update(JSON.stringify({ cefr: input.cefr, locale: input.locale, source: normalizedSource })).digest("hex");
}

function buildDetail(id: string, cefr: GeneratePersonalScenarioInput["cefr"], sourceTopic: string, result: Awaited<ReturnType<ScenarioGenerationProvider["generate"]>>): ScenarioPracticeDetail {
  const expressions = result.expressions.map((expression, index) => ({
    stableKey: `personal.expression.${index + 1}`,
    text: expression.text,
    translation: expression.translation,
    communicativeIntent: expression.communicativeIntent,
    variants: expression.variants,
  }));
  return {
    stableKey: `personal.${id}`,
    version: 1,
    title: result.title,
    description: `围绕“${sourceTopic}”生成的私人练习。`,
    setting: result.setting,
    relationshipType: "private-practice",
    cefr,
    status: "draft",
    temporaryCharacter: { ...result.temporaryCharacter, tone: "natural" },
    openingLine: result.openingLine,
    openingContext: "临时人物会先自然回应；完成表达后才会出现反馈。",
    recommendedTurnCount: Math.max(2, Math.min(5, result.communicationGoals.length + 1)),
    fictionalContext: true,
    conditions: result.conditionChanges.map((condition, index) => ({ stableKey: `personal.condition.${index + 1}`, afterUserTurns: index + 1, prompt: condition, characterLine: condition })),
    tasks: result.communicationGoals.map((goal, index) => ({
      position: index,
      goalKey: `personal.goal.${index + 1}`,
      prompt: goal,
      successCriteria: { contextualSuccess: true },
      targetExpressionKeys: expressions.map((expression) => expression.stableKey),
      hints: {
        level1: "先说明你的需要，再补充必要条件。",
        level2: expressions[0]?.translation ?? "使用一种自然、礼貌的说法。",
        level3: expressions[0]?.text ?? "请用完整句表达你的需要。",
      },
    })),
    expressions,
  };
}

export async function generatePersonalScenario(
  repository: ScenarioLibraryRepository,
  provider: ScenarioGenerationProvider,
  input: GeneratePersonalScenarioInput,
  options: Readonly<{ signal?: AbortSignal; makeId?: () => string }> = {},
): Promise<PersonalScenarioRecord> {
  const inputFingerprint = fingerprint(input);
  const existing = await repository.findPersonalScenarioByIdempotencyKey(input.userId, input.idempotencyKey);
  if (existing) {
    if (existing.inputFingerprint !== inputFingerprint) throw new PersonalScenarioConflictError();
    return existing;
  }
  const source = await repository.resolveGenerationSource(input.userId, input.source);
  if (!source) throw new PersonalScenarioSourceError();
  const result = await provider.generate({
    requestId: input.requestId,
    generationId: input.generationId,
    locale: input.locale,
    cefr: input.cefr,
    topic: source.topic,
    sourceExpressions: source.expressions.map((expression) => expression.text),
  }, { signal: options.signal });
  if (source.expressions.some((sourceExpression) => !result.expressions.some((generated) => generated.text.trim().toLocaleLowerCase() === sourceExpression.text.trim().toLocaleLowerCase()))) {
    throw new ScenarioProviderError("provider-response-invalid", "Scenario generation did not preserve the selected source expressions.", false);
  }
  const id = options.makeId?.() ?? randomUUID();
  const createInput = {
    id,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    inputFingerprint,
    detail: buildDetail(id, input.cefr, source.topic, result),
    sourceType: source.sourceType,
    sourceEntityId: source.sourceEntityId,
    providerKey: result.provider,
    modelVersion: result.modelVersion,
    providerRequestId: result.providerRequestId,
    latencyMs: result.latencyMs,
    estimatedCostMicros: result.estimatedCostMicros,
  } as const;
  try {
    return await repository.createPersonalScenario(createInput);
  } catch (error) {
    const concurrent = await repository.findPersonalScenarioByIdempotencyKey(input.userId, input.idempotencyKey);
    if (!concurrent) throw error;
    if (concurrent.inputFingerprint !== inputFingerprint) throw new PersonalScenarioConflictError();
    return concurrent;
  }
}
