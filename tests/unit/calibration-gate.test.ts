import { describe, expect, it } from "vitest";

import {
  checkCalibrationReadiness,
  checkCalibrationReadinessFromUnknown,
  parseCalibrationAuthorization,
  parseReplayAudioManifest,
  type CalibrationAuthorization,
  type ReplayAudioManifest,
} from "@/src/modules/evidence/replay";

const authorization: CalibrationAuthorization = {
  schemaVersion: "1.0",
  recordId: "permit-2026-08-22",
  sourceLicense: {
    status: "confirmed",
    reference: "license-record-001",
  },
  thirdPartyProcessing: {
    status: "confirmed",
    reference: "processing-record-001",
  },
};

const manifest: ReplayAudioManifest = {
  schemaVersion: "1.0",
  generatedAt: "2026-08-22T00:00:00.000Z",
  dryRun: true,
  entries: [
    {
      sampleId: "audio.1111111111111111",
      sha256: "1".repeat(64),
      format: ".mp3",
      sizeBytes: 100,
      durationMs: null,
      sourceType: "external-audio",
      authorizationStatus: "confirmed",
    },
  ],
};

describe("calibration preflight gate", () => {
  it("allows a small batch only with both authorization confirmations", () => {
    expect(checkCalibrationReadiness({ manifest, authorization })).toEqual({
      status: "ready",
      sampleCount: 1,
      sampleIds: ["audio.1111111111111111"],
      authorizationRecordId: "permit-2026-08-22",
    });
  });

  it("blocks pending source or processing permission and pending samples", () => {
    const result = checkCalibrationReadiness({
      manifest: {
        ...manifest,
        entries: [
          {
            ...manifest.entries[0],
            authorizationStatus: "pending",
          },
        ],
      },
      authorization: {
        ...authorization,
        sourceLicense: { ...authorization.sourceLicense, status: "pending" },
        thirdPartyProcessing: {
          ...authorization.thirdPartyProcessing,
          status: "pending",
        },
      },
    });

    expect(result).toEqual({
      status: "blocked",
      reasons: [
        { code: "source-license-not-confirmed" },
        { code: "third-party-processing-not-confirmed" },
        {
          code: "sample-authorization-pending",
          sampleId: "audio.1111111111111111",
        },
      ],
    });
  });

  it("blocks duplicate hashes and batches over the configured limit", () => {
    const duplicate = {
      ...manifest.entries[0],
      sampleId: "audio.2222222222222222",
    };
    const result = checkCalibrationReadiness({
      manifest: { ...manifest, entries: [manifest.entries[0], duplicate] },
      authorization,
      maxSamples: 1,
    });

    expect(result).toEqual({
      status: "blocked",
      reasons: [
        { code: "sample-limit-exceeded" },
        { code: "duplicate-audio-hash", sampleId: "audio.2222222222222222" },
      ],
    });
  });

  it("rejects malformed manifests and blocks missing or invalid authorization records", () => {
    expect(() =>
      checkCalibrationReadinessFromUnknown({
        manifest: { ...manifest, entries: [{ ...manifest.entries[0], sha256: "not-a-hash" }] },
        authorization,
      }),
    ).toThrow();
    expect(
      checkCalibrationReadinessFromUnknown({ manifest }),
    ).toEqual({
      status: "blocked",
      reasons: [{ code: "authorization-record-missing" }],
    });
    expect(
      checkCalibrationReadinessFromUnknown({
        manifest,
        authorization: { ...authorization, recordId: " " },
      }),
    ).toEqual({
      status: "blocked",
      reasons: [{ code: "authorization-record-invalid" }],
    });
    expect(() => parseCalibrationAuthorization({ ...authorization, recordId: " " })).toThrow();
    expect(() => parseReplayAudioManifest({ ...manifest, dryRun: false })).toThrow();
  });
});
