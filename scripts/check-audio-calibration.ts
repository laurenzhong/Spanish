import { readFile } from "node:fs/promises";

import {
  checkCalibrationReadinessFromUnknown,
  defaultCalibrationMaxSamples,
} from "../src/modules/evidence/replay";

const positionalArguments = process.argv.slice(2).filter(
  (argument) => !argument.startsWith("--"),
);
const maxSamplesFlagIndex = process.argv.indexOf("--max-samples");
const maxSamplesValue =
  maxSamplesFlagIndex === -1
    ? defaultCalibrationMaxSamples
    : Number(process.argv[maxSamplesFlagIndex + 1]);

if (positionalArguments.length !== 2) {
  throw new Error(
    "Usage: pnpm audio:calibration:check -- <manifest.json> <authorization.json> [--max-samples N]",
  );
}

const [manifestPath, authorizationPath] = positionalArguments;
try {
  const manifest = await readJson(manifestPath);
  let authorization: unknown;
  try {
    authorization = await readJson(authorizationPath);
  } catch {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "blocked",
          reasons: [{ code: "authorization-record-missing" }],
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
    process.exit();
  }
  const result = checkCalibrationReadinessFromUnknown({
    manifest,
    authorization,
    maxSamples: maxSamplesValue,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "blocked") process.exitCode = 1;
} catch {
  process.stderr.write("Calibration preflight input is invalid.\n");
  process.exitCode = 2;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new Error("Unable to read calibration preflight input.");
  }
}
