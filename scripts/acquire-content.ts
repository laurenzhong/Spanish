import "dotenv/config";

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  ContentAcquisitionRunError,
  ContentSourceDisabledError,
  ContentSourceNotFoundError,
  FakeContentSourceAdapter,
  createArticleRssAdapterFromSource,
  createYouTubeChannelAdapterFromSource,
  contentSourcePageSchema,
  createDrizzleContentAcquisitionRepository,
  runAcquisitionSource,
  prepareArticleCandidateForReview,
  prepareVideoCandidateForReview,
  type ContentAcquisitionRepository,
  type ContentSourceAdapter,
} from "../src/modules/content-acquisition/index";
import { createDatabaseConnection } from "../src/shared/db/client";

export class AcquireContentCliInputError extends Error {
  readonly code = "VALIDATION_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "AcquireContentCliInputError";
  }
}

export type AcquireContentCliOptions = Readonly<{
  sourceStableKey: string;
  dryRun: boolean;
  limit: number;
}>;

export type AcquireContentCliDependencies = Readonly<{
  repository: ContentAcquisitionRepository;
  adapter: ContentSourceAdapter;
  write: (line: string) => void;
}>;

export function parseAcquireContentArguments(args: readonly string[]): AcquireContentCliOptions {
  let sourceStableKey: string | null = null;
  let dryRun = false;
  let limit = 50;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--source") {
      if (sourceStableKey !== null) throw new AcquireContentCliInputError("--source may only be provided once.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new AcquireContentCliInputError("--source requires a stable key.");
      sourceStableKey = value;
      index += 1;
      continue;
    }
    if (argument === "--dry-run") {
      if (dryRun) throw new AcquireContentCliInputError("--dry-run may only be provided once.");
      dryRun = true;
      continue;
    }
    if (argument === "--limit") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new AcquireContentCliInputError("--limit requires an integer.");
      limit = Number(value);
      index += 1;
      continue;
    }
    throw new AcquireContentCliInputError(`Unsupported argument: ${argument ?? ""}`);
  }

  if (sourceStableKey === null) {
    throw new AcquireContentCliInputError("--source is required; acquisition never selects a source implicitly.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AcquireContentCliInputError("--limit must be an integer between 1 and 500.");
  }

  return { sourceStableKey, dryRun, limit };
}

export async function runAcquireContentCli(
  args: readonly string[],
  dependencies: AcquireContentCliDependencies,
): Promise<void> {
  const options = parseAcquireContentArguments(args);
  const result = await runAcquisitionSource({
    repository: dependencies.repository,
    adapter: dependencies.adapter,
    input: options,
  });
  let reviewReady = 0;
  if (!result.dryRun && (dependencies.adapter.key === "article-rss" || dependencies.adapter.key === "youtube")) {
    for (const candidateId of result.insertedCandidateIds) {
      if (dependencies.adapter.key === "article-rss") {
        await prepareArticleCandidateForReview(dependencies.repository, candidateId);
      } else {
        await prepareVideoCandidateForReview(dependencies.repository, candidateId);
      }
      reviewReady += 1;
    }
  }
  dependencies.write(JSON.stringify({
    runId: result.runId,
    status: "succeeded",
    steps: {
      discovery: "completed",
      persistence: result.dryRun ? "skipped" : "completed",
      ...(["article-rss", "youtube"].includes(dependencies.adapter.key) ? { processing: result.dryRun ? "skipped" : "completed" } : {}),
    },
    counts: {
      discovered: result.discovered,
      inserted: result.inserted,
      duplicates: result.duplicates,
      conflicts: result.conflicts,
      ...(["article-rss", "youtube"].includes(dependencies.adapter.key) ? { reviewReady } : {}),
    },
    estimatedCostMicros: result.estimatedCostMicros,
  }));
}

async function loadConfiguredFakeAdapter(): Promise<FakeContentSourceAdapter> {
  const fixturePath = process.env.CONTENT_ACQUISITION_FAKE_FIXTURE;
  if (!fixturePath) {
    throw new ContentAcquisitionRunError(
      "CONTENT_ACQUISITION_FAKE_FIXTURE is required for the fake adapter.",
    );
  }
  const raw = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  return new FakeContentSourceAdapter([contentSourcePageSchema.parse(raw)]);
}

async function main(): Promise<void> {
  const options = parseAcquireContentArguments(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    throw new AcquireContentCliInputError("DATABASE_URL must be a PostgreSQL connection string.");
  }

  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    const source = await repository.findSourceByStableKey(options.sourceStableKey);
    if (!source) throw new ContentSourceNotFoundError();
    if (!source.enabled) throw new ContentSourceDisabledError();
    const adapter = source.adapterType === "fake"
      ? await loadConfiguredFakeAdapter()
      : source.adapterType === "article-rss"
        ? createArticleRssAdapterFromSource(source)
        : source.adapterType === "youtube"
          ? createYouTubeChannelAdapterFromSource(source)
        : null;
    if (!adapter) throw new ContentAcquisitionRunError("No runtime adapter is available for this source type.");
    await runAcquireContentCli(process.argv.slice(2), {
      repository,
      adapter,
      write: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await connection.client.end();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "CONTENT_PROCESSING_FAILED";
    const message = error instanceof Error ? error.message : "Content acquisition failed.";
    process.stderr.write(`${JSON.stringify({ code, message })}\n`);
    process.exitCode = error instanceof AcquireContentCliInputError ? 2 : 1;
  });
}
