import { readFile, writeFile } from "node:fs/promises";

class InputError extends Error {}

try {
  const args = parseArguments(process.argv.slice(2));
  const calibration = await readJson(args.calibration);
  const comparison = await readJson(args.comparison);
  const output = createDiagnosticReport(calibration, comparison);

  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    status: "completed",
    output: args.output,
    disposition: output.disposition,
    matchRatio: output.transcriptComparison.matchRatio,
    speechSignalQuality: output.speechSignal.quality,
  })}\n`);
} catch (error) {
  const message = error instanceof InputError
    ? error.message
    : "Local pronunciation diagnostic failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof InputError ? 2 : 1;
}

function parseArguments(argv: string[]): {
  calibration: string;
  comparison: string;
  output: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument?.startsWith("--")) throw new InputError("Diagnostic arguments are invalid.");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new InputError("Diagnostic arguments are incomplete.");
    values.set(argument.slice(2), value);
    index += 1;
  }

  const calibration = values.get("calibration");
  const comparison = values.get("comparison");
  const output = values.get("output");
  if (!calibration || !comparison || !output) {
    throw new InputError(
      "Usage: pnpm audio:calibration:local-diagnostic -- --calibration <report.json> --comparison <comparison.json> --output <diagnostic.json>",
    );
  }
  return { calibration, comparison, output };
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new InputError(`A local diagnostic input is unreadable: ${filePath}`);
  }
}

function createDiagnosticReport(
  calibration: unknown,
  comparison: unknown,
): {
  schemaVersion: "local-pronunciation-diagnostic-v1";
  disposition: "diagnostic-only";
  source: { type: string | null; fileName: string | null };
  transcriptReview: string;
  transcriptComparison: Record<string, unknown> & { matchRatio: number };
  speechSignal: {
    quality: string;
    durationMs: number;
    voicedRatio: number | null;
    pauseCount: number | null;
    pauseRatio: number | null;
    analyzer: string;
    algorithmVersion: string;
  };
} {
  if (!isRecord(calibration) || !isRecord(comparison)) {
    throw new InputError("Local diagnostic inputs must be JSON objects.");
  }
  const source = isRecord(calibration.source) ? calibration.source : {};
  const review = calibration.review;
  const signal = calibration.speechSignal;
  const comparisonValue = comparison.comparison;
  if (!isRecord(review) || typeof review.transcriptReview !== "string") {
    throw new InputError("The calibration report has no transcript review status.");
  }
  if (!isRecord(signal) || !isRecord(comparisonValue)) {
    throw new InputError("The local diagnostic inputs are missing speech signal or comparison data.");
  }
  if (typeof comparisonValue.matchRatio !== "number") {
    throw new InputError("The transcript comparison has no match ratio.");
  }

  const requiredSignalFields = [
    "quality",
    "durationMs",
    "voicedRatio",
    "pauseCount",
    "pauseRatio",
    "analyzer",
    "algorithmVersion",
  ] as const;
  for (const field of requiredSignalFields) {
    if (!(field in signal)) throw new InputError(`The speech signal is missing ${field}.`);
  }

  return {
    schemaVersion: "local-pronunciation-diagnostic-v1",
    disposition: "diagnostic-only",
    source: {
      type: typeof source.type === "string" ? source.type : null,
      fileName: typeof source.fileName === "string" ? source.fileName : null,
    },
    transcriptReview: review.transcriptReview,
    transcriptComparison: comparisonValue as Record<string, unknown> & { matchRatio: number },
    speechSignal: {
      quality: String(signal.quality),
      durationMs: Number(signal.durationMs),
      voicedRatio: toNullableNumber(signal.voicedRatio),
      pauseCount: toNullableNumber(signal.pauseCount),
      pauseRatio: toNullableNumber(signal.pauseRatio),
      analyzer: String(signal.analyzer),
      algorithmVersion: String(signal.algorithmVersion),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
