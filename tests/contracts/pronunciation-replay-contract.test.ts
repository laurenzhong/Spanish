// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parsePronunciationReplayManifest,
  parsePronunciationReplaySample,
} from "@/src/modules/evidence/replay";

const fixtureDirectory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "evaluation",
  "pronunciation-v1",
);

async function readJson(fileName: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(fixtureDirectory, fileName), "utf8"),
  ) as unknown;
}

describe("pronunciation replay set v1", () => {
  it("validates the manifest and every listed synthetic sample", async () => {
    const manifest = parsePronunciationReplayManifest(
      await readJson("manifest.json"),
    );
    const samples = await Promise.all(
      manifest.samples.map(async (entry) => ({
        entry,
        sample: parsePronunciationReplaySample(await readJson(entry.file)),
      })),
    );

    expect(samples).toHaveLength(11);
    expect(new Set(manifest.samples.map((entry) => entry.file)).size).toBe(
      manifest.samples.length,
    );
    expect(new Set(samples.map(({ sample }) => sample.sampleId)).size).toBe(
      samples.length,
    );
    expect(new Set(samples.map(({ sample }) => sample.locale))).toEqual(
      new Set(["es-ES", "es-MX"]),
    );
    expect(new Set(samples.map(({ entry }) => entry.category))).toEqual(
      new Set([
        "clear",
        "natural-alternative",
        "phoneme-error",
        "pausing",
        "noise",
        "silence",
        "technical-failure",
        "low-confidence",
        "truncated",
      ]),
    );
    for (const { entry, sample } of samples) {
      expect(sample.sampleId).toBe(entry.sampleId);
      expect(sample.locale).toBe(entry.locale);
      expect(sample.annotation.status).toBe("pending");
      expect(sample.annotation.reviewerId).toBeNull();
      expect(sample.annotation.reviewedAt).toBeNull();
    }
  });

  it("keeps failure and insufficient cases free of score claims and skill updates", async () => {
    const manifest = parsePronunciationReplayManifest(
      await readJson("manifest.json"),
    );
    for (const entry of manifest.samples) {
      const sample = parsePronunciationReplaySample(await readJson(entry.file));
      if (sample.expectation.evidenceDisposition !== "candidate") {
        expect(sample.expectation.pronunciationScoreRange).toBeNull();
        expect(sample.expectation.fluencyScoreRange).toBeNull();
        expect(sample.expectation.skillsToUpdate).toEqual([]);
      }
    }
  });

  it("rejects provider-shaped or private-data fields", async () => {
    const sample = await readJson("clear-es-es.json");
    const polluted = {
      ...(sample as Record<string, unknown>),
      transcript: "provider transcript must not be stored",
      providerResponse: { speech_score: { pronunciation: 95 } },
      audioBytes: [1, 2, 3],
    };

    expect(() => parsePronunciationReplaySample(polluted)).toThrow();
    expect(JSON.stringify(polluted)).toContain("provider transcript");
  });

  it("rejects score claims for insufficient and failed samples", async () => {
    const sample = await readJson("silence-es-es.json");
    const invalid = structuredClone(sample) as {
      expectation: { pronunciationScoreRange: unknown };
    };
    invalid.expectation.pronunciationScoreRange = { min: 0, max: 0.4 };

    expect(() => parsePronunciationReplaySample(invalid)).toThrow();
  });
});
