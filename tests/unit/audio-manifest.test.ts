import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createReplayAudioManifest } from "@/src/modules/evidence/replay";

describe("createReplayAudioManifest", () => {
  it("hashes supported files, skips incomplete downloads, and omits paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "speech-replay-"));
    try {
      await mkdir(path.join(root, "nested"));
      await writeFile(path.join(root, "clear.mp3"), Buffer.from([1, 2, 3]));
      await writeFile(path.join(root, "nested", "pause.wav"), Buffer.from([4, 5]));
      await writeFile(path.join(root, "ignore.wma"), Buffer.from([6]));
      await writeFile(path.join(root, "partial.mp3.downloading"), Buffer.from([7]));

      const manifest = await createReplayAudioManifest({
        rootDirectory: root,
        authorizationStatus: "confirmed",
        now: () => "2026-08-22T00:00:00.000Z",
      });

      expect(manifest).toMatchObject({
        schemaVersion: "1.0",
        generatedAt: "2026-08-22T00:00:00.000Z",
        dryRun: true,
      });
      expect(manifest.entries).toHaveLength(2);
      expect(manifest.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            format: ".mp3",
            sizeBytes: 3,
            durationMs: null,
            authorizationStatus: "confirmed",
          }),
          expect.objectContaining({
            format: ".wav",
            sizeBytes: 2,
            durationMs: null,
          }),
        ]),
      );
      expect(JSON.stringify(manifest)).not.toContain(root);
      expect(manifest.entries.every((entry) => /^audio\.[a-f0-9]{16}$/.test(entry.sampleId))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
