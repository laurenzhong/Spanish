import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evaluateReleaseCandidateGate, releaseCandidateCheckNames, type ReleaseCandidateGateInput } from "../src/modules/release-candidate";

export class ReleaseCandidateInputError extends Error {
  readonly code = "RELEASE_CANDIDATE_INPUT_INVALID" as const;
}

function parseArgs(args: readonly string[]): string {
  const normalizedArgs = args.filter((argument) => argument !== "--");
  const inputIndex = normalizedArgs.indexOf("--input");
  const inputPath = inputIndex >= 0 ? normalizedArgs[inputIndex + 1] : undefined;
  if (!inputPath || inputPath.startsWith("--")) throw new ReleaseCandidateInputError("--input requires a JSON report path.");
  if (normalizedArgs.some((argument, index) => argument !== "--input" && index !== inputIndex + 1)) {
    throw new ReleaseCandidateInputError("Only --input is supported.");
  }
  return inputPath;
}

function parseReport(value: unknown): ReleaseCandidateGateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReleaseCandidateInputError("Input must be a JSON object.");
  const input = value as Record<string, unknown>;
  const checksValue = input.checks;
  if (!checksValue || typeof checksValue !== "object" || Array.isArray(checksValue)) throw new ReleaseCandidateInputError("checks must be an object.");
  const checks: Record<string, unknown> = checksValue as Record<string, unknown>;
  for (const key of Object.keys(checks)) {
    if (!(releaseCandidateCheckNames as readonly string[]).includes(key)) throw new ReleaseCandidateInputError(`Unknown check: ${key}.`);
  }
  const openP0 = input.openP0;
  const openP1 = input.openP1;
  const productConfirmed = input.productConfirmed;
  if (!Number.isSafeInteger(openP0) || typeof openP0 !== "number" || openP0 < 0) throw new ReleaseCandidateInputError("openP0 must be a non-negative integer.");
  if (!Number.isSafeInteger(openP1) || typeof openP1 !== "number" || openP1 < 0) throw new ReleaseCandidateInputError("openP1 must be a non-negative integer.");
  if (typeof productConfirmed !== "boolean") throw new ReleaseCandidateInputError("productConfirmed must be boolean.");
  return { checks: checks as ReleaseCandidateGateInput["checks"], openP0, openP1, productConfirmed };
}

export async function runReleaseCandidateCheck(args: readonly string[], write: (line: string) => void): Promise<boolean> {
  const inputPath = parseArgs(args);
  const report = parseReport(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
  const result = evaluateReleaseCandidateGate(report);
  write(JSON.stringify({ status: result.eligible ? "eligible" : "blocked", ...result }));
  return result.eligible;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runReleaseCandidateCheck(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`))
    .then((eligible) => { process.exitCode = eligible ? 0 : 1; })
    .catch((error: unknown) => {
      const code = error instanceof ReleaseCandidateInputError ? error.code : "RELEASE_CANDIDATE_CHECK_FAILED";
      const message = error instanceof Error ? error.message : "Release candidate check failed.";
      process.stderr.write(`${JSON.stringify({ code, message })}\n`);
      process.exitCode = 2;
    });
}
