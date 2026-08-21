// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validateContentBundle } from "@/src/modules/content/import";
import { contentBundleSchema } from "@/src/modules/content/schemas";

type PatchOperation = {
  operation: "replace";
  path: Array<string | number>;
  value: unknown;
};

type FixtureManifest = {
  schemaVersion: string;
  baseFixture: string;
  cases: Array<{
    name: string;
    valid: boolean;
    operations: PatchOperation[];
  }>;
};

const fixturesDirectory = path.join(
  process.cwd(),
  "contracts",
  "fixtures",
  "content",
  "v1",
);
const schemaPath = path.join(
  process.cwd(),
  "contracts",
  "schemas",
  "v1",
  "content-bundle.schema.json",
);

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function applyOperations(input: unknown, operations: PatchOperation[]) {
  const output = structuredClone(input);
  for (const operation of operations) {
    let parent = output as Record<string | number, unknown>;
    for (const segment of operation.path.slice(0, -1)) {
      parent = parent[segment] as Record<string | number, unknown>;
    }
    parent[operation.path.at(-1)!] = operation.value;
  }
  return output;
}

describe("content bundle v1 contract", () => {
  it("keeps the committed JSON Schema generated from Zod", async () => {
    const generated = JSON.parse(
      JSON.stringify(
        z.toJSONSchema(contentBundleSchema, {
          target: "draft-2020-12",
          reused: "ref",
        }),
      ),
    ) as Record<string, unknown>;
    const expected = {
      ...generated,
      $id: "https://spanish.local/contracts/v1/content-bundle.schema.json",
      title: "Spanish content bundle v1",
    };

    await expect(readJson(schemaPath)).resolves.toEqual(expected);
  });

  it("accepts the shared structural fixture through JSON Schema", async () => {
    const manifest = (await readJson(
      path.join(fixturesDirectory, "manifest.json"),
    )) as FixtureManifest;
    const fixture = await readJson(
      path.join(fixturesDirectory, manifest.baseFixture),
    );
    const schema = (await readJson(schemaPath)) as AnySchema;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);

    expect(manifest.schemaVersion).toBe("1.0");
    expect(ajv.validate(schema, fixture), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("applies the same semantic fixture cases expected by Flutter", async () => {
    const manifest = (await readJson(
      path.join(fixturesDirectory, "manifest.json"),
    )) as FixtureManifest;
    const fixture = await readJson(
      path.join(fixturesDirectory, manifest.baseFixture),
    );

    for (const fixtureCase of manifest.cases) {
      const input = applyOperations(fixture, fixtureCase.operations);
      const parse = () => validateContentBundle(input);
      if (fixtureCase.valid) {
        expect(parse(), fixtureCase.name).toMatchObject({
          schemaVersion: manifest.schemaVersion,
        });
      } else {
        expect(parse, fixtureCase.name).toThrow();
      }
    }
  });
});
