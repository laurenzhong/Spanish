import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { config as loadDotEnv } from "dotenv";

import {
  checkCalibrationReadiness,
  parseCalibrationAuthorization,
  parseReplayAudioManifest,
  runAnnotationCalibrationBatch,
  parseCalibrationBatchSnapshot,
  type CalibrationAudioAsset,
  type CalibrationBatchSnapshot,
} from "../src/modules/evidence/replay";
import { createMiniMaxAnnotationDraftProvider } from "../src/modules/providers/annotation/server";
import { createOpenAITranscriptionProvider } from "../src/modules/providers/stt/server";

type AudioFile = Readonly<{
  fullPath: string;
  format: ".mp3" | ".wav" | ".m4a" | ".webm" | ".ogg";
  sha256: string;
}>;

type Arguments = Readonly<{
  audioRoot: string;
  manifestPath: string;
  authorizationPath: string;
  outputPath: string;
  contentVersion: string;
  locale: "es-ES" | "es-MX";
  retryFailed: boolean;
  runId?: string;
}>;

const supportedExtensions = new Set<AudioFile["format"]>([
  ".mp3",
  ".wav",
  ".m4a",
  ".webm",
  ".ogg",
]);

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
  const message = error instanceof CalibrationInputError
    ? error.message
    : "Calibration input or execution failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof CalibrationInputError ? 2 : 1;
}

async function main(args: Arguments) {
  const manifest = parseReplayAudioManifest(await readJson(args.manifestPath));
  const authorization = parseCalibrationAuthorization(await readJson(args.authorizationPath));
  const readiness = checkCalibrationReadiness({ manifest, authorization });
  if (readiness.status === "blocked") {
    throw new CalibrationInputError(
      `Calibration gate blocked: ${readiness.reasons.map((reason) => reason.code).join(",")}`,
    );
  }

  const files = await scanAudioRoot(args.audioRoot);
  const filesByHash = new Map(files.map((file) => [file.sha256, file]));
  for (const entry of manifest.entries) {
    if (!filesByHash.has(entry.sha256)) {
      throw new CalibrationInputError("A manifest audio hash was not found in the audio root.");
    }
  }

  const existingSnapshot = await readExistingSnapshot(args.outputPath);
  const runId = args.runId ?? existingSnapshot?.runId ?? `calibration-v1-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (existingSnapshot && args.runId && existingSnapshot.runId !== args.runId) {
    throw new CalibrationInputError("The output snapshot belongs to a different run ID.");
  }

  const result = await runAnnotationCalibrationBatch({
    manifest,
    runId,
    contentVersion: args.contentVersion,
    locale: args.locale,
    retryFailed: args.retryFailed,
    existingSnapshot,
    readAudio: async (entry): Promise<CalibrationAudioAsset | null> => {
      const file = filesByHash.get(entry.sha256);
      if (!file) return null;
      const audioBytes = new Uint8Array(await readFile(file.fullPath));
      return {
        sha256: createHash("sha256").update(audioBytes).digest("hex"),
        sizeBytes: audioBytes.byteLength,
        format: file.format,
        audioBytes,
      };
    },
    transcriptionProvider: createOpenAITranscriptionProvider(),
    annotationProvider: createMiniMaxAnnotationDraftProvider(),
    writeSnapshot: (snapshot) => writeSnapshotAtomically(args.outputPath, snapshot),
  });
  return result;
}

async function scanAudioRoot(rootDirectory: string): Promise<AudioFile[]> {
  const root = await stat(rootDirectory).catch(() => {
    throw new CalibrationInputError("The audio root is not readable.");
  });
  if (!root.isDirectory()) throw new CalibrationInputError("The audio root is not a directory.");

  const paths: Array<{ fullPath: string; format: AudioFile["format"] }> = [];
  await collectAudioFiles(rootDirectory, paths);
  const files: AudioFile[] = [];
  const hashes = new Set<string>();
  for (const file of paths) {
    const bytes = await readFile(file.fullPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(sha256)) throw new CalibrationInputError("Duplicate audio content was found in the audio root.");
    hashes.add(sha256);
    files.push({ ...file, sha256 });
  }
  return files;
}

async function collectAudioFiles(
  directory: string,
  files: Array<{ fullPath: string; format: AudioFile["format"] }>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.endsWith(".downloading")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectAudioFiles(fullPath, files);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase() as AudioFile["format"];
    if (supportedExtensions.has(extension)) files.push({ fullPath, format: extension });
  }
}

async function readExistingSnapshot(outputPath: string): Promise<CalibrationBatchSnapshot | null> {
  try {
    return parseCalibrationBatchSnapshot(JSON.parse(await readFile(outputPath, "utf8")) as unknown);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new CalibrationInputError("The existing calibration output is invalid.");
  }
}

async function writeSnapshotAtomically(
  outputPath: string,
  snapshot: CalibrationBatchSnapshot,
): Promise<void> {
  const directory = path.dirname(outputPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new CalibrationInputError("A calibration input JSON file is unreadable.");
  }
}

function parseArguments(argv: string[]): Arguments {
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
  const audioRoot = values.get("audio-root");
  const manifestPath = values.get("manifest");
  const authorizationPath = values.get("authorization");
  const outputPath = values.get("output");
  if (!audioRoot || !manifestPath || !authorizationPath || !outputPath) {
    throw new CalibrationInputError(
      "Usage: pnpm audio:calibration:run -- --audio-root <dir> --manifest <file> --authorization <file> --output <file> [--retry-failed]",
    );
  }
  const locale = values.get("locale") ?? "es-ES";
  if (locale !== "es-ES" && locale !== "es-MX") throw new CalibrationInputError("Locale is invalid.");
  return {
    audioRoot,
    manifestPath,
    authorizationPath,
    outputPath,
    contentVersion: values.get("content-version") ?? "alpha-core-v1",
    locale,
    retryFailed,
    runId: values.get("run-id"),
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
