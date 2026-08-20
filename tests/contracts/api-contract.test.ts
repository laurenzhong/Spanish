import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  API_VERSION,
  ContractParseError,
  defaultRetryable,
  parseAuthSessionResponse,
  parseErrorResponse,
  parseSuccessResponse,
  type ApiErrorCode,
} from "@/src/shared/contracts/v1/api-contract";

type FixtureCase = {
  file: string;
  kind: "error" | "success";
  schemaId: string;
  valid: boolean;
  expected?: {
    code: string;
    retryable: boolean;
  };
  expectedParseError?: ApiErrorCode;
};

type FixtureManifest = {
  apiVersion: string;
  cases: FixtureCase[];
};

const repositoryRoot = process.cwd();
const schemasDirectory = path.join(repositoryRoot, "contracts", "schemas", "v1");
const fixturesDirectory = path.join(repositoryRoot, "contracts", "fixtures", "v1");
const registryDirectory = path.join(repositoryRoot, "contracts", "registry", "v1");

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  for (const fileName of fs.readdirSync(schemasDirectory)) {
    if (fileName.endsWith(".schema.json")) {
      ajv.addSchema(readJson(path.join(schemasDirectory, fileName)));
    }
  }

  return ajv;
}

describe("v1 API contracts", () => {
  it("keeps the protocol and error registry aligned with TypeScript", () => {
    const protocol = readJson<{ apiVersion: string }>(
      path.join(registryDirectory, "protocol.json"),
    );
    const registry = readJson<
      Array<{ code: string; defaultRetryable: boolean }>
    >(path.join(registryDirectory, "error-codes.json"));
    const errorSchema = readJson<{
      properties: { code: { enum: string[] } };
    }>(path.join(schemasDirectory, "api-error.schema.json"));

    expect(protocol.apiVersion).toBe(API_VERSION);
    expect(registry.map((entry) => entry.code)).toEqual(API_ERROR_CODES);
    expect(errorSchema.properties.code.enum).toEqual(API_ERROR_CODES);
    for (const entry of registry) {
      expect(defaultRetryable(entry.code)).toBe(entry.defaultRetryable);
    }
  });

  it("validates every shared fixture and applies the same parser semantics", () => {
    const validator = createValidator();
    const manifest = readJson<FixtureManifest>(
      path.join(fixturesDirectory, "manifest.json"),
    );

    expect(manifest.apiVersion).toBe(API_VERSION);

    for (const fixtureCase of manifest.cases) {
      const fixture = readJson<unknown>(
        path.join(fixturesDirectory, fixtureCase.file),
      );
      const validate = validator.getSchema(fixtureCase.schemaId);

      expect(validate, fixtureCase.schemaId).toBeDefined();
      expect(validate?.(fixture), JSON.stringify(validate?.errors)).toBe(
        fixtureCase.valid,
      );

      if (fixtureCase.valid) {
        if (fixtureCase.kind === "error") {
          const parsed = parseErrorResponse(fixture);
          expect(parsed.error).toMatchObject(fixtureCase.expected ?? {});
        } else {
          expect(parseSuccessResponse(fixture)).toMatchObject({
            apiVersion: API_VERSION,
          });
        }
      } else {
        const parse = () =>
          fixtureCase.kind === "error"
            ? parseErrorResponse(fixture)
            : parseSuccessResponse(fixture);
        expect(parse).toThrowError(
          expect.objectContaining<Partial<ContractParseError>>({
            code: fixtureCase.expectedParseError,
          }),
        );
      }
    }
  });

  it("only uses resolvable local references from the OpenAPI root", () => {
    const openApiPath = path.join(
      repositoryRoot,
      "contracts",
      "openapi",
      "v1",
      "openapi.json",
    );
    const openApi = readJson<{
      openapi: string;
      servers: Array<{ url: string }>;
      [key: string]: unknown;
    }>(openApiPath);
    const references: string[] = [];

    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (key === "$ref" && typeof child === "string") {
            references.push(child);
          } else {
            visit(child);
          }
        }
      }
    };

    visit(openApi);
    expect(openApi.openapi).toBe("3.1.1");
    expect(openApi.servers[0]?.url).toBe("/api/v1");
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.startsWith("#")).toBe(false);
      expect(fs.existsSync(path.resolve(path.dirname(openApiPath), reference))).toBe(
        true,
      );
    }
  });

  it("parses the shared authenticated session identity", () => {
    const fixture = readJson<unknown>(
      path.join(fixturesDirectory, "success-auth-session.json"),
    );

    expect(parseAuthSessionResponse(fixture)).toEqual({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "learner@example.test",
    });
  });
});
