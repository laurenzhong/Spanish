import { z } from "zod";

export const mediaWordTimingsSchema = z.array(z.strictObject({
  startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
  startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(),
})).max(2000).readonly();

const stableKeySchema = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,199}$/u);

export const mediaListQuerySchema = z.strictObject({
  search: z.string().trim().max(120).optional(),
  kind: z.enum(["video", "podcast"]).optional(),
  region: z.string().trim().max(40).optional(),
  cefr: z.enum(["A2", "B1"]).optional(),
  duration: z.enum(["short", "medium", "long"]).optional(),
  sort: z.enum(["newest", "recently_added", "recently_played"]).default("recently_added"),
  cursor: z.string().trim().max(500).optional(),
  pageSize: z.number().int().min(1).max(50).default(18),
});

export const mediaStableKeySchema = stableKeySchema;

export const mediaArtworkSchema = z.strictObject({
  url: z.url().startsWith("https://"),
  alt: z.string().trim().min(1).max(300),
  source: z.enum(["youtube", "podcast-feed", "fallback"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
}).superRefine((value, context) => {
  if ((value.width === null) !== (value.height === null)) {
    context.addIssue({ code: "custom", message: "Artwork dimensions must be both null or both positive." });
  }
});

export const saveMediaProgressSchema = z.strictObject({
  version: z.number().int().positive(),
  expectedRevision: z.number().int().nonnegative(),
  lastPositionMs: z.number().int().nonnegative(),
  lastSegmentIndex: z.number().int().nonnegative().nullable(),
  status: z.enum(["in_progress", "completed"]),
});

export type MediaListQuery = z.input<typeof mediaListQuerySchema>;
export type ParsedMediaListQuery = z.output<typeof mediaListQuerySchema>;
export type SaveMediaProgressRequest = z.infer<typeof saveMediaProgressSchema>;
