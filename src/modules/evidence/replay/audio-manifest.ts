import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const replayAudioExtensions = [
  ".mp3",
  ".wav",
  ".m4a",
  ".webm",
  ".ogg",
] as const;

export type ReplayAudioManifestEntry = Readonly<{
  sampleId: string;
  sha256: string;
  format: (typeof replayAudioExtensions)[number];
  sizeBytes: number;
  durationMs: number | null;
  sourceType: "external-audio";
  authorizationStatus: "confirmed" | "pending";
}>;

export type ReplayAudioManifest = Readonly<{
  schemaVersion: "1.0";
  generatedAt: string;
  dryRun: true;
  entries: readonly ReplayAudioManifestEntry[];
}>;

export type CreateReplayAudioManifestOptions = Readonly<{
  rootDirectory: string;
  authorizationStatus?: "confirmed" | "pending";
  now?: () => string;
}>;

export async function createReplayAudioManifest(
  options: CreateReplayAudioManifestOptions,
): Promise<ReplayAudioManifest> {
  const files = await collectAudioFiles(options.rootDirectory);
  const entries: ReplayAudioManifestEntry[] = [];

  for (const file of files) {
    const bytes = await readFile(file.fullPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    entries.push({
      sampleId: `audio.${sha256.slice(0, 16)}`,
      sha256,
      format: file.format,
      sizeBytes: bytes.byteLength,
      durationMs: null,
      sourceType: "external-audio",
      authorizationStatus: options.authorizationStatus ?? "pending",
    });
  }

  return {
    schemaVersion: "1.0",
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
    dryRun: true,
    entries,
  };
}

type CollectedAudioFile = Readonly<{
  fullPath: string;
  format: (typeof replayAudioExtensions)[number];
}>;

async function collectAudioFiles(rootDirectory: string): Promise<CollectedAudioFile[]> {
  const directory = await stat(rootDirectory);
  if (!directory.isDirectory()) {
    throw new Error("Replay audio root must be a directory.");
  }

  const files: CollectedAudioFile[] = [];
  await visitDirectory(rootDirectory, files);
  return files.sort((left, right) => left.fullPath.localeCompare(right.fullPath));
}

async function visitDirectory(
  directory: string,
  files: CollectedAudioFile[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.endsWith(".downloading")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visitDirectory(fullPath, files);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (isReplayAudioExtension(extension)) {
      files.push({
        fullPath,
        format: extension,
      });
    }
  }
}

function isReplayAudioExtension(
  extension: string,
): extension is (typeof replayAudioExtensions)[number] {
  return (replayAudioExtensions as readonly string[]).includes(extension);
}
