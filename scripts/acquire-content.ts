import "dotenv/config";

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  ContentAcquisitionRunError,
  ContentSourceDisabledError,
  ContentSourceNotFoundError,
  FakeContentSourceAdapter,
  createArticleRssAdapterFromSource,
  createReadlangLinksAdapterFromSource,
  createLanguageReactorAdapterFromSource,
  createPodcastRssAdapterFromSource,
  createYouTubeChannelAdapterFromSource,
  contentSourcePageSchema,
  createDrizzleContentAcquisitionRepository,
  runAcquisitionSource,
  runContentCleanup,
  articlePublicationModes,
  planContentPipelineSources,
  prepareArticleCandidateForReview,
  preparePodcastCandidateForReview,
  prepareVideoCandidateForReview,
  runDailyArticlePipeline,
  runDailyMediaPipeline,
  mediaPublicationModes,
  createConfiguredArticleReviewProviders,
  createConfiguredArticleRevisionProvider,
  createConfiguredMediaReviewProviders,
  createConfiguredMediaRevisionProvider,
  contentWorkflowPublishers,
  CandidatePublisherRegistry,
  AcquiredArticlePublisher,
  type ContentAcquisitionRepository,
  type ContentSourceRecord,
  type ContentSourceAdapter,
} from "../src/modules/content-acquisition/index";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createDrizzleArticleRepository } from "../src/modules/content/repositories";

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

export type ContentPipelineCommand = "discover" | "process" | "cleanup" | "report" | "article-daily" | "media-daily";

export type ContentPipelineCliOptions = AcquireContentCliOptions & Readonly<{
  command: ContentPipelineCommand;
  allEnabled: boolean;
  articleMode?: typeof articlePublicationModes[number];
  dailyLimit?: number;
  sourceLimit?: number;
  policyVersion?: string;
  mediaMode?: typeof mediaPublicationModes[number];
  mediaDailyLimit?: number;
  mediaSourceLimit?: number;
}>;

/** Returns the calendar date used by the article policy, independent of the runner's UTC clock. */
export function formatArticleNaturalDate(
  value: Date = new Date(),
  timeZone = "Asia/Shanghai",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new AcquireContentCliInputError("Unable to determine the article natural date.");
  return `${year}-${month}-${day}`;
}

export function assertAutoPublishKillSwitch(
  mode: typeof articlePublicationModes[number],
  value = process.env.CONTENT_ARTICLE_AUTO_PUBLISH_KILL_SWITCH,
): void {
  if (mode === "auto-publish" && value !== "true") {
    throw new AcquireContentCliInputError(
      "CONTENT_ARTICLE_AUTO_PUBLISH_KILL_SWITCH must be true for auto-publish.",
    );
  }
}

export function assertMediaAutoPublishKillSwitch(
  mode: typeof mediaPublicationModes[number],
  value = process.env.CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH,
): void {
  if (mode === "auto-publish" && value !== "true") {
    throw new AcquireContentCliInputError(
      "CONTENT_MEDIA_AUTO_PUBLISH_KILL_SWITCH must be true for media auto-publish.",
    );
  }
}

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

export function parseContentPipelineArguments(args: readonly string[]): ContentPipelineCliOptions {
  const command = args.find((argument) => ["discover", "process", "cleanup", "report", "article-daily", "media-daily"].includes(argument)) as ContentPipelineCommand | undefined;
  if (command === "article-daily") {
    const modeIndex = args.indexOf("--mode");
    const mode = modeIndex >= 0 ? args[modeIndex + 1] : process.env.CONTENT_ARTICLE_DAILY_MODE ?? "disabled";
    const dailyIndex = args.indexOf("--daily-limit");
    const sourceIndex = args.indexOf("--source-limit");
    const policyIndex = args.indexOf("--policy-version");
    const dailyLimit = Number(dailyIndex >= 0 ? args[dailyIndex + 1] : process.env.CONTENT_ARTICLE_DAILY_LIMIT ?? 50);
    const sourceLimit = Number(sourceIndex >= 0 ? args[sourceIndex + 1] : process.env.CONTENT_ARTICLE_SOURCE_LIMIT ?? 10);
    const policyVersion = policyIndex >= 0 ? args[policyIndex + 1] : process.env.CONTENT_ARTICLE_PUBLICATION_POLICY_VERSION ?? "";
    if (!mode || !articlePublicationModes.includes(mode as typeof articlePublicationModes[number])) throw new AcquireContentCliInputError("--mode must be a valid article publication mode.");
    if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 50) throw new AcquireContentCliInputError("--daily-limit must be between 0 and 50.");
    if (!Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > 50) throw new AcquireContentCliInputError("--source-limit must be between 1 and 50.");
    if (mode !== "disabled" && !policyVersion) throw new AcquireContentCliInputError("policy version is required unless article mode is disabled.");
    return { sourceStableKey: "article-daily", dryRun: false, limit: dailyLimit || 1, command, allEnabled: false, articleMode: mode as typeof articlePublicationModes[number], dailyLimit, sourceLimit, policyVersion };
  }
  if (command === "media-daily") {
    const modeIndex = args.indexOf("--mode");
    const mode = modeIndex >= 0 ? args[modeIndex + 1] : process.env.CONTENT_MEDIA_DAILY_MODE ?? "disabled";
    const dailyIndex = args.indexOf("--daily-limit");
    const sourceIndex = args.indexOf("--source-limit");
    const dailyLimit = Number(dailyIndex >= 0 ? args[dailyIndex + 1] : process.env.CONTENT_MEDIA_DAILY_LIMIT ?? 50);
    const sourceLimit = Number(sourceIndex >= 0 ? args[sourceIndex + 1] : process.env.CONTENT_MEDIA_SOURCE_LIMIT ?? 10);
    if (!mode || !mediaPublicationModes.includes(mode as typeof mediaPublicationModes[number])) throw new AcquireContentCliInputError("--mode must be a valid media publication mode.");
    if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 50) throw new AcquireContentCliInputError("--daily-limit must be between 0 and 50.");
    if (!Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > 50) throw new AcquireContentCliInputError("--source-limit must be between 1 and 50.");
    return { sourceStableKey: "media-daily", dryRun: false, limit: dailyLimit || 1, command, allEnabled: false, mediaMode: mode as typeof mediaPublicationModes[number], mediaDailyLimit: dailyLimit, mediaSourceLimit: sourceLimit };
  }
  const allEnabled = args.includes("--all-enabled");
  const flags = args.filter((argument) => argument !== command && argument !== "--all-enabled");
  if (allEnabled) {
    const withoutSource = flags.filter((argument, index) => argument !== "--source" && flags[index - 1] !== "--source");
    const parsed = parseAcquireContentArguments(["--source", "all-enabled", ...withoutSource]);
    return { command: command ?? "discover", allEnabled: true, ...parsed };
  }
  if (command !== "discover" && !flags.includes("--source")) {
    return { command: command ?? "discover", allEnabled: false, ...parseAcquireContentArguments(["--source", "pipeline", ...flags]) };
  }
  return { command: command ?? "discover", allEnabled: false, ...parseAcquireContentArguments(flags) };
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
  const supportsAutomaticPreparation = ["article-rss", "podcast-rss", "youtube"].includes(dependencies.adapter.key);
  if (!result.dryRun && supportsAutomaticPreparation) {
    for (const candidateId of result.insertedCandidateIds) {
      if (dependencies.adapter.key === "article-rss") {
        await prepareArticleCandidateForReview(dependencies.repository, candidateId);
      } else if (dependencies.adapter.key === "podcast-rss") {
        await preparePodcastCandidateForReview(dependencies.repository, candidateId);
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
      ...(supportsAutomaticPreparation ? { processing: result.dryRun ? "skipped" : "completed" } : {}),
    },
    counts: {
      discovered: result.discovered,
      inserted: result.inserted,
      duplicates: result.duplicates,
      conflicts: result.conflicts,
      ...(supportsAutomaticPreparation ? { reviewReady } : {}),
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
  const args = process.argv.slice(2);
  const options = parseContentPipelineArguments(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    throw new AcquireContentCliInputError("DATABASE_URL must be a PostgreSQL connection string.");
  }

  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    if (options.command === "report") {
      const [sources, runs, candidates] = await Promise.all([
        repository.listSources(),
        repository.listRuns({ limit: options.limit }),
        repository.listCandidates({ limit: options.limit }),
      ]);
      process.stdout.write(`${JSON.stringify({ runId: randomUUID(), status: "succeeded", steps: { report: "completed" }, counts: { sources: sources.length, runs: runs.length, candidates: candidates.length } })}\n`);
      return;
    }
    if (options.command === "article-daily") {
      const today = formatArticleNaturalDate();
      const mode = options.articleMode ?? "disabled";
      assertAutoPublishKillSwitch(mode);
      const reviewRequired = mode === "review-only" || mode === "auto-publish";
      let reviewProviders: (ReturnType<typeof createConfiguredArticleReviewProviders> & { revision?: ReturnType<typeof createConfiguredArticleRevisionProvider> }) | undefined;
      if (reviewRequired) {
        try {
          reviewProviders = createConfiguredArticleReviewProviders({
            provider: (process.env.CONTENT_ARTICLE_REVIEW_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax",
          });
        } catch (error) {
          throw new AcquireContentCliInputError(
            error instanceof Error
              ? error.message
              : "ARTICLE_REVIEW_PROVIDER_UNAVAILABLE",
          );
        }
        try {
          reviewProviders = {
            ...reviewProviders,
            revision: createConfiguredArticleRevisionProvider({
              provider: (process.env.CONTENT_ARTICLE_REVISION_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax",
            }),
          };
        } catch (error) {
          throw new AcquireContentCliInputError(
            error instanceof Error
              ? error.message
              : "ARTICLE_REVISION_PROVIDER_UNAVAILABLE",
          );
        }
      }
      const publishers = mode === "auto-publish"
        ? new CandidatePublisherRegistry([new AcquiredArticlePublisher(createDrizzleArticleRepository(connection.db))])
        : undefined;
      const result = await runDailyArticlePipeline({
        repository: repository as never,
        resolveAdapter: (source) => source.adapterType === "readlang-links"
          ? createReadlangLinksAdapterFromSource(source)
          : createArticleRssAdapterFromSource(source),
        reviewProviders,
        publishers,
      }, {
        date: today,
        mode,
        policyVersion: options.policyVersion ?? "",
        dailyLimit: options.dailyLimit ?? 50,
        defaultSourceLimit: options.sourceLimit ?? 10,
        reviewConcurrency: Number(process.env.CONTENT_ARTICLE_REVIEW_CONCURRENCY ?? 2),
      });
      const articlePartial = result.failures.length > 0 || result.changesRequested > 0 || result.rejected > 0 || result.skippedSources.length > 0;
      process.stdout.write(`${JSON.stringify({ runKey: result.runKey, status: articlePartial ? "partial" : "succeeded", mode: result.mode, counts: { discovered: result.discovered, inserted: result.inserted, duplicates: result.duplicates, conflicts: result.conflicts, prepared: result.prepared, reviewed: result.reviewed, approved: result.approved, changesRequested: result.changesRequested, rejected: result.rejected, published: result.published, skipped: result.skipped, skippedSources: result.skippedSources.length }, skippedSources: result.skippedSources, failures: result.failures })}\n`);
      return;
    }
    if (options.command === "media-daily") {
      const mediaMode = options.mediaMode ?? "disabled";
      assertMediaAutoPublishKillSwitch(mediaMode);
      const mediaReviewRequired = mediaMode === "review-only" || mediaMode === "auto-publish";
      let mediaReviewProviders: (ReturnType<typeof createConfiguredMediaReviewProviders> & { revision?: ReturnType<typeof createConfiguredMediaRevisionProvider> }) | undefined;
      if (mediaReviewRequired) {
        try {
          mediaReviewProviders = createConfiguredMediaReviewProviders({
            provider: (process.env.CONTENT_MEDIA_REVIEW_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax",
          });
        } catch (error) {
            throw new AcquireContentCliInputError(error instanceof Error ? error.message : "MEDIA_REVIEW_PROVIDER_UNAVAILABLE");
        }
        try {
          mediaReviewProviders = {
            ...mediaReviewProviders,
            revision: createConfiguredMediaRevisionProvider({
              provider: (process.env.CONTENT_MEDIA_REVISION_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax",
            }),
          };
        } catch (error) {
          throw new AcquireContentCliInputError(error instanceof Error ? error.message : "MEDIA_REVISION_PROVIDER_UNAVAILABLE");
        }
      }
      const result = await runDailyMediaPipeline({
        repository: repository as never,
        resolveAdapter: (source) => source.adapterType === "language-reactor"
          ? createLanguageReactorAdapterFromSource(source)
          : source.adapterType === "podcast-rss"
            ? createPodcastRssAdapterFromSource(source)
            : createYouTubeChannelAdapterFromSource(source),
        reviewProviders: mediaReviewProviders,
        publishers: mediaMode === "auto-publish" ? contentWorkflowPublishers : undefined,
      }, {
        mode: mediaMode,
        dailyLimit: options.mediaDailyLimit ?? 50,
        defaultSourceLimit: options.mediaSourceLimit ?? 10,
        reviewConcurrency: Number(process.env.CONTENT_MEDIA_REVIEW_CONCURRENCY ?? 2),
      });
       const mediaPartial = result.failures.length > 0 || result.changesRequested > 0 || result.rejected > 0 || result.skipped > 0 || result.skippedSources.length > 0;
       process.stdout.write(`${JSON.stringify({ runKey: result.runKey, status: mediaPartial ? "partial" : "succeeded", mode: result.mode, counts: { discovered: result.discovered, inserted: result.inserted, duplicates: result.duplicates, conflicts: result.conflicts, prepared: result.prepared, reviewReady: result.reviewReady, reviewed: result.reviewed, approved: result.approved, changesRequested: result.changesRequested, rejected: result.rejected, published: result.published, skipped: result.skipped, skippedSources: result.skippedSources.length }, skippedReasons: result.skippedReasons, skippedSources: result.skippedSources, failures: result.failures })}\n`);
      return;
    }
    if (options.command === "cleanup") {
      if (!repository.listCandidatesForCleanup || !repository.listCandidateArtifactsForCleanup || !repository.deleteCandidateArtifact || !repository.purgeCandidate) {
        throw new AcquireContentCliInputError("The configured repository does not support cleanup.");
      }
      const result = await runContentCleanup({
        repository: {
          listCandidatesForCleanup: repository.listCandidatesForCleanup,
          listCandidateArtifactsForCleanup: repository.listCandidateArtifactsForCleanup,
          deleteCandidateArtifact: repository.deleteCandidateArtifact,
          purgeCandidate: repository.purgeCandidate,
        },
        now: new Date(),
        largeArtifactThresholdBytes: Number(process.env.CONTENT_LARGE_ARTIFACT_THRESHOLD_BYTES ?? 1_000_000),
        limit: options.limit,
        dryRun: options.dryRun,
      });
      process.stdout.write(`${JSON.stringify({ runId: randomUUID(), status: "succeeded", steps: { cleanup: options.dryRun ? "skipped" : "completed" }, counts: { candidates: result.candidates, attemptedArtifacts: result.attemptedArtifacts, deletedArtifacts: result.deletedArtifacts, deferredArtifacts: result.deferredArtifacts, purgedCandidates: result.purgedCandidates } })}\n`);
      return;
    }
    if (options.command === "process") {
      const candidates = await repository.listCandidates({ limit: options.limit });
      let processed = 0;
      for (const candidate of candidates) {
        if (options.dryRun) continue;
        if (candidate.contentType === "article") await prepareArticleCandidateForReview(repository, candidate.id);
        else if (candidate.contentType === "podcast") await preparePodcastCandidateForReview(repository, candidate.id);
        else await prepareVideoCandidateForReview(repository, candidate.id);
        processed += 1;
      }
      process.stdout.write(`${JSON.stringify({ runId: randomUUID(), status: "succeeded", steps: { processing: options.dryRun ? "skipped" : "completed" }, counts: { candidates: candidates.length, processed } })}\n`);
      return;
    }
    let sources: ContentSourceRecord[];
    if (options.allEnabled) {
      const configuredSources = await repository.listSources();
      const plans = planContentPipelineSources({ sources: configuredSources, limit: options.limit });
      sources = plans.map((plan) => configuredSources.find((source) => source.stableKey === plan.sourceStableKey)).filter((source): source is ContentSourceRecord => Boolean(source));
    } else {
      const source = await repository.findSourceByStableKey(options.sourceStableKey);
      if (!source) throw new ContentSourceNotFoundError();
      sources = [source];
    }
    const outputLines: string[] = [];
    for (const source of sources) {
      if (!source.enabled) throw new ContentSourceDisabledError();
      const adapter = source.adapterType === "fake"
        ? await loadConfiguredFakeAdapter()
        : source.adapterType === "article-rss"
          ? createArticleRssAdapterFromSource(source)
          : source.adapterType === "readlang-links"
            ? createReadlangLinksAdapterFromSource(source)
          : source.adapterType === "podcast-rss"
            ? createPodcastRssAdapterFromSource(source)
            : source.adapterType === "youtube"
              ? createYouTubeChannelAdapterFromSource(source)
              : null;
      if (!adapter) throw new ContentAcquisitionRunError("No runtime adapter is available for this source type.");
      const sourceArgs = ["--source", source.stableKey, "--limit", String(options.limit), ...(options.dryRun ? ["--dry-run"] : [])];
      await runAcquireContentCli(sourceArgs, {
        repository,
        adapter,
        write: (line) => outputLines.push(line),
      });
    }
    for (const line of outputLines) process.stdout.write(`${line}\n`);
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
