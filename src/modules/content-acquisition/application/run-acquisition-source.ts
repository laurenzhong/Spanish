import { randomUUID } from "node:crypto";

import { normalizeCandidateUrl } from "../domain";
import type { ContentSourceAdapter } from "../adapters";
import type { ContentAcquisitionRepository } from "../repositories";

export class ContentSourceNotFoundError extends Error {
  readonly code = "CONTENT_SOURCE_NOT_FOUND" as const;

  constructor() {
    super("Content source was not found.");
    this.name = "ContentSourceNotFoundError";
  }
}

export class ContentSourceDisabledError extends Error {
  readonly code = "CONTENT_SOURCE_DISABLED" as const;

  constructor() {
    super("Content source is disabled.");
    this.name = "ContentSourceDisabledError";
  }
}

export class ContentAcquisitionRunError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContentAcquisitionRunError";
  }
}

export type RunAcquisitionSourceInput = Readonly<{
  sourceStableKey: string;
  dryRun: boolean;
  limit: number;
}>;

export type RunAcquisitionSourceResult = Readonly<{
  runId: string;
  sourceStableKey: string;
  dryRun: boolean;
  discovered: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  nextCursor: string | null;
  estimatedCostMicros: number;
  insertedCandidateIds: readonly string[];
}>;

export type RunAcquisitionDependencies = Readonly<{
  now: () => Date;
  makeRunId: () => string;
  makeCandidateId: (index: number) => string;
  makeGenerationId: () => string;
}>;

const defaultDependencies: RunAcquisitionDependencies = {
  now: () => new Date(),
  makeRunId: randomUUID,
  makeCandidateId: () => randomUUID(),
  makeGenerationId: randomUUID,
};

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "reasonCode" in error && typeof error.reasonCode === "string") {
    return error.reasonCode;
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "CONTENT_PROCESSING_FAILED";
}

export async function runAcquisitionSource(options: Readonly<{
  repository: ContentAcquisitionRepository;
  adapter: ContentSourceAdapter;
  input: RunAcquisitionSourceInput;
  dependencies?: Partial<RunAcquisitionDependencies>;
  signal?: AbortSignal;
}>): Promise<RunAcquisitionSourceResult> {
  const { repository, adapter, input, signal } = options;
  const assertActive = () => {
    if (signal?.aborted) throw new ContentAcquisitionRunError("Content acquisition was cancelled.");
  };
  assertActive();
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new RangeError("Content acquisition limit must be between 1 and 500.");
  }
  const source = await repository.findSourceByStableKey(input.sourceStableKey);
  assertActive();
  if (!source) throw new ContentSourceNotFoundError();
  if (!source.enabled) throw new ContentSourceDisabledError();
  if (source.adapterType !== adapter.key) {
    throw new ContentAcquisitionRunError("The selected adapter does not match the registered source.");
  }

  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const runId = dependencies.makeRunId();
  const generationId = dependencies.makeGenerationId();
  const startedAt = dependencies.now();
  let runCreated = false;

  try {
    if (!input.dryRun) {
      await repository.createRun({
        id: runId,
        sourceId: source.id,
        generationId,
        initialCursor: source.cursor,
        startedAt,
      });
      runCreated = true;
    }
    assertActive();

    const page = await adapter.discover({
      sourceStableKey: source.stableKey,
      externalSourceId: source.externalSourceId,
      cursor: source.cursor,
      limit: input.limit,
    }, { signal });
    assertActive();
    if (page.sourceStableKey !== source.stableKey || page.cursor !== source.cursor) {
      throw new ContentAcquisitionRunError("Adapter returned a page for a different source revision.");
    }

    if (input.dryRun) {
      return {
        runId,
        sourceStableKey: source.stableKey,
        dryRun: true,
        discovered: page.items.length,
        inserted: 0,
        duplicates: 0,
        conflicts: 0,
        nextCursor: page.nextCursor,
        estimatedCostMicros: page.estimatedCostMicros,
        insertedCandidateIds: [],
      };
    }

    const committed = await repository.commitDiscoveryPage({
      runId,
      sourceId: source.id,
      expectedSourceRevision: source.revision,
      nextCursor: page.nextCursor,
      candidates: page.items.map((item, index) => ({
        id: dependencies.makeCandidateId(index),
        sourceId: source.id,
        externalItemId: item.externalItemId,
        normalizedUrl: normalizeCandidateUrl(item.canonicalUrl),
        title: item.title,
        contentType: item.contentType,
        language: item.language,
        publishedAt: item.publishedAt === null ? null : new Date(item.publishedAt),
        contentHash: item.contentHash,
        metadata: item.metadata,
        rightsStatus: source.rightsStatus,
        generationId,
        discoveredAt: dependencies.now(),
      })),
    });
    const completedAt = dependencies.now();
    await repository.completeRun({
      runId,
      ...committed,
      committedCursor: page.nextCursor,
      estimatedCostMicros: page.estimatedCostMicros,
      completedAt,
    });
    return {
      runId,
      sourceStableKey: source.stableKey,
      dryRun: false,
      discovered: page.items.length,
      ...committed,
      nextCursor: page.nextCursor,
      estimatedCostMicros: page.estimatedCostMicros,
    };
  } catch (error) {
    if (runCreated) {
      try {
        await repository.failRun({
          runId,
          errorCode: errorCode(error),
          completedAt: dependencies.now(),
        });
      } catch {
        // Preserve the original discovery/transaction error for the caller.
      }
    }
    throw error;
  }
}
