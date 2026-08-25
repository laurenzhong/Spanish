import { describe, expect, it } from "vitest";

import { aggregateDiagnosticAlerts } from "@/src/modules/observability";
import type { DiagnosticEventRecord } from "@/src/shared/observability";

function event(overrides: Partial<DiagnosticEventRecord> = {}): DiagnosticEventRecord {
  return {
    id: "event-1",
    eventType: "conversation.stream_failed",
    severity: "alert",
    status: "open",
    requestId: "req-1",
    sessionId: null,
    attemptId: null,
    conversationId: "conversation-1",
    generationId: "generation-1",
    errorType: "stream-failed",
    metadata: {},
    occurredAt: new Date("2026-08-25T12:00:00.000Z"),
    ...overrides,
  };
}

describe("diagnostic alert aggregation", () => {
  it("keeps isolated failures as warnings and raises repeated failures", () => {
    const now = new Date("2026-08-25T12:05:00.000Z");
    const warning = aggregateDiagnosticAlerts([event()], now);
    expect(warning[0]).toMatchObject({ severity: "warning", count: 1, threshold: 3 });

    const alert = aggregateDiagnosticAlerts(
      [event(), event({ id: "event-2", generationId: "generation-2", occurredAt: new Date("2026-08-25T12:01:00.000Z") }), event({ id: "event-3", generationId: "generation-3", occurredAt: new Date("2026-08-25T12:02:00.000Z") })],
      now,
    );
    expect(alert[0]).toMatchObject({ severity: "alert", count: 3, threshold: 3, windowMinutes: 15 });
  });

  it("uses per-event error types and ignores events outside the window", () => {
    const alerts = aggregateDiagnosticAlerts([
      event({ occurredAt: new Date("2026-08-25T11:00:00.000Z") }),
      event({ id: "event-2", errorType: "provider-cancelled", occurredAt: new Date("2026-08-25T12:04:00.000Z") }),
      event({ id: "event-3", eventType: "memory.conflict", errorType: "fact-conflict", occurredAt: new Date("2026-08-25T12:03:00.000Z") }),
    ], new Date("2026-08-25T12:05:00.000Z"));
    expect(alerts).toHaveLength(2);
    expect(alerts.map((item) => item.errorType)).toEqual(expect.arrayContaining(["provider-cancelled", "fact-conflict"]));
    expect(alerts.find((item) => item.errorType === "stream-failed")).toBeUndefined();
  });
});
