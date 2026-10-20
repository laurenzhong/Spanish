import { z } from "zod";

import {
  isSafeMediaSeriesAuditText,
  mediaSeriesKeyPattern,
  mediaSeriesMaximumRevision,
  validateMediaSeriesCommand,
} from "../domain/media-series";

export const mediaSeriesKeySchema = z.string().trim().regex(mediaSeriesKeyPattern);
export const mediaSeriesSummarySchema = z.object({
  seriesKey: mediaSeriesKeySchema, title: z.string().min(1).max(200), kind: z.enum(["video", "podcast"]),
  orderMode: z.enum(["ordered", "episodic"]), revision: z.number().int().positive(),
  seasonNumber: z.number().int().nonnegative().nullable(), episodeNumber: z.number().int().nonnegative().nullable(),
  episodeLabel: z.string().nullable(),
});
const revision = z.number().int().min(0).max(mediaSeriesMaximumRevision);
const positiveInteger = z.number().int().min(1).max(mediaSeriesMaximumRevision);
const auditText = (min: number, max: number) => z.string().trim().min(min).max(max).refine(isSafeMediaSeriesAuditText, "Audit metadata must not contain credentials or signed playback URLs.");
const evidence = z.array(auditText(1, 500)).min(1).max(12);

export const mediaSeriesMembershipInputSchema = z.strictObject({
  stableKey: mediaSeriesKeySchema,
  position: positiveInteger.nullable(),
  seasonNumber: revision.nullable(),
  episodeNumber: revision.nullable(),
  episodeLabel: auditText(1, 120).nullable(),
  evidence,
});

export const saveMediaSeriesCommandSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9._:-]+$/u),
  expectedRevision: revision,
  title: auditText(1, 200),
  summary: auditText(0, 1000),
  kind: z.enum(["video", "podcast"]),
  orderMode: z.enum(["ordered", "episodic"]),
  status: z.enum(["active", "archived"]),
  reason: auditText(1, 1000),
  evidence,
  members: z.array(mediaSeriesMembershipInputSchema).max(500),
  removeStableKeys: z.array(mediaSeriesKeySchema).max(500),
  fromSeriesRevisions: z.record(mediaSeriesKeySchema, positiveInteger),
}).superRefine((command, context) => {
  try { validateMediaSeriesCommand(command); }
  catch { context.addIssue({ code: "custom", message: "MEDIA_SERIES_COMMAND_INVALID" }); }
});

export const mediaSeriesEpisodesQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(2000).optional(),
  pageSize: z.number().int().min(1).max(50).default(20),
  anchorMediaKey: mediaSeriesKeySchema.optional(),
}).superRefine((value, context) => {
  if (value.cursor && value.anchorMediaKey) context.addIssue({ code: "custom", message: "Cursor and anchor are mutually exclusive." });
});
export type MediaSeriesEpisodesQuery = z.infer<typeof mediaSeriesEpisodesQuerySchema>;
export type SaveMediaSeriesRequest = z.infer<typeof saveMediaSeriesCommandSchema>;
