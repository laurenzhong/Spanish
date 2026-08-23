import { readFile, writeFile } from "node:fs/promises";

type DiagnosticReport = {
  schemaVersion: "local-pronunciation-diagnostic-v1";
  disposition: "diagnostic-only";
  source: { fileName: string | null };
  transcriptComparison: {
    expectedTokenCount: number;
    actualTokenCount: number;
    matchedTokenCount: number;
    matchRatio: number;
    summary: {
      substitutionCount: number;
      omissionCount: number;
      additionCount: number;
      possibleLanguageMismatchCount: number;
    };
    differences: Array<{
      expectedText: string;
      actualText: string;
      classification: string;
    }>;
  };
  speechSignal: {
    quality: string;
    voicedRatio: number | null;
    pauseCount: number | null;
    pauseRatio: number | null;
  };
};

type SampleSummary = {
  fileName: string | null;
  matchRatio: number;
  expectedTokenCount: number;
  actualTokenCount: number;
  differenceCount: number;
  summary: DiagnosticReport["transcriptComparison"]["summary"];
  speechSignal: DiagnosticReport["speechSignal"];
};

try {
  const args = parseArguments(process.argv.slice(2));
  const reports = await Promise.all(args.inputs.map(readDiagnostic));
  const summary = createSummary(reports);
  await writeFile(args.output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    status: "completed",
    output: args.output,
    sampleCount: summary.sampleCount,
    averageMatchRatio: summary.matchRatio.average,
    topMismatchCount: summary.commonMismatches.length,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Local diagnostic aggregation failed."}\n`);
  process.exitCode = 2;
}

function parseArguments(argv: string[]): { inputs: string[]; output: string } {
  const inputs: string[] = [];
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--input") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Diagnostic input path is missing.");
      inputs.push(value);
      index += 1;
      continue;
    }
    if (argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Diagnostic output path is missing.");
      output = value;
      index += 1;
      continue;
    }
    throw new Error("Diagnostic aggregation arguments are invalid.");
  }
  if (inputs.length === 0 || !output) {
    throw new Error(
      "Usage: pnpm audio:calibration:aggregate -- --input <diagnostic.json> [--input <diagnostic.json> ...] --output <summary.json>",
    );
  }
  return { inputs, output };
}

async function readDiagnostic(filePath: string): Promise<DiagnosticReport> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new Error(`Diagnostic report is unreadable: ${filePath}`);
  }
  if (!isRecord(value) || value.schemaVersion !== "local-pronunciation-diagnostic-v1" || value.disposition !== "diagnostic-only") {
    throw new Error(`Diagnostic report is invalid: ${filePath}`);
  }
  if (!isRecord(value.source) || !isRecord(value.transcriptComparison) || !isRecord(value.speechSignal)) {
    throw new Error(`Diagnostic report is incomplete: ${filePath}`);
  }
  return value as unknown as DiagnosticReport;
}

function createSummary(reports: DiagnosticReport[]) {
  const samples: SampleSummary[] = reports.map((report) => ({
    fileName: report.source.fileName,
    matchRatio: report.transcriptComparison.matchRatio,
    expectedTokenCount: report.transcriptComparison.expectedTokenCount,
    actualTokenCount: report.transcriptComparison.actualTokenCount,
    differenceCount: report.transcriptComparison.differences.length,
    summary: report.transcriptComparison.summary,
    speechSignal: report.speechSignal,
  }));
  const ratios = samples.map((sample) => sample.matchRatio);
  const totalSummary = samples.reduce(
    (total, sample) => ({
      substitutionCount: total.substitutionCount + sample.summary.substitutionCount,
      omissionCount: total.omissionCount + sample.summary.omissionCount,
      additionCount: total.additionCount + sample.summary.additionCount,
      possibleLanguageMismatchCount: total.possibleLanguageMismatchCount + sample.summary.possibleLanguageMismatchCount,
    }),
    { substitutionCount: 0, omissionCount: 0, additionCount: 0, possibleLanguageMismatchCount: 0 },
  );
  const mismatchCounts = new Map<string, { expectedText: string; actualText: string; count: number; classification: string }>();
  for (const report of reports) {
    for (const difference of report.transcriptComparison.differences) {
      const key = `${difference.expectedText}\u0000${difference.actualText}`;
      const current = mismatchCounts.get(key);
      mismatchCounts.set(key, current
        ? { ...current, count: current.count + 1 }
        : { ...difference, count: 1 });
    }
  }

  return {
    schemaVersion: "local-pronunciation-calibration-summary-v1",
    disposition: "diagnostic-only",
    sampleCount: samples.length,
    matchRatio: {
      average: round(average(ratios)),
      minimum: round(Math.min(...ratios)),
      maximum: round(Math.max(...ratios)),
    },
    transcriptDifferences: totalSummary,
    commonMismatches: [...mismatchCounts.values()]
      .sort((left, right) => right.count - left.count || left.expectedText.localeCompare(right.expectedText))
      .slice(0, 20),
    samples,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
