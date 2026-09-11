import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  defaultRetryable,
} from "@/src/shared/contracts/v1/api-contract";
import {
  parseCreateScenarioSessionRequest,
  parseSubmitScenarioTurnRequest,
  scenarioTransitionFixtureSchema,
} from "@/src/modules/scenario-practice";

const root = process.cwd();
const fixtureDirectory = path.join(root, "contracts", "fixtures", "scenario-practice", "v1");

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, file), "utf8")) as unknown;
}

describe("scenario practice contract", () => {
  it("keeps scenario error codes registered with stable retry semantics", () => {
    const expected = [
      "SCENARIO_SESSION_NOT_FOUND",
      "SCENARIO_SESSION_CONFLICT",
      "SCENARIO_TURN_CONFLICT",
      "SCENARIO_REPLY_INCOMPLETE",
      "SCENARIO_REVIEW_PENDING",
      "PROVIDER_NOT_CONFIGURED",
    ];
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(expected));
    expect(defaultRetryable("SCENARIO_SESSION_NOT_FOUND")).toBe(false);
    expect(defaultRetryable("SCENARIO_SESSION_CONFLICT")).toBe(false);
    expect(defaultRetryable("SCENARIO_REPLY_INCOMPLETE")).toBe(true);
    expect(defaultRetryable("SCENARIO_REVIEW_PENDING")).toBe(true);
    expect(defaultRetryable("PROVIDER_NOT_CONFIGURED")).toBe(false);
  });

  it("validates the versioned transition fixture", () => {
    const manifest = readJson("manifest.json") as {
      apiVersion: string;
      files: string[];
    };
    expect(manifest).toEqual({
      apiVersion: "v1",
      files: ["scenario-transitions.json"],
    });
    expect(scenarioTransitionFixtureSchema.parse(readJson(manifest.files[0]!))).toMatchObject({
      protocolVersion: "v1",
    });
  });

  it("rejects extra fields that could forge reviews, evidence, or relationship memory", () => {
    const validCreate = {
      clientAttemptId: "session-attempt-1",
      primaryModality: "speech",
      scenarioId: "10000000-0000-4000-8000-000000000010",
      contentVersion: 1,
    };
    expect(parseCreateScenarioSessionRequest(validCreate)).toEqual(validCreate);
    expect(() =>
      parseCreateScenarioSessionRequest({
        ...validCreate,
        evidenceScore: 1,
      }),
    ).toThrow();

    const validTurn = {
      attemptId: "attempt-1",
      expectedRevision: 2,
      generationId: "generation-1",
      hintLevel: 1,
      modality: "typing",
      text: "Quisiera una mesa para dos.",
    };
    expect(parseSubmitScenarioTurnRequest(validTurn)).toEqual(validTurn);
    expect(() =>
      parseSubmitScenarioTurnRequest({
        ...validTurn,
        relationshipMemory: { fact: "private" },
      }),
    ).toThrow();
  });

  it("exposes resolvable scenario schemas from OpenAPI", () => {
    const openApiPath = path.join(root, "contracts", "openapi", "v1", "openapi.json");
    const openApi = JSON.parse(fs.readFileSync(openApiPath, "utf8")) as {
      paths: Record<string, unknown>;
    };
    expect(openApi.paths).toHaveProperty("/scenario-practice/sessions");
    expect(openApi.paths).toHaveProperty("/scenario-practice/sessions/{sessionId}/turns");

    const validator = new Ajv2020({ allErrors: true, strict: true });
    addFormats(validator);
    for (const schemaName of [
      "scenario-session-create-request.schema.json",
      "scenario-session-response.schema.json",
      "scenario-turn-submit-request.schema.json",
    ]) {
      const filePath = path.join(root, "contracts", "schemas", "v1", schemaName);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(() => validator.compile(JSON.parse(fs.readFileSync(filePath, "utf8")))).not.toThrow();
    }
  });
});
