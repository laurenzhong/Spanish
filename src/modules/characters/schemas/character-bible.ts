import { z } from "zod";

const stableKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

const characterStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "published",
  "archived",
]);

const sensitivitySchema = z.enum(["normal", "sensitive", "private"]);

const revealModeSchema = z.enum(["never", "contextual", "gradual", "direct"]);

const revealAudienceSchema = z.enum(["any-user", "relationship"]);

const jsonObjectSchema = z.record(z.string(), z.json());

const identitySchema = z
  .object({
    age: z.number().int().min(1).max(120),
    growthLocation: z.string().trim().min(2).max(200),
    education: z.string().trim().min(2).max(300),
    occupation: z.string().trim().min(2).max(300),
  })
  .strict();

const topicPreferenceSchema = z
  .object({
    topic: z.string().trim().min(2).max(120),
    interest: z.enum(["low", "medium", "high"]),
    notes: z.string().trim().min(2).max(300),
  })
  .strict();

const personalitySchema = z
  .object({
    traits: z.array(z.string().trim().min(2).max(60)).min(2).max(10),
    tone: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
    initiative: z.enum(["low", "balanced", "high"]),
    responseStyle: z.array(z.string().trim().min(2).max(120)).min(1).max(8),
    topicPreferences: z.array(topicPreferenceSchema).min(1).max(12),
  })
  .strict();

const relationshipSchema = z
  .object({
    relationshipKey: stableKeySchema,
    role: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2).max(500),
  })
  .strict();

const revealSchema = z
  .object({
    mode: revealModeSchema,
    audience: revealAudienceSchema,
    trigger: z.string().trim().min(2).max(500),
  })
  .strict();

const canonFactSchema = z
  .object({
    factKey: stableKeySchema,
    category: z.enum([
      "identity",
      "background",
      "preference",
      "relationship",
      "routine",
      "boundary",
    ]),
    value: jsonObjectSchema,
    sensitivity: sensitivitySchema,
    version: z.number().int().positive(),
    isActive: z.boolean(),
    reveal: revealSchema,
  })
  .strict();

const changeLogEntrySchema = z
  .object({
    version: z.number().int().positive(),
    supersedesVersion: z.number().int().positive(),
    changeReason: z.string().trim().min(2).max(1_000),
  })
  .strict();

export const characterBibleSchema = z
  .object({
    stableKey: stableKeySchema,
    version: z.number().int().positive(),
    status: characterStatusSchema,
    displayName: z.string().trim().min(1).max(120),
    avatarUrl: z.url().optional(),
    homeLocation: z.string().trim().min(2).max(200),
    identity: identitySchema,
    personality: personalitySchema,
    relationships: z.array(relationshipSchema).max(30),
    facts: z.array(canonFactSchema).min(1).max(100),
    changeLog: z.array(changeLogEntrySchema).max(30),
  })
  .strict();

export type CharacterBible = z.infer<typeof characterBibleSchema>;
export type CharacterIdentity = CharacterBible["identity"];
export type CharacterCanonFact = CharacterBible["facts"][number];
export type CharacterRevealPolicy = CharacterCanonFact["reveal"];
export type CharacterStatus = CharacterBible["status"];

