import { z } from "zod";

const score = z.number().finite().min(0).max(1);

export const skillObservationSchema = z.object({
  isTargetSkill: z.boolean(),
  skillKey: z.string().trim().min(1),
  tagWeight: score.refine((value) => value > 0, "Tag weight must be positive."),
});

export const attemptEvaluationSchema = z.object({
  algorithmVersion: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  contextualSuccess: z.boolean(),
  evaluationConfidence: score,
  evidenceStrength: z.enum(["none", "weak", "moderate", "strong"]),
  hintLevel: z.number().int().min(0).max(3),
  hasUsableTranscript: z.boolean(),
  idempotencyKey: z.string().trim().min(1),
  modality: z.enum(["speech", "typing"]),
  occurredAt: z.date().optional(),
  practiceAttemptId: z.string().uuid(),
  skillObservations: z
    .array(skillObservationSchema)
    .min(1)
    .superRefine((observations, context) => {
      const seen = new Set<string>();
      observations.forEach((observation, index) => {
        if (seen.has(observation.skillKey)) {
          context.addIssue({
            code: "custom",
            message: "Skill observations must use unique skill keys.",
            path: [index, "skillKey"],
          });
        }
        seen.add(observation.skillKey);
      });
    }),
  taskDifficulty: score,
  targetExpressionUsed: z.boolean(),
  technicalFailure: z.boolean(),
  transcriptConfidence: score.nullable(),
  userId: z.string().uuid(),
});

export type AttemptEvaluationInput = z.infer<typeof attemptEvaluationSchema>;
export type SkillObservation = z.infer<typeof skillObservationSchema>;

export function parseAttemptEvaluation(input: unknown): AttemptEvaluationInput {
  return attemptEvaluationSchema.parse(input);
}
