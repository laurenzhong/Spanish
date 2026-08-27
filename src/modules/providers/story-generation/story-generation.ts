import { z } from "zod";

export const storyGenerationErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type StoryGenerationErrorCode = (typeof storyGenerationErrorCodes)[number];

export const storyGenerationInputSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  length: z.enum(["short", "medium", "long"]),
  format: z.enum(["story", "dialogue", "guide"]),
  keywords: z.array(z.string().trim().min(1).max(40)).max(8),
}).strict();

export type StoryGenerationInput = Readonly<z.infer<typeof storyGenerationInputSchema>>;

export const generatedStoryPayloadSchema = z.object({
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(600),
  segments: z.array(z.string().trim().min(1).max(1_000)).min(1).max(40),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  topics: z.array(z.string().trim().min(1).max(80)).max(8),
  register: z.enum(["neutral", "informal", "formal"]),
}).strict();

export type GeneratedStoryPayload = Readonly<z.infer<typeof generatedStoryPayloadSchema>>;

export type StoryGenerationResult = Readonly<GeneratedStoryPayload & {
  provider: "minimax";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
}>;

export interface StoryGenerationProvider {
  generate(
    input: StoryGenerationInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<StoryGenerationResult>;
}

export class StoryGenerationError extends Error {
  readonly code: StoryGenerationErrorCode;
  readonly retryable: boolean;

  constructor(code: StoryGenerationErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "StoryGenerationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateStoryGenerationInput(input: StoryGenerationInput): void {
  const parsed = storyGenerationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new StoryGenerationError("input-invalid", "Story generation input is invalid.", false);
  }
}
