import { z } from "zod";

import { mediaTopicFilters } from "../domain/media-topic";

const stableKeySchema = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,199}$/u);

export const mediaListQuerySchema = z.strictObject({
  search: z.string().trim().max(120).optional(),
  kind: z.enum(["video", "podcast"]).optional(),
  topic: z.enum(mediaTopicFilters.map((item) => item.value) as [
    (typeof mediaTopicFilters)[number]["value"],
    ...(typeof mediaTopicFilters)[number]["value"][],
  ]).optional(),
  region: z.string().trim().max(40).optional(),
  cefr: z.enum(["A2", "B1"]).optional(),
  duration: z.enum(["short", "medium", "long"]).optional(),
  sort: z.enum(["newest", "recently_added", "recently_played"]).default("recently_added"),
  cursor: z.string().trim().max(500).optional(),
  pageSize: z.number().int().min(1).max(50).default(18),
});

export const mediaStableKeySchema = stableKeySchema;

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
