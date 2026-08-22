import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

import { config as loadDotEnv } from "dotenv";

import {
  checkCalibrationReadiness,
  localTranscriptSnapshotSchema,
  parseCalibrationAuthorization,
  parseCalibrationBatchSnapshot,
  parseReplayAudioManifest,
  runAnnotationCalibrationBatch,
  type CalibrationBatchSnapshot,
} from "../src/modules/evidence/replay";
import { createMiniMaxAnnotationDraftProvider } from "../src/modules/providers/annotation/server";
import type { TranscriptResult } from "../src/modules/providers/stt/transcription";

loadDotEnv();

class CalibrationInputError extends Error {}

try {
  const args = parseArguments(process.argv.slice(2));
  const result = await main(args);
  process.stdout.write(
    `${JSON.stringify({
      status: result.status,
      runId: result.runId,
      completed: result.snapshot.samples.filter((sample) => sample.status === "completed").length,
      failed: result.snapshot.samples.filter((sample) => sample.status === "failed").length,
      skipped: result.samples.filter((sample) => sample.status === "skipped").length,
    })}\n`,
  );
  process.exitCode = result.status === "completed" ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `${error instanceof CalibrationInputError ? error.message : "Local annotation input or execution failed."}\n`,
  );
  process.exitCode = error instanceof CalibrationInputError ? 2 : 1;
}

async function main(args: Readonly<{
  manifestPath: string;
  authorizationPath: string;
  transcriptPath: string;
  outputPath: string;
  contentVersion: string;
  locale: "es-ES" | "es-MX";
  retryFailed: boolean;
}>) {
  const manifest = parseReplayAudioManifest(await readJson(args.manifestPath));
  const authorization = parseCalibrationAuthorization(await readJson(args.authorizationPath));
  const readiness = checkCalibrationReadiness({ manifest, authorization });
  if (readiness.status === "blocked") {
    throw new CalibrationInputError(
      `Calibration gate blocked: ${readiness.reasons.map((reason) => reason.code).join(",")}`,
    );
  }

  const transcriptSnapshot = localTranscriptSnapshotSchema.parse(
    await readJson(args.transcriptPath),
  );
  const transcriptBySampleId = new Map(
    transcriptSnapshot.samples
      .filter((sample) => sample.status === "completed")
      .map((sample) => [sample.sampleId, sample]),
  );
  const existingSnapshot = await readExistingSnapshot(args.outputPath);
  const runId = existingSnapshot?.runId ?? `local-annotation-${transcriptSnapshot.runId}`;

  const result = await runAnnotationCalibrationBatch({
    manifest,
    runId,
    contentVersion: args.contentVersion,
    locale: args.locale,
    retryFailed: args.retryFailed,
    existingSnapshot,
    readTranscript: async (entry): Promise<TranscriptResult | null> => {
      const transcript = transcriptBySampleId.get(entry.sampleId);
      if (!transcript) return null;
      return {
        text: transcript.transcript,
        detectedLanguages: [transcript.language],
        confidence: null,
        confidenceAvailability: "unavailable",
        provider: "local-whisper",
        modelVersion: transcript.modelVersion,
        providerRequestId: null,
        latencyMs: transcript.latencyMs,
        estimatedCostMicros: 0,
        retentionPolicy: "ephemeral",
      };
    },
    annotationProvider: createMiniMaxAnnotationDraftProvider(),
    writeSnapshot: (snapshot) => writeSnapshotAtomically(args.outputPath, snapshot),
  });
  return result;
}

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  let retryFailed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--retry-failed") {
      retryFailed = true;
      continue;
    }
    if (!argument?.startsWith("--")) throw new CalibrationInputError("Calibration arguments are invalid.");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new CalibrationInputError("Calibration arguments are incomplete.");
    values.set(argument.slice(2), value);
    index += 1;
  }
  const manifestPath = values.get("manifest");
  const authorizationPath = values.get("authorization");
  const transcriptPath = values.get("transcripts");
  const outputPath = values.get("output");
  if (!manifestPath || !authorizationPath || !transcriptPath || !outputPath) {
    throw new CalibrationInputError(
      "Usage: pnpm audio:calibration:local-annotate -- --manifest <file> --authorization <file> --transcripts <file> --output <file>",
    );
  }
  const locale = values.get("locale") ?? "es-ES";
  if (locale !== "es-ES" && locale !== "es-MX") throw new CalibrationInputError("Locale is invalid.");
  return {
    manifestPath,
    authorizationPath,
    transcriptPath,
    outputPath,
    contentVersion: values.get("content-version") ?? "alpha-core-v1",
    locale,
    retryFailed,
  } as const;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new CalibrationInputError("A calibration input JSON file is unreadable.");
  }
}

async function readExistingSnapshot(outputPath: string): Promise<CalibrationBatchSnapshot | null> {
  try {
    return parseCalibrationBatchSnapshot(JSON.parse(await readFile(outputPath, "utf8")) as unknown);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      return null;
    }
    throw new CalibrationInputError("The existing local annotation output is invalid.");
  }
}

async function writeSnapshotAtomically(outputPath: string, snapshot: CalibrationBatchSnapshot): Promise<void> {
  const directory = path.dirname(outputPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
}
