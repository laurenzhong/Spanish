// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { importMediaSeriesManifest, inspectMediaSeriesManifest } from "@/src/modules/media/application/import-media-series";
import type { SaveMediaSeriesCommand } from "@/src/modules/media/domain/media-series";

const owner = "00000000-0000-4000-8000-0000000000a1";
const command: SaveMediaSeriesCommand = { idempotencyKey: "import-fixture-create", expectedRevision: 0, title: "Fixture", summary: "", kind: "video", orderMode: "ordered", status: "active", reason: "Official catalogue", evidence: ["https://fixture.test/programme"], members: [], removeStableKeys: [], fromSeriesRevisions: {} };
function manifest(entries = [{ seriesKey: "series.fixture", command }]) { return JSON.stringify({ schemaVersion: 1, catalogueKey: "catalogue.fixture", entries }); }

afterEach(() => { vi.unstubAllEnvs(); });
describe("media series manifest validation", () => {
  it("hashes exact bytes and validates every entry before any transaction", async () => {
    vi.stubEnv("CONTENT_WORKFLOW_OWNER_USER_IDS", owner);
    const transaction = vi.fn();
    const source = manifest();
    expect(inspectMediaSeriesManifest(source).sha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(inspectMediaSeriesManifest(`${source}\n`).sha256).not.toBe(inspectMediaSeriesManifest(source).sha256);
    const invalid = manifest([{ seriesKey: "series.valid", command }, { seriesKey: "series.invalid", command: { ...command, expectedRevision: -1 } }]);
    await expect(importMediaSeriesManifest({ source: invalid, ownerUserId: owner }, { transaction })).rejects.toMatchObject({ code: "MEDIA_SERIES_MANIFEST_INVALID" });
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires the exact approval hash for apply before any writes", async () => {
    vi.stubEnv("CONTENT_WORKFLOW_OWNER_USER_IDS", owner);
    const transaction = vi.fn();
    for (const expectedSha256 of [undefined, "a".repeat(64)]) {
      await expect(importMediaSeriesManifest({ source: manifest(), ownerUserId: owner, mode: "apply", expectedSha256 }, { transaction })).rejects.toMatchObject({ code: "MEDIA_SERIES_MANIFEST_HASH_MISMATCH" });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects duplicate series and media even when removal and addition occur in different entries", () => {
    expect(() => inspectMediaSeriesManifest(manifest([{ seriesKey: "series.same", command }, { seriesKey: "series.same", command }]))).toThrow("MEDIA_SERIES_MANIFEST_INVALID");
    const member = { stableKey: "media.same", position: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null, evidence: ["official"] };
    for (const second of [{ ...command, members: [member] }, { ...command, removeStableKeys: [member.stableKey] }]) {
      expect(() => inspectMediaSeriesManifest(manifest([{ seriesKey: "series.one", command: { ...command, members: [member] } }, { seriesKey: "series.two", command: second }]))).toThrow("MEDIA_SERIES_MANIFEST_INVALID");
    }
  });
  it("fails closed for a non-owner before inspecting data", async () => {
    vi.stubEnv("CONTENT_WORKFLOW_OWNER_USER_IDS", "");
    const transaction = vi.fn();
    await expect(importMediaSeriesManifest({ source: "invalid", ownerUserId: owner }, { transaction })).rejects.toMatchObject({ code: "CONTENT_WORKFLOW_FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
