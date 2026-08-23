import { readFile, writeFile } from "node:fs/promises";

import { compareTranscripts } from "../src/modules/providers/stt";

class InputError extends Error {}

try {
  const args = parseArguments(process.argv.slice(2));
  const input = await readReport(args.input);
  const comparison = compareTranscripts(input.review.confirmedTranscript, input.transcription.transcript);
  const output = {
    schemaVersion: "local-video-transcript-comparison-v1",
    source: {
      type: input.source?.type ?? null,
      fileName: input.source?.fileName ?? null,
    },
    transcription: {
      provider: input.transcription.provider ?? null,
      modelVersion: input.transcription.modelVersion ?? null,
    },
    reference: {
      reviewStatus: input.review.transcriptReview,
      tokenCount: comparison.expectedTokenCount,
    },
    actual: {
      tokenCount: comparison.actualTokenCount,
    },
    comparison,
  };

  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    status: "completed",
    output: args.output,
    expectedTokenCount: comparison.expectedTokenCount,
    actualTokenCount: comparison.actualTokenCount,
    matchRatio: comparison.matchRatio,
    differences: comparison.differences.length,
  })}\n`);
} catch (error) {
  const message = error instanceof InputError
    ? error.message
    : "Local transcript comparison failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof InputError ? 2 : 1;
}

function parseArguments(argv: string[]): { input: string; output: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument?.startsWith("--")) throw new InputError("Comparison arguments are invalid.");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new InputError("Comparison arguments are incomplete.");
    values.set(argument.slice(2), value);
    index += 1;
  }
  const input = values.get("input");
  const output = values.get("output");
  if (!input || !output) {
    throw new InputError(
      "Usage: pnpm audio:calibration:compare -- --input <report.json> --output <comparison.json>",
    );
  }
  return { input, output };
}

async function readReport(filePath: string): Promise<{
  source: { type?: unknown; fileName?: unknown };
  transcription: { provider: string | null; modelVersion: string | null; transcript: string };
  review: { transcriptReview: string; confirmedTranscript: string };
}> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new InputError("The local calibration report is unreadable.");
  }

  if (!isRecord(value) || !isRecord(value.review) || !isRecord(value.transcription)) {
    throw new InputError("The local calibration report has an invalid shape.");
  }
  const review = value.review;
  const transcription = value.transcription;
  if (
    typeof review.transcriptReview !== "string" ||
    typeof review.confirmedTranscript !== "string" ||
    typeof transcription.transcript !== "string"
  ) {
    throw new InputError("The report must contain a confirmed transcript and a local transcript.");
  }

  return {
    source: isRecord(value.source)
      ? { type: value.source.type, fileName: value.source.fileName }
      : {},
    transcription: {
      provider: typeof transcription.provider === "string" ? transcription.provider : null,
      modelVersion: typeof transcription.modelVersion === "string" ? transcription.modelVersion : null,
      transcript: transcription.transcript,
    },
    review: {
      transcriptReview: review.transcriptReview,
      confirmedTranscript: review.confirmedTranscript,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
