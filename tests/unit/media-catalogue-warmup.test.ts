import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  warmMediaCatalogue: vi.fn(async () => undefined),
  listMedia: vi.fn(async () => ({ items: [], hasMore: false, nextCursor: null })),
  createDrizzleMediaRepository: vi.fn(() => ({ list: vi.fn() })),
  getDatabase: vi.fn(() => ({})),
}));

vi.mock("@/src/modules/media/application/warm-media-catalogue", () => ({ warmMediaCatalogue: mocks.warmMediaCatalogue }));
vi.mock("@/src/modules/media/repositories", () => ({ createDrizzleMediaRepository: mocks.createDrizzleMediaRepository }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/media/application/list-media", () => ({ listMedia: mocks.listMedia }));

import { register } from "@/instrumentation";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalRuntime = process.env.NEXT_RUNTIME;

describe("server start warm-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
  });

  it("warms the media catalogue in the nodejs runtime when a database is configured", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.DATABASE_URL = "postgres://test";

    await register();

    expect(mocks.warmMediaCatalogue).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a database, so a build or a local run never touches the network", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.DATABASE_URL;

    await register();

    expect(mocks.warmMediaCatalogue).not.toHaveBeenCalled();
  });

  it("does nothing in the edge runtime, which has no database client", async () => {
    process.env.NEXT_RUNTIME = "edge";
    process.env.DATABASE_URL = "postgres://test";

    await register();

    expect(mocks.warmMediaCatalogue).not.toHaveBeenCalled();
  });

  it("never rejects when the warm-up fails, so a cold cache cannot break the boot", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.DATABASE_URL = "postgres://test";
    mocks.warmMediaCatalogue.mockRejectedValueOnce(new Error("database unreachable"));

    await expect(register()).resolves.toBeUndefined();
  });
});
