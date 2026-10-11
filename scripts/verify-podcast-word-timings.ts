import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Verifies that a chunked word-level timeline lands on the source asset's clock.
 *
 * The provider re-encodes anything longer than its own per-request limit into
 * numbered parts and times each part from that part's start, so every part after
 * the first must be shifted by (part index x chunk length). Nothing about that is
 * visible in a normal transcript, and getting it wrong shifts every word after
 * the first seam without failing anything, so this checks the seam directly.
 *
 * Default mode is local and free: it probes the asset and writes the parts, then
 * reports the offsets it would apply. `--live` additionally sends each part to
 * the provider for word-level timestamps and asserts the joined timeline is
 * ordered across every seam and reaches the end of the audio. That mode costs
 * money, so it never runs by default.
 *
 * Run:
 *   tsx scripts/verify-podcast-word-timings.ts --audio <file.mp3>
 *   tsx scripts/verify-podcast-word-timings.ts --audio <file.mp3> --live
 *
 * Keep CHUNK_SECONDS and the offset formula in sync with
 * `chunkDurationSeconds` / `chunkOffsetMs` in
 * `src/modules/providers/stt/minimax-transcription.ts`. They are duplicated
 * because that module is `server-only` and cannot be imported from a plain Node
 * script; if the provider changes, change this too.
 */

const CHUNK_SECONDS = 450;
/** The provider's own per-request limit; audio at or below it is never chunked. */
const MAX_REQUEST_MS = 500_000;
/** Largest gap between adjacent words considered continuous across a seam. */
const MAX_SEAM_GAP_MS = 3_000;
/** A timeline is expected to reach near the end of the audio. */
const MIN_TAIL_COVERAGE = 0.9;
const DEFAULT_ENDPOINT = "https://api.minimax.cn/v1/speech_to_text";
const PROVIDER_MODEL = "asr-1.0";

export class VerifyWordTimingsInputError extends Error {}

export type VerifyWordTimingsOptions = Readonly<{
  audioPath: string;
  live: boolean;
  keepParts: boolean;
}>;

export function parseVerifyWordTimingsArguments(args: readonly string[]): VerifyWordTimingsOptions {
  let audioPath: string | null = null;
  let live = false;
  let keepParts = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--audio") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new VerifyWordTimingsInputError("--audio requires a file path.");
      if (audioPath !== null) throw new VerifyWordTimingsInputError("--audio may only be provided once.");
      audioPath = value;
      index += 1;
      continue;
    }
    if (argument === "--live") { live = true; continue; }
    if (argument === "--keep-parts") { keepParts = true; continue; }
    throw new VerifyWordTimingsInputError(`Unknown argument: ${argument}`);
  }
  if (audioPath === null) throw new VerifyWordTimingsInputError("--audio is required.");
  return { audioPath, live, keepParts };
}

type PartWord = Readonly<{ startMs: number; endMs: number }>;

type PartResult = Readonly<{
  name: string;
  offsetMs: number;
  wordCount: number;
  firstStartMs: number | null;
  lastEndMs: number | null;
  orderedWithinPart: boolean;
  words: readonly PartWord[];
}>;

type Part = Readonly<{ name: string; path: string }>;

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => reject(new Error(`${command} could not be started.`)));
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`))));
  });
}

async function probeSeconds(filePath: string): Promise<number> {
  const child = spawn(process.env.FFPROBE_BIN?.trim() || "ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { windowsHide: true });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  if (code !== 0) throw new Error("ffprobe could not read the audio duration.");
  const seconds = Number(Buffer.concat(chunks).toString("utf8").trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("ffprobe returned no usable duration.");
  return seconds;
}

async function writeParts(audioPath: string, directory: string): Promise<Part[]> {
  await run(process.env.FFMPEG_BIN?.trim() || "ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", audioPath,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1",
    path.join(directory, "chunk-%03d.mp3"),
  ]);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".mp3")).sort();
  if (names.length === 0) throw new Error("Chunking produced no audio parts.");
  return names.map((name) => ({ name, path: path.join(directory, name) }));
}

/** The provider's `chunkOffsetMs`: part index times the chunk length. */
function offsetForPart(name: string): number {
  const index = /-(\d+)\.[a-z0-9]+$/iu.exec(name)?.[1];
  if (!index) throw new Error(`Unexpected part name: ${name}`);
  return Number(index) * CHUNK_SECONDS * 1_000;
}

async function collectPart(
  part: Part,
  endpoint: string,
  apiKey: string,
): Promise<PartResult> {
  const bytes = await readFile(part.path);
  const audioBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(audioBuffer).set(bytes);
  const form = new FormData();
  form.append("model", PROVIDER_MODEL);
  form.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), part.name);
  form.append("response_format", "verbose_json");
  form.append("timestamp_level", "word");
  form.append("stream", "false");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${part.name} was rejected with ${response.status}: ${detail.slice(0, 300)}`);
  }
  const payload = await response.json() as { segments?: readonly { start: number; end: number }[] };
  const units = Array.isArray(payload.segments) ? payload.segments : [];
  const offsetMs = offsetForPart(part.name);
  const words = units.map((unit) => ({
    startMs: Math.round(unit.start * 1_000) + offsetMs,
    endMs: Math.round(unit.end * 1_000) + offsetMs,
  }));
  return {
    name: part.name,
    offsetMs,
    wordCount: words.length,
    firstStartMs: words[0]?.startMs ?? null,
    lastEndMs: words.at(-1)?.endMs ?? null,
    orderedWithinPart: words.every((word, index) => index === 0 || word.startMs >= words[index - 1].startMs),
    words,
  };
}

async function main(): Promise<void> {
  const options = parseVerifyWordTimingsArguments(process.argv.slice(2));
  const info = await stat(options.audioPath);
  if (!info.isFile()) throw new VerifyWordTimingsInputError(`${options.audioPath} is not a file.`);
  const seconds = await probeSeconds(options.audioPath);
  const durationMs = Math.round(seconds * 1_000);
  const expectedParts = Math.ceil(durationMs / (CHUNK_SECONDS * 1_000));
  console.log(`audio: ${options.audioPath}`);
  console.log(`duration: ${seconds.toFixed(3)}s (${durationMs} ms)`);
  console.log(`per-request limit: ${MAX_REQUEST_MS} ms; expected parts: ${expectedParts}`);

  if (durationMs <= MAX_REQUEST_MS) {
    throw new VerifyWordTimingsInputError(
      "Audio is not longer than the provider's per-request limit, so it would never be chunked. Provide a longer file.",
    );
  }

  const directory = await mkdtemp(path.join(tmpdir(), "verify-word-timings-"));
  const parts = await writeParts(options.audioPath, directory);
  try {
    console.log(`parts: ${parts.map((part) => part.name).join(", ")}`);
    for (const part of parts) {
      const partInfo = await stat(part.path);
      console.log(`  ${part.name}: ${Math.round(partInfo.size / 1024)} KB, offset ${offsetForPart(part.name)} ms`);
    }
    if (!options.live) {
      console.log("local check passed. Re-run with --live to request word-level timings and check the seams (this costs money).");
      return;
    }

    const apiKey = process.env.MINIMAX_API_KEY?.trim();
    if (!apiKey) throw new VerifyWordTimingsInputError("MINIMAX_API_KEY is required with --live.");
    const endpoint = process.env.MINIMAX_TRANSCRIPTION_API_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
    console.log(`endpoint: ${endpoint}`);

    const results: PartResult[] = [];
    for (const part of parts) {
      const result = await collectPart(part, endpoint, apiKey);
      results.push(result);
      console.log(`  ${result.name}: ${result.wordCount} words, ${result.firstStartMs} -> ${result.lastEndMs} ms (offset applied)`);
      if (!result.orderedWithinPart) throw new Error(`${result.name} returned words that are not ordered.`);
    }

    for (let index = 1; index < results.length; index += 1) {
      const previous = results[index - 1]!;
      const current = results[index]!;
      const gap = (current.firstStartMs ?? 0) - (previous.lastEndMs ?? 0);
      console.log(`seam ${previous.name} -> ${current.name}: gap ${gap} ms`);
      if (gap < 0) throw new Error(`Seam ${index} overlaps; the offset is too large.`);
      if (gap > MAX_SEAM_GAP_MS) throw new Error(`Seam ${index} has a ${gap} ms hole; the offset is too small.`);
    }

    const coverage = (results.at(-1)?.lastEndMs ?? 0) / durationMs;
    console.log(`tail coverage: ${(coverage * 100).toFixed(1)}% of the audio`);
    if (coverage < MIN_TAIL_COVERAGE) throw new Error("The joined timeline stops well before the end of the audio.");
    console.log("live check passed: word timings are continuous across every seam.");
  } finally {
    if (options.keepParts) console.log(`parts kept in ${directory}`);
    else await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
