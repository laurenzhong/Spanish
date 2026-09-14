// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const directory = path.join(process.cwd(), "contracts", "schemas", "v1");
  for (const file of readdirSync(directory).filter((candidate) => candidate.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(path.join(directory, file), "utf8")));
  return ajv.getSchema(`https://spanish.local/contracts/v1/${name}`)!;
}

const emptyGroup = (key: string) => ({ key, label: key, description: "description", mastery: null, confidence: null, evidenceCount: 0, lastEvidenceAt: null, oralCoverage: null, previousMastery: null, previousConfidence: null, representativeAttempts: [], skillKeys: [], skills: [], status: "data-insufficient" });
const axis = { confidence: null, description: "axis", evidenceCount: 0, key: "axis", label: "axis", lastEvidenceAt: null, mastery: null, oralCoverage: null, previousMastery: null, previousConfidence: null, representativeAttempts: [], skillKeys: [], status: "data-insufficient" };

describe("four capability profile contract", () => {
  it("validates explicit capability projection and rejects unknown group fields", () => {
    const validate = validator("profile-overview-response.schema.json");
    const value = { apiVersion: "v1", data: { axes: [axis], generatedAt: "2026-08-23T00:00:00.000Z", summary: {}, capabilityGroups: ["lexical", "communication", "voice", "shadowing"].map(emptyGroup), capabilitySummary: { totalEvidence: 0, totalGroups: 4, verifiedGroups: 0 } } };
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...value, data: { ...value.data, capabilityGroups: [{ ...value.data.capabilityGroups[0], skillKeys: [], internalScore: 1 }, ...value.data.capabilityGroups.slice(1)] } })).toBe(false);
  });
});
