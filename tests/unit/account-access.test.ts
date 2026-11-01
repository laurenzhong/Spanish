import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock("@/src/shared/db/client", () => ({
  getDatabase: () => state.database,
}));

import { readAccountAccess } from "@/src/shared/auth/account-access";

function databaseReturning(row: unknown) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [row]),
        })),
      })),
    })),
  };
}

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});

describe("readAccountAccess", () => {
  it("retries one transient database failure before returning access", async () => {
    process.env.DATABASE_URL = "postgres://example.test/db";
    const database = databaseReturning({ role: "member", status: "active", deletionRequestedAt: null });
    let attempts = 0;
    database.select.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("connection closed");
      return databaseReturning({ role: "member", status: "active", deletionRequestedAt: null }).select();
    });
    state.database = database;

    await expect(readAccountAccess("user-1")).resolves.toEqual({ role: "member", status: "active", deletionPending: false });
    expect(attempts).toBe(2);
  });

  it("returns unknown after both database attempts fail", async () => {
    process.env.DATABASE_URL = "postgres://example.test/db";
    state.database = {
      select: vi.fn(() => {
        throw new Error("database unavailable");
      }),
    };

    await expect(readAccountAccess("user-1")).resolves.toBeNull();
    expect((state.database as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledTimes(2);
  });
});
