import { describe, expect, it } from "vitest";

import {
  activeSecondsForEvents,
  learningActivityConstants,
  type LearningActivityEvent,
} from "@/src/modules/profile/domain";

const base = new Date("2026-08-25T08:00:00.000Z");

function event(
  sequence: number,
  offsetSeconds: number,
  eventType: LearningActivityEvent["eventType"] = "active",
  clientInstanceId = "web-1",
): LearningActivityEvent {
  return {
    clientInstanceId,
    eventType,
    occurredAt: new Date(base.getTime() + offsetSeconds * 1000),
    sequence,
  };
}

describe("activeSecondsForEvents", () => {
  it("counts only contiguous active heartbeat intervals", () => {
    expect(
      activeSecondsForEvents([
        event(2, 30),
        event(0, 0),
        event(1, 15),
        event(3, 80),
        event(4, 95),
      ]),
    ).toBe(45);
  });

  it("cuts the active chain on lifecycle events and ignores the incomplete tail", () => {
    expect(
      activeSecondsForEvents([
        event(0, 0),
        event(1, 15),
        event(2, 20, "inactive"),
        event(3, 35),
        event(4, 50),
        event(5, 60, "ended"),
        event(6, 75),
      ]),
    ).toBe(30);
  });

  it("deduplicates retries, separates clients and caps one session", () => {
    expect(
      activeSecondsForEvents([
        event(0, 0),
        event(1, 15),
        event(1, 15),
        event(0, 0, "active", "flutter-1"),
        event(1, 15, "active", "flutter-1"),
        ...Array.from({ length: 200 }, (_, index) => event(index + 2, 30 + index * 15)),
      ]),
    ).toBe(learningActivityConstants.maxSessionSeconds);
  });

  it("rejects a heartbeat gap longer than the active threshold", () => {
    expect(
      activeSecondsForEvents([
        event(0, 0),
        event(1, learningActivityConstants.maxEventGapSeconds + 1),
        event(2, learningActivityConstants.maxEventGapSeconds + 16),
      ]),
    ).toBe(15);
  });
});
