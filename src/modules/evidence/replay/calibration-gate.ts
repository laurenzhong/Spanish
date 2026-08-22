import { z } from "zod";

import {
  parseReplayAudioManifest,
  type ReplayAudioManifest,
} from "./audio-manifest";

const referenceSchema = z.string().trim().min(1).max(256);

export const calibrationAuthorizationSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    recordId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/),
    sourceLicense: z
      .object({
        status: z.enum(["confirmed", "pending"]),
        reference: referenceSchema,
      })
      .strict(),
    thirdPartyProcessing: z
      .object({
        status: z.enum(["confirmed", "pending"]),
        reference: referenceSchema,
      })
      .strict(),
  })
  .strict();

export type CalibrationAuthorization = z.infer<
  typeof calibrationAuthorizationSchema
>;

export function parseCalibrationAuthorization(
  input: unknown,
): CalibrationAuthorization {
  return calibrationAuthorizationSchema.parse(input);
}

export const calibrationBlockReasonCodes = [
  "authorization-record-missing",
  "authorization-record-invalid",
  "manifest-empty",
  "manifest-not-dry-run",
  "sample-limit-exceeded",
  "source-license-not-confirmed",
  "third-party-processing-not-confirmed",
  "sample-authorization-pending",
  "invalid-audio-hash",
  "invalid-audio-size",
  "duplicate-audio-hash",
] as const;

export type CalibrationBlockReasonCode =
  (typeof calibrationBlockReasonCodes)[number];

export type CalibrationBlockReason = Readonly<{
  code: CalibrationBlockReasonCode;
  sampleId?: string;
}>;

export type CalibrationGateInput = Readonly<{
  manifest: ReplayAudioManifest;
  authorization: CalibrationAuthorization;
  maxSamples?: number;
}>;

export type CalibrationGateResult =
  | Readonly<{
      status: "ready";
      sampleCount: number;
      sampleIds: readonly string[];
      authorizationRecordId: string;
    }>
  | Readonly<{
      status: "blocked";
      reasons: readonly CalibrationBlockReason[];
    }>;

export const defaultCalibrationMaxSamples = 20;

export function checkCalibrationReadiness(
  input: CalibrationGateInput,
): CalibrationGateResult {
  const maxSamples = input.maxSamples ?? defaultCalibrationMaxSamples;
  const reasons: CalibrationBlockReason[] = [];

  if (!input.manifest.dryRun) {
    reasons.push({ code: "manifest-not-dry-run" });
  }
  if (input.manifest.entries.length === 0) {
    reasons.push({ code: "manifest-empty" });
  }
  if (
    !Number.isInteger(maxSamples) ||
    maxSamples < 1 ||
    input.manifest.entries.length > maxSamples
  ) {
    reasons.push({ code: "sample-limit-exceeded" });
  }
  if (input.authorization.sourceLicense.status !== "confirmed") {
    reasons.push({ code: "source-license-not-confirmed" });
  }
  if (input.authorization.thirdPartyProcessing.status !== "confirmed") {
    reasons.push({ code: "third-party-processing-not-confirmed" });
  }

  const hashes = new Set<string>();
  for (const entry of input.manifest.entries) {
    if (entry.authorizationStatus !== "confirmed") {
      reasons.push({
        code: "sample-authorization-pending",
        sampleId: entry.sampleId,
      });
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      reasons.push({ code: "invalid-audio-hash", sampleId: entry.sampleId });
    }
    if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes <= 0) {
      reasons.push({ code: "invalid-audio-size", sampleId: entry.sampleId });
    }
    if (hashes.has(entry.sha256)) {
      reasons.push({ code: "duplicate-audio-hash", sampleId: entry.sampleId });
    }
    hashes.add(entry.sha256);
  }

  if (reasons.length > 0) {
    return { status: "blocked", reasons };
  }

  return {
    status: "ready",
    sampleCount: input.manifest.entries.length,
    sampleIds: input.manifest.entries.map((entry) => entry.sampleId),
    authorizationRecordId: input.authorization.recordId,
  };
}

export function checkCalibrationReadinessFromUnknown(input: Readonly<{
  manifest: unknown;
  authorization?: unknown;
  maxSamples?: number;
}>): CalibrationGateResult {
  if (input.authorization === undefined || input.authorization === null) {
    return {
      status: "blocked",
      reasons: [{ code: "authorization-record-missing" }],
    };
  }

  let authorization: CalibrationAuthorization;
  try {
    authorization = parseCalibrationAuthorization(input.authorization);
  } catch {
    return {
      status: "blocked",
      reasons: [{ code: "authorization-record-invalid" }],
    };
  }

  return checkCalibrationReadiness({
    manifest: parseReplayAudioManifest(input.manifest),
    authorization,
    maxSamples: input.maxSamples,
  });
}
