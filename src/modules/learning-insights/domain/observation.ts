import { z } from "zod";

/**
 * The observation layer deliberately stores facts about a learning action,
 * rather than the text that caused the action.  Candidates and reports are
 * built later from these stable references.
 */
export const learningObservationEventTypes = [
  "media_exposure",
  "reading_exposure",
  "lookup",
  "selection_explanation",
  "assistant_intent",
  "lexical_assessment",
  "replay",
] as const;

export type LearningObservationEventType =
  (typeof learningObservationEventTypes)[number];
export const learningObservationEventTypeSchema = z.enum(learningObservationEventTypes);

export const learningObservationSourceModules = [
  "media",
  "reading",
  "lexicon-corpus",
  "conversation",
  "training",
] as const;

export type LearningObservationSourceModule =
  (typeof learningObservationSourceModules)[number];
export const learningObservationSourceModuleSchema = z.enum(learningObservationSourceModules);

export const learningObservationSubjectTypes = [
  "lexeme",
  "phrase",
  "content_segment",
  "skill",
  "none",
] as const;

export type LearningObservationSubjectType =
  (typeof learningObservationSubjectTypes)[number];
export const learningObservationSubjectTypeSchema = z.enum(learningObservationSubjectTypes);

export const learningObservationSignalStrengths = [
  "exposure",
  "weak",
  "moderate",
  "strong",
] as const;

export type LearningObservationSignalStrength =
  (typeof learningObservationSignalStrengths)[number];
export const learningObservationSignalStrengthSchema = z.enum(learningObservationSignalStrengths);

const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const opaqueReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(opaqueReferencePattern);

export const learningObservationReferenceSchema = z
  .strictObject({
    type: z.enum(["lexeme", "phrase", "content_segment", "skill"]),
    id: opaqueReferenceSchema,
    version: z.number().int().positive().optional(),
  })
  .readonly();

export type LearningObservationReference = z.infer<
  typeof learningObservationReferenceSchema
>;

const sourceLabelSchema = z.enum([
  "video",
  "podcast",
  "article",
  "conversation",
  "training",
  "word_lookup",
  "phrase_lookup",
]);

const inputMethodSchema = z.enum(["tap", "selection", "keyboard", "shortcut"]);

/**
 * Metadata is a closed vocabulary.  In particular, `text`, `selection`,
 * `question`, `messages`, and similar fields are intentionally not part of
 * this schema.  Unknown keys are rejected by `strictObject`.
 */
export const learningObservationMetadataSchema = z
  .strictObject({
    action: z
      .enum(["opened", "played", "completed", "looked_up", "explained"])
      .optional(),
    contentKind: z.enum(["video", "podcast", "article"]).optional(),
    contentRef: learningObservationReferenceSchema.optional(),
    subjectRef: learningObservationReferenceSchema.optional(),
    sourceLabel: sourceLabelSchema.optional(),
    completionRatio: z.number().min(0).max(1).optional(),
    progressRatio: z.number().min(0).max(1).optional(),
    lookupKind: z.enum(["word", "phrase", "sentence"]).optional(),
    inputMethod: inputMethodSchema.optional(),
    result: z.enum(["found", "not_found", "success", "failed"]).optional(),
    resolvedRef: learningObservationReferenceSchema.optional(),
    intent: z.enum(["grammar", "structure", "reply", "question"]).optional(),
    assessmentKind: z.enum(["recall", "meaning", "context", "choice"]).optional(),
    outcome: z.enum(["correct", "incorrect", "unknown", "skipped"]).optional(),
    replayKind: z.enum(["replay", "seek_back"]).optional(),
    replayCount: z.number().int().min(1).max(100).optional(),
  })
  .readonly();

export type LearningObservationMetadata = z.infer<
  typeof learningObservationMetadataSchema
>;

const forbiddenPrivacyKeys = new Map<string, LearningObservationPrivacyReason>([
  ["text", "raw-text"],
  ["rawtext", "raw-text"],
  ["sourcetext", "raw-text"],
  ["targettext", "raw-text"],
  ["inputtext", "raw-text"],
  ["transcript", "raw-text"],
  ["utterance", "raw-text"],
  ["answer", "raw-text"],
  ["output", "raw-text"],
  ["content", "raw-text"],
  ["selection", "raw-selection"],
  ["selectedtext", "raw-selection"],
  ["selectiontext", "raw-selection"],
  ["selectedrange", "raw-selection"],
  ["selectionrange", "raw-selection"],
  ["highlight", "raw-selection"],
  ["range", "raw-selection"],
  ["question", "raw-chat"],
  ["prompt", "raw-chat"],
  ["messages", "raw-chat"],
  ["conversation", "raw-chat"],
  ["chat", "raw-chat"],
  ["chatcontext", "raw-chat"],
  ["chathistory", "raw-chat"],
  ["conversationcontext", "raw-chat"],
  ["usermessage", "raw-chat"],
  ["assistantmessage", "raw-chat"],
]);

export type LearningObservationPrivacyReason =
  | "raw-text"
  | "raw-selection"
  | "raw-chat"
  | "forbidden-field"
  | "invalid-metadata";

export type LearningObservationPrivacyGate =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason: LearningObservationPrivacyReason;
      path?: string;
    }>;

function normalizedKey(key: string): string {
  return key.replace(/[\s_-]/gu, "").toLocaleLowerCase("en-US");
}

function findForbiddenPrivacyKey(
  value: unknown,
  path = "metadata",
): { reason: LearningObservationPrivacyReason; path: string } | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const result = findForbiddenPrivacyKey(entry, `${path}[${index}]`);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  for (const [key, entry] of Object.entries(value)) {
    const reason = forbiddenPrivacyKeys.get(normalizedKey(key));
    if (reason) return { reason, path: `${path}.${key}` };
    const nested = findForbiddenPrivacyKey(entry, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

/**
 * Applies the privacy gate before parsing/persisting an observation.  This
 * helper is intentionally usable at an API boundary where the input is still
 * `unknown`; it never returns the rejected payload.
 */
export function evaluateLearningObservationPrivacy(
  metadata: unknown,
): LearningObservationPrivacyGate {
  const forbidden = findForbiddenPrivacyKey(metadata);
  if (forbidden) return { allowed: false, ...forbidden };
  const parsed = learningObservationMetadataSchema.safeParse(metadata);
  if (!parsed.success) return { allowed: false, reason: "invalid-metadata" };
  return { allowed: true };
}

export function assertLearningObservationPrivacy(metadata: unknown): asserts metadata is LearningObservationMetadata {
  const gate = evaluateLearningObservationPrivacy(metadata);
  if (!gate.allowed) {
    throw new Error(`learning-observation-privacy:${gate.reason}`);
  }
}

export const learningObservationDedupeKeyPattern = /^[a-z0-9](?:[a-z0-9._:-]{2,159})$/u;

/**
 * Dedupe keys are opaque, non-whitespace identifiers.  We only canonicalize
 * Unicode form, surrounding whitespace, and case; internal whitespace is
 * rejected so a learner's phrase cannot accidentally become a stored key.
 */
export function normalizeDedupeKey(value: string): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!learningObservationDedupeKeyPattern.test(normalized)) return null;
  return normalized;
}

export function isValidLearningObservationDedupeKey(value: unknown): value is string {
  return typeof value === "string" && normalizeDedupeKey(value) !== null;
}

export const learningObservationDedupeKeySchema = z
  .string()
  .transform((value, context) => {
    const normalized = normalizeDedupeKey(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Invalid learning observation dedupe key." });
      return z.NEVER;
    }
    return normalized;
  });

export const learningObservationInputSchema = z
  .strictObject({
    // Optional compatibility fields accepted at HTTP boundaries.  The
    // application layer always replaces these with its authenticated user and
    // server receive time when constructing a persisted event.
    userId: opaqueReferenceSchema.optional(),
    eventType: z.enum(learningObservationEventTypes),
    sourceModule: z.enum(learningObservationSourceModules),
    subjectType: z.enum(learningObservationSubjectTypes),
    subjectId: opaqueReferenceSchema.nullable().optional().default(null),
    subjectVersion: z.number().int().positive().nullable().optional().default(null),
    signalStrength: z.enum(learningObservationSignalStrengths),
    metadata: learningObservationMetadataSchema,
    dedupeKey: learningObservationDedupeKeySchema,
    occurredAt: z.date().optional(),
  })
  .superRefine((value, context) => {
    if (value.subjectType === "none" && (value.subjectId !== null || value.subjectVersion !== null)) {
      context.addIssue({ code: "custom", path: ["subjectId"], message: "A none subject cannot have an id or version." });
    }
    if (value.subjectType !== "none" && value.subjectId === null) {
      context.addIssue({ code: "custom", path: ["subjectId"], message: "A typed subject requires an id." });
    }
    const gate = evaluateLearningObservationPrivacy(value.metadata);
    if (!gate.allowed) {
      context.addIssue({ code: "custom", path: ["metadata"], message: `Privacy gate rejected ${gate.reason}.` });
    }
  })
  .transform((value) => ({ ...value, dedupeKey: normalizeDedupeKey(value.dedupeKey)! }));

export type LearningObservationInput = z.infer<typeof learningObservationInputSchema>;

export type LearningObservationEvent = Readonly<{
  id: string;
  userId: string;
  eventType: LearningObservationEventType;
  sourceModule: LearningObservationSourceModule;
  subjectType: LearningObservationSubjectType;
  subjectId: string | null;
  subjectVersion: number | null;
  signalStrength: LearningObservationSignalStrength;
  metadata: LearningObservationMetadata;
  occurredAt: Date;
  dedupeKey: string;
  algorithmVersion: string;
  retentionUntil: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

export const learningInsightsPreferencesSchema = z.strictObject({
  learningInsightsEnabled: z.boolean(),
  recordAssistantLearningIntent: z.boolean(),
});

export type LearningInsightsPreferences = z.infer<
  typeof learningInsightsPreferencesSchema
>;

export function toLearningObservationEvent(
  input: LearningObservationInput,
  options: Readonly<{
    userId: string;
    now?: () => Date;
    id?: () => string;
    algorithmVersion?: string;
    retentionDays?: number;
  }>,
): LearningObservationEvent {
  const parsed = learningObservationInputSchema.parse(input);
  const now = options.now?.() ?? new Date();
  const retention = new Date(now);
  const retentionDays = options.retentionDays ?? 90;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("invalid-learning-observation-retention-days");
  }
  retention.setUTCDate(retention.getUTCDate() + retentionDays);
  const id = options.id?.() ?? crypto.randomUUID();
  const userId = opaqueReferenceSchema.parse(options.userId);
  return {
    ...parsed,
    id,
    userId,
    occurredAt: now,
    algorithmVersion: options.algorithmVersion ?? "learning-observations-v1",
    retentionUntil: retention,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateLearningObservationInput(input: unknown): LearningObservationInput {
  return learningObservationInputSchema.parse(input);
}

export function isLearningObservationEligibleSignal(
  signalStrength: LearningObservationSignalStrength,
): boolean {
  return signalStrength !== "exposure";
}

