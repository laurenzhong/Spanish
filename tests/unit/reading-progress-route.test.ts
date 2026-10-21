import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  listReadingProgress: vi.fn(),
}));

vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/reading/repositories", () => ({ createDrizzleReadingRepository: mocks.createRepository }));
vi.mock("@/src/modules/reading", () => ({ listReadingProgress: mocks.listReadingProgress }));

import { GET } from "@/app/api/v1/read/progress/route";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const requestId = "reading_progress_12345678";
const repository = {};

function request() {
  return new NextRequest("http://localhost/api/v1/read/progress", { headers: { "x-request-id": requestId } });
}

function progressSchemaValidator() {
  const schemaPath = path.join(process.cwd(), "contracts", "schemas", "v1", "reading-progress-response.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")) as object);
}

describe("reading progress route", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.createRepository.mockReturnValue(repository);
    mocks.getDatabase.mockReturnValue({});
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("requires a user session", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "AUTH_REQUIRED", requestId, retryable: false },
    });
    expect(mocks.listReadingProgress).not.toHaveBeenCalled();
  });

  it("returns ISO timestamps in repository order without caching", async () => {
    mocks.listReadingProgress.mockResolvedValue([
      { articleId: "art_madrid@3", lastOpenedAt: new Date("2026-10-10T12:00:00.000Z"), position: 7, status: "in_progress" },
      { articleId: "art_sevilla@1", lastOpenedAt: new Date("2026-10-09T08:30:15.250Z"), position: 0, status: "completed" },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      apiVersion: "v1",
      data: {
        progress: [
          { articleId: "art_madrid@3", lastOpenedAt: "2026-10-10T12:00:00.000Z", position: 7, status: "in_progress" },
          { articleId: "art_sevilla@1", lastOpenedAt: "2026-10-09T08:30:15.250Z", position: 0, status: "completed" },
        ],
      },
    });
    expect(mocks.listReadingProgress).toHaveBeenCalledWith(repository, user.id);

    const validate = progressSchemaValidator();
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
  });

  it("returns an empty progress array for a user without progress rows", async () => {
    mocks.listReadingProgress.mockResolvedValue([]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ apiVersion: "v1", data: { progress: [] } });
  });

  it("returns unavailable when the database is not configured", async () => {
    delete process.env.DATABASE_URL;

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "INTERNAL_ERROR", requestId, retryable: true },
    });
    expect(mocks.listReadingProgress).not.toHaveBeenCalled();
  });

  it("returns unavailable when the reading progress use case rejects", async () => {
    mocks.listReadingProgress.mockRejectedValue(new Error("progress read failed"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "INTERNAL_ERROR", requestId, retryable: true },
    });
  });
});
