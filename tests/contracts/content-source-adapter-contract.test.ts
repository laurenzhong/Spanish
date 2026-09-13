// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  contentSourcePageSchema,
  FakeContentSourceAdapter,
} from "@/src/modules/content-acquisition";

const fixtureDirectory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "content-acquisition",
  "v1",
);

describe("content source adapter contract", () => {
  it("validates and returns the deterministic source fixture without network access", async () => {
    const page = contentSourcePageSchema.parse(JSON.parse(
      await readFile(path.join(fixtureDirectory, "fake-source-page.json"), "utf8"),
    ));
    const adapter = new FakeContentSourceAdapter([page]);

    await expect(adapter.discover({
      sourceStableKey: page.sourceStableKey,
      externalSourceId: "fixture-channel",
      cursor: page.cursor,
      limit: 10,
    })).resolves.toEqual(page);
    expect(adapter.calls).toEqual([{
      sourceStableKey: page.sourceStableKey,
      externalSourceId: "fixture-channel",
      cursor: page.cursor,
      limit: 10,
    }]);
  });

  it("honors limits and cancellation", async () => {
    const page = contentSourcePageSchema.parse(JSON.parse(
      await readFile(path.join(fixtureDirectory, "fake-source-page.json"), "utf8"),
    ));
    const adapter = new FakeContentSourceAdapter([page]);
    const limited = await adapter.discover({
      sourceStableKey: page.sourceStableKey,
      externalSourceId: "fixture-channel",
      cursor: page.cursor,
      limit: 1,
    });
    expect(limited.items).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    await expect(adapter.discover({
      sourceStableKey: page.sourceStableKey,
      externalSourceId: "fixture-channel",
      cursor: page.cursor,
      limit: 1,
    }, { signal: controller.signal })).rejects.toThrow("CONTENT_PROCESSING_FAILED");
  });

  it("rejects provider-shaped fixture data with unknown fields", () => {
    expect(() => contentSourcePageSchema.parse({
      sourceStableKey: "fixture.spanish.daily",
      cursor: null,
      nextCursor: null,
      estimatedCostMicros: 0,
      items: [],
      providerSecret: "must-not-leak",
    })).toThrow();
  });
});
