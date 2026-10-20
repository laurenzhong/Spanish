import { createHash } from "node:crypto";

import { z } from "zod";

import { assertContentWorkflowOwner, contentWorkflowActorHash } from "@/src/shared/auth/content-workflow-owner";
import type { MediaSeriesRepository } from "../repositories/media-series-repository";
import { mediaSeriesKeySchema, saveMediaSeriesCommandSchema } from "../schemas/media-series";
import { saveMediaSeries } from "./media-series";

export class MediaSeriesImportError extends Error {
  constructor(readonly code: "MEDIA_SERIES_MANIFEST_INVALID" | "MEDIA_SERIES_MANIFEST_HASH_MISMATCH") {
    super(code);
    this.name = "MediaSeriesImportError";
  }
}

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogueKey: mediaSeriesKeySchema,
  entries: z.array(z.strictObject({ seriesKey: mediaSeriesKeySchema, command: saveMediaSeriesCommandSchema })).min(1).max(100),
}).superRefine((manifest, context) => {
  const seriesKeys = new Set<string>();
  const mediaKeys = new Set<string>();
  for (const [index, entry] of manifest.entries.entries()) {
    if (seriesKeys.has(entry.seriesKey)) context.addIssue({ code: "custom", path: ["entries", index, "seriesKey"], message: "Duplicate series." });
    seriesKeys.add(entry.seriesKey);
    for (const stableKey of [...entry.command.members.map((member) => member.stableKey), ...entry.command.removeStableKeys]) {
      if (mediaKeys.has(stableKey)) context.addIssue({ code: "custom", path: ["entries", index, "command"], message: "Duplicate media across entries." });
      mediaKeys.add(stableKey);
    }
  }
});

export type MediaSeriesManifest = z.infer<typeof manifestSchema>;
export type MediaSeriesImportReport = Readonly<{
  mode: "dry-run" | "apply";
  catalogueKey: string;
  sha256: string;
  actorHash: string;
  entries: readonly Readonly<{ seriesKey: string; expectedRevision: number; resultRevision: number }>[];
}>;
export type MediaSeriesImportTransaction = <T>(operation: (repository: MediaSeriesRepository) => Promise<T>) => Promise<T>;

/** Hash exact input bytes: whitespace or encoding changes require a new approval hash. */
export function inspectMediaSeriesManifest(source: string | Uint8Array): Readonly<{ manifest: MediaSeriesManifest; sha256: string }> {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    if (bytes.length > 10 * 1024 * 1024) throw new Error();
    // UTF-8 BOM is accepted for JSON parsing but remains part of the bound hash.
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
    return { manifest: manifestSchema.parse(JSON.parse(raw)), sha256 };
  } catch { throw new MediaSeriesImportError("MEDIA_SERIES_MANIFEST_INVALID"); }
}

/** The adapter must supply one real transaction; dry-run executes then rolls it back. */
export async function importMediaSeriesManifest(input: Readonly<{
  source: string | Uint8Array;
  ownerUserId: string;
  mode?: "dry-run" | "apply";
  expectedSha256?: string;
}>, dependencies: Readonly<{ transaction: MediaSeriesImportTransaction }>): Promise<MediaSeriesImportReport> {
  const ownerUserId = input.ownerUserId.toLowerCase();
  assertContentWorkflowOwner(ownerUserId);
  const { manifest, sha256 } = inspectMediaSeriesManifest(input.source);
  const mode = input.mode ?? "dry-run";
  if ((mode === "apply" && !input.expectedSha256) || (input.expectedSha256 !== undefined && input.expectedSha256.toLowerCase() !== sha256)) {
    throw new MediaSeriesImportError("MEDIA_SERIES_MANIFEST_HASH_MISMATCH");
  }
  // An identity sentinel avoids swallowing repository errors as a successful rehearsal.
  const rehearsalComplete = new Error("MEDIA_SERIES_DRY_RUN_ROLLBACK");
  let report: MediaSeriesImportReport | undefined;
  try {
    return await dependencies.transaction(async (repository) => {
      const entries: { seriesKey: string; expectedRevision: number; resultRevision: number }[] = [];
      for (const entry of manifest.entries) {
        const result = await saveMediaSeries(repository, entry.seriesKey, entry.command, ownerUserId);
        entries.push({ seriesKey: entry.seriesKey, expectedRevision: entry.command.expectedRevision, resultRevision: result.revision });
      }
      report = { mode, catalogueKey: manifest.catalogueKey, sha256, actorHash: contentWorkflowActorHash(ownerUserId), entries };
      if (mode === "dry-run") throw rehearsalComplete;
      return report;
    });
  } catch (error) {
    if (error === rehearsalComplete && report) return report;
    throw error;
  }
}
