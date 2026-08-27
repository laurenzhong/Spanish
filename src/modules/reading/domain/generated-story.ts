import { z } from "zod";

import type { ArticleCardProjection, ArticleReaderProjection } from "@/src/modules/content/domain";
import type { GeneratedStoryPayload, StoryGenerationInput } from "@/src/modules/providers/story-generation";

export const generatedStoryRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  length: z.enum(["short", "medium", "long"]),
  format: z.enum(["story", "dialogue", "guide"]),
  keywords: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
}).strict();

export type GeneratedStoryRequest = Readonly<z.infer<typeof generatedStoryRequestSchema>>;

export type GeneratedStoryCard = ArticleCardProjection & Readonly<{
  origin: "generated";
  generatedAt: Date;
}>;

export type GeneratedStoryReader = ArticleReaderProjection & Readonly<{
  origin: "generated";
  generatedAt: Date;
}>;

export function normalizeGeneratedStoryRequest(input: StoryGenerationInput): GeneratedStoryRequest {
  const parsed = generatedStoryRequestSchema.parse({
    ...input,
    keywords: input.keywords.map((keyword) => keyword.trim()).filter(Boolean),
  });
  return {
    ...parsed,
    prompt: sanitizeText(parsed.prompt),
    keywords: parsed.keywords.map(sanitizeText),
  };
}

export function normalizeGeneratedStoryPayload(payload: GeneratedStoryPayload): GeneratedStoryPayload {
  const parsed = {
    ...payload,
    title: sanitizeText(payload.title),
    summary: sanitizeText(payload.summary),
    segments: payload.segments.map(sanitizeText).filter(Boolean),
    topics: payload.topics.map(sanitizeText).filter(Boolean),
  };
  if (!parsed.title || !parsed.summary || parsed.segments.length === 0) throw new Error("GENERATED_STORY_EMPTY");
  if (parsed.segments.join("\n\n").length > 8_000) throw new Error("GENERATED_STORY_TOO_LONG");
  return parsed;
}

export function generatedStoryEstimatedMinutes(segments: readonly string[]): number {
  const words = segments.join(" ").trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}

export function generatedStoryToProviderInput(input: GeneratedStoryRequest): StoryGenerationInput {
  return input;
}

function sanitizeText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
