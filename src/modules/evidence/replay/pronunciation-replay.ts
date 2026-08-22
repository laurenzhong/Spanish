import { z } from "zod";

export const pronunciationReplaySetVersion = "1.0" as const;
export const pronunciationReplaySchemaId =
  "https://spanish.local/evaluation/pronunciation/v1" as const;

const scoreRangeSchema = z
  .object({
    min: z.number().finite().min(0).max(1),
    max: z.number().finite().min(0).max(1),
  })
  .strict()
  .refine((range) => range.min <= range.max, "Score range minimum must not exceed maximum.");

const scenarioSchema = z
  .object({
    goalKey: z.string().trim().min(1),
    context: z.string().trim().min(1),
    referenceExpression: z.string().trim().min(1),
    intendedMeaning: z.string().trim().min(1),
  })
  .strict();

const inputSchema = z
  .object({
    outputMode: z.literal("speech"),
    syntheticUtterance: z.string().trim().min(1),
    audioCondition: z.enum([
      "clear",
      "phoneme-error",
      "pausing",
      "noise",
      "silence",
      "provider-failure",
      "truncated",
    ]),
    hasUsableSpeech: z.boolean(),
    transcriptConfidence: z.number().finite().min(0).max(1).nullable(),
    providerDisposition: z.enum(["usable", "insufficient", "technical-failure"]),
  })
  .strict();

const expectationSchema = z
  .object({
    contextualSuccess: z.boolean().nullable(),
    evidenceDisposition: z.enum(["candidate", "insufficient", "technical-failure"]),
    pronunciationScoreRange: scoreRangeSchema.nullable(),
    fluencyScoreRange: scoreRangeSchema.nullable(),
    skillsToUpdate: z.array(z.string().trim().min(1)),
    skillsNotToUpdate: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((expectation, context) => {
    if (expectation.evidenceDisposition === "candidate") {
      if (expectation.contextualSuccess !== true) {
        context.addIssue({
          code: "custom",
          message: "Candidate evidence requires contextual success.",
          path: ["contextualSuccess"],
        });
      }
      if (
        expectation.pronunciationScoreRange === null ||
        expectation.fluencyScoreRange === null
      ) {
        context.addIssue({
          code: "custom",
          message: "Candidate evidence requires both score ranges.",
          path: ["pronunciationScoreRange"],
        });
      }
    } else if (
      expectation.pronunciationScoreRange !== null ||
      expectation.fluencyScoreRange !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-candidate evidence must not claim provider score ranges.",
        path: ["evidenceDisposition"],
      });
    }
  });

const annotationSchema = z
  .object({
    status: z.enum(["pending", "reviewed"]),
    reviewerId: z.string().trim().min(1).nullable(),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
    pronunciationRating: z.number().finite().min(0).max(1).nullable(),
    fluencyRating: z.number().finite().min(0).max(1).nullable(),
    notes: z.string().trim().min(1),
  })
  .strict()
  .superRefine((annotation, context) => {
    const hasReview = annotation.status === "reviewed";
    if (
      hasReview !==
      (annotation.reviewerId !== null &&
        annotation.reviewedAt !== null &&
        annotation.pronunciationRating !== null &&
        annotation.fluencyRating !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Reviewed annotations require reviewer, time, and both ratings.",
        path: ["status"],
      });
    }
  });

export const pronunciationReplaySampleSchema = z
  .object({
    setVersion: z.literal(pronunciationReplaySetVersion),
    sampleId: z.string().regex(/^pronunciation\.[a-z0-9-]+$/),
    locale: z.enum(["es-ES", "es-MX"]),
    scenario: scenarioSchema,
    input: inputSchema,
    expectation: expectationSchema,
    annotation: annotationSchema,
  })
  .strict()
  .superRefine((sample, context) => {
    const { input, expectation } = sample;
    const dispositionMatches =
      input.providerDisposition === "usable"
        ? expectation.evidenceDisposition === "candidate"
        : input.providerDisposition === "insufficient"
          ? expectation.evidenceDisposition === "insufficient"
          : expectation.evidenceDisposition === "technical-failure";
    if (!dispositionMatches) {
      context.addIssue({
        code: "custom",
        message: "Provider disposition and evidence disposition must agree.",
        path: ["expectation", "evidenceDisposition"],
      });
    }
    if (input.providerDisposition === "usable" && !input.hasUsableSpeech) {
      context.addIssue({
        code: "custom",
        message: "Usable provider results require usable speech input.",
        path: ["input", "hasUsableSpeech"],
      });
    }
    if (input.providerDisposition !== "usable" && expectation.skillsToUpdate.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Insufficient or failed samples cannot update skills.",
        path: ["expectation", "skillsToUpdate"],
      });
    }
  });

export type PronunciationReplaySample = z.infer<typeof pronunciationReplaySampleSchema>;

export const pronunciationReplayManifestSchema = z
  .object({
    setVersion: z.literal(pronunciationReplaySetVersion),
    schemaId: z.literal(pronunciationReplaySchemaId),
    description: z.string().trim().min(1),
    syntheticOnly: z.literal(true),
    containsAudio: z.literal(false),
    containsProviderResponses: z.literal(false),
    samples: z
      .array(
        z
          .object({
            file: z.string().regex(/^[a-z0-9-]+\.json$/),
            sampleId: z.string().regex(/^pronunciation\.[a-z0-9-]+$/),
            locale: z.enum(["es-ES", "es-MX"]),
            category: z.enum([
              "clear",
              "natural-alternative",
              "phoneme-error",
              "pausing",
              "noise",
              "silence",
              "technical-failure",
              "low-confidence",
              "truncated",
            ]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type PronunciationReplayManifest = z.infer<
  typeof pronunciationReplayManifestSchema
>;

export function parsePronunciationReplaySample(
  input: unknown,
): PronunciationReplaySample {
  return pronunciationReplaySampleSchema.parse(input);
}

export function parsePronunciationReplayManifest(
  input: unknown,
): PronunciationReplayManifest {
  return pronunciationReplayManifestSchema.parse(input);
}
