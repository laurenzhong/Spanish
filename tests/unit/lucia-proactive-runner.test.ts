import { describe, expect, it } from "vitest";

import {
  formatNaturalDate,
  getDueLuciaProactiveSlots,
  getLuciaProactiveSlots,
  luciaProactiveGenerationAttempts,
  parseLuciaProactiveUserIds,
  proactiveFailurePayload,
  scheduledProactiveDatabaseUrl,
  shouldRetryLuciaProactiveGeneration,
} from "@/src/modules/conversation/application/proactive-runner-utils";

describe("Lucía proactive daily runner", () => {
  it("requires an explicit UUID allowlist and removes duplicate ids", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    expect(parseLuciaProactiveUserIds(`${first}, ${first},${second}`)).toEqual([first, second]);
    expect(() => parseLuciaProactiveUserIds("")).toThrow("LUCIA_PROACTIVE_USER_IDS");
    expect(() => parseLuciaProactiveUserIds("not-a-uuid")).toThrow("comma-separated list of UUIDs");
  });

  it("uses the configured product timezone for the daily dedupe date", () => {
    expect(formatNaturalDate(new Date("2026-09-24T01:00:00.000Z"))).toBe("2026-09-24");
    expect(formatNaturalDate(new Date("2026-09-24T16:00:00.000Z"))).toBe("2026-09-25");
  });

  it("assigns stable multiple daily slots per user", () => {
    const slots = getLuciaProactiveSlots("00000000-0000-4000-8000-000000000001", "2026-09-24");
    expect(slots).toHaveLength(3);
    expect(slots).toEqual(getLuciaProactiveSlots("00000000-0000-4000-8000-000000000001", "2026-09-24"));
    expect(slots.map((slot) => slot.sourceEventId)).toEqual(["2026-09-24:slot-1", "2026-09-24:slot-2", "2026-09-24:slot-3"]);
    expect(getDueLuciaProactiveSlots({ userId: "00000000-0000-4000-8000-000000000001", now: new Date("2026-09-24T02:00:00.000Z") }).length).toBe(1);
  });

  it("retries provider outages and rejected output samples, not deterministic failures", () => {
    expect(luciaProactiveGenerationAttempts).toBe(3);
    expect(shouldRetryLuciaProactiveGeneration("provider-unavailable")).toBe(true);
    expect(shouldRetryLuciaProactiveGeneration("safety-gate-unsupported-script")).toBe(true);
    expect(shouldRetryLuciaProactiveGeneration("safety-gate-question-policy")).toBe(true);
    expect(shouldRetryLuciaProactiveGeneration("character-runtime-unavailable")).toBe(false);
    expect(shouldRetryLuciaProactiveGeneration("relationship-inactive")).toBe(false);
    expect(shouldRetryLuciaProactiveGeneration(null)).toBe(false);
  });

  it("disables postgres.js's internal type fetch without disturbing the connection parameters", () => {
    const raw = "postgresql://postgres.project:pa%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require";
    const url = new URL(scheduledProactiveDatabaseUrl(raw));
    // fetch_types is a postgres.js connection-URL option; disabling it stops the
    // unretained pg_type catalog query that crashed the 2026-10-22 scheduled run.
    expect(url.searchParams.get("fetch_types")).toBe("false");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.username).toBe("postgres.project");
    // postgres.js decodes the userinfo itself, so the round-tripped URL must
    // decode back to the original password.
    expect(decodeURIComponent(url.password)).toBe("pa@ss");
    expect(url.hostname).toBe("aws-0-ap-southeast-1.pooler.supabase.com");
    expect(url.port).toBe("6543");
    expect(url.pathname).toBe("/postgres");

    const repeated = scheduledProactiveDatabaseUrl("postgresql://u:p@h:5432/db?fetch_types=true&application_name=runner");
    expect(new URL(repeated).searchParams.get("fetch_types")).toBe("false");
    expect(new URL(repeated).searchParams.get("application_name")).toBe("runner");
    expect(new URL(scheduledProactiveDatabaseUrl(repeated)).searchParams.get("fetch_types")).toBe("false");
  });

  it("reports process-level failures as one JSON line with the Postgres SQLSTATE", () => {
    const postgresError = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    expect(JSON.parse(proactiveFailurePayload("unhandled-rejection", postgresError))).toEqual({
      code: "LUCIA_PROACTIVE_FAILED",
      reason: "unhandled-rejection",
      message: "canceling statement due to statement timeout",
      pgCode: "57014",
    });
    expect(JSON.parse(proactiveFailurePayload("uncaught-exception", "boom"))).toEqual({
      code: "LUCIA_PROACTIVE_FAILED",
      reason: "uncaught-exception",
      message: "Lucía proactive run failed.",
    });
    expect(JSON.parse(proactiveFailurePayload("run-failed", new Error("x".repeat(600)))).message).toHaveLength(500);
    // Application error codes are not SQLSTATEs and must not be reported as one.
    const applicationError = Object.assign(new Error("CHARACTER_RUNTIME_UNAVAILABLE"), { code: "CHARACTER_RUNTIME_UNAVAILABLE" });
    expect(JSON.parse(proactiveFailurePayload("run-failed", applicationError))).not.toHaveProperty("pgCode");
  });
});
