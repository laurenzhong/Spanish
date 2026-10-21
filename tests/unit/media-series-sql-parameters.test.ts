// @vitest-environment node
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDrizzleMediaSeriesRepository } from "@/src/modules/media/repositories/drizzle-media-series-repository";
import type { Database } from "@/src/shared/db/client";

describe("media series PostgreSQL raw SQL parameters", () => {
  it("binds the asset expiry clock as an ISO string with an explicit timestamptz cast", async () => {
    const requestedAt = new Date("2026-10-16T03:04:05.678Z");
    let compiled: ReturnType<PgDialect["sqlToQuery"]> | undefined;
    const database = {
      async execute(query: SQL) {
        compiled = new PgDialect().sqlToQuery(query);
        return [{ descriptor: { seriesKey: "series.fixture", revision: 1, episodeCount: 1 } }];
      },
    } as unknown as Database;
    const repository = createDrizzleMediaSeriesRepository(database, { now: () => requestedAt });
    await repository.getSeries("series.fixture", "00000000-0000-4000-8000-0000000000a1");
    // postgres-js cannot serialize an untyped Date in raw SQL, although PGlite
    // accepts it. Assert the actual dialect bind rather than merely its result.
    expect(compiled).toBeDefined();
    const timestampIndex = compiled!.params.indexOf(requestedAt.toISOString());
    expect(timestampIndex).toBeGreaterThanOrEqual(0);
    expect(compiled!.sql).toContain(`$${timestampIndex + 1}::timestamptz`);
    expect(compiled!.params.some((parameter) => parameter instanceof Date)).toBe(false);
  });
});
