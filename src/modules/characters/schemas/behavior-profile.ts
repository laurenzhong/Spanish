import { z } from "zod";

const key = z.string().trim().min(3).max(160).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const statement = z.string().trim().min(1).max(500);
const statements = z.array(statement).min(1).max(8);
const trait = z.object({
  id: key,
  tendency: statement,
  activationConditions: statements,
  behaviorRange: statements,
  stressVariation: statement,
  mustNotInfer: statements,
  sourceRefs: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
}).strict();

const metadata = {
  schemaVersion: z.literal(1),
  characterKey: key,
  characterVersion: z.number().int().positive(),
  profileVersion: z.string().trim().min(1).max(80),
};

const uniqueTraitIds = (value: { traits: readonly { id: string }[] }) =>
  new Set(value.traits.map(({ id }) => id)).size === value.traits.length;

export const characterBehaviorGuidanceSchema = z.object({
  ...metadata,
  traits: z.array(trait.omit({ sourceRefs: true })).min(1).max(8),
}).strict().refine(uniqueTraitIds, { message: "Trait IDs must be unique", path: ["traits"] })
  .refine((value) => JSON.stringify(value).length <= 12_000, "Behavior guidance exceeds total size limit");

export const characterBehaviorProfileSchema = z.object({
  ...metadata,
  traits: z.array(trait).min(1).max(8),
}).strict().refine(uniqueTraitIds, { message: "Trait IDs must be unique", path: ["traits"] })
  .refine((value) => JSON.stringify(value).length <= 16_000, "Behavior profile exceeds total size limit")
  .refine((value) => characterBehaviorGuidanceSchema.safeParse({
    ...value,
    traits: value.traits.map((entry) => {
      const guidance = { ...entry } as Partial<typeof entry>;
      delete guidance.sourceRefs;
      return guidance;
    }),
  }).success, "Behavior profile must fit the provider guidance limits");
