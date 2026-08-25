import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/internal/diagnostics/route";

describe("internal diagnostics route", () => {
  const previousToken = process.env.DIAGNOSTICS_INTERNAL_TOKEN;

  afterEach(() => {
    if (previousToken === undefined) delete process.env.DIAGNOSTICS_INTERNAL_TOKEN;
    else process.env.DIAGNOSTICS_INTERNAL_TOKEN = previousToken;
  });

  it("fails closed when the internal token is missing or incorrect", async () => {
    delete process.env.DIAGNOSTICS_INTERNAL_TOKEN;
    const missing = await GET(new NextRequest("http://localhost/api/v1/internal/diagnostics"));
    expect(missing.status).toBe(401);

    process.env.DIAGNOSTICS_INTERNAL_TOKEN = "diagnostics-secret";
    const incorrect = await GET(new NextRequest("http://localhost/api/v1/internal/diagnostics", {
      headers: { "x-diagnostics-token": "wrong" },
    }));
    expect(incorrect.status).toBe(401);
  });

  it("does not attempt a database read without server configuration", async () => {
    process.env.DIAGNOSTICS_INTERNAL_TOKEN = "diagnostics-secret";
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const response = await GET(new NextRequest("http://localhost/api/v1/internal/diagnostics", {
      headers: { "x-diagnostics-token": "diagnostics-secret" },
    }));
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    expect(response.status).toBe(503);
  });
});
