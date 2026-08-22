import { createReplayAudioManifest } from "../src/modules/evidence/replay";

const rootDirectory = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!rootDirectory) {
  throw new Error(
    "Usage: pnpm audio:manifest -- <external-audio-directory> [--authorization-confirmed]",
  );
}

const manifest = await createReplayAudioManifest({
  rootDirectory,
  authorizationStatus: process.argv.includes("--authorization-confirmed")
    ? "confirmed"
    : "pending",
});

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
