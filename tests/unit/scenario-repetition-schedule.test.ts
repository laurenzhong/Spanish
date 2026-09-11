import { describe, expect, it } from "vitest";

import {
  completeRepetitionItem,
  createRepetitionSchedule,
} from "@/src/modules/scenario-practice";

describe("scenario repetition schedule", () => {
  it("uses an injected clock for same-day, 1-day, 3-day, and 7-day due dates", () => {
    const now = new Date("2026-09-11T04:30:00.000Z");
    const schedule = createRepetitionSchedule({
      baseIdempotencyKey: "session-complete-1",
      expressionSnapshot: ["Quisiera la sopa, por favor."],
      goalSnapshot: "Order a meal",
      makeId: (step) => `repetition-${step}`,
      now: () => now,
      sourceSessionId: "10000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000001",
      variantRequirements: [{ kind: "character" }],
    });

    expect(schedule.map((item) => item.intervalStep)).toEqual([0, 1, 2, 3]);
    expect(schedule.map((item) => item.dueAt.toISOString())).toEqual([
      "2026-09-11T04:30:00.000Z",
      "2026-09-12T04:30:00.000Z",
      "2026-09-14T04:30:00.000Z",
      "2026-09-18T04:30:00.000Z",
    ]);
    expect(schedule.map((item) => item.idempotencyKey)).toEqual([
      "session-complete-1:0",
      "session-complete-1:1",
      "session-complete-1:3",
      "session-complete-1:7",
    ]);
  });

  it("treats a repeated completion key as idempotent and rejects a different second completion", () => {
    const [item] = createRepetitionSchedule({
      baseIdempotencyKey: "session-complete-2",
      expressionSnapshot: [],
      goalSnapshot: "Repair communication",
      makeId: () => "repetition-0",
      now: () => new Date("2026-09-11T00:00:00.000Z"),
      sourceSessionId: "10000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
      variantRequirements: [],
    });
    if (!item) throw new Error("Expected a repetition item.");

    const first = completeRepetitionItem(item, {
      completedAt: new Date("2026-09-11T01:00:00.000Z"),
      completionKey: "completion-1",
      result: "contextual-success",
    });
    const repeated = completeRepetitionItem(first.item, {
      completedAt: new Date("2026-09-11T01:01:00.000Z"),
      completionKey: "completion-1",
      result: "contextual-success",
    });
    const conflict = completeRepetitionItem(first.item, {
      completedAt: new Date("2026-09-11T01:02:00.000Z"),
      completionKey: "completion-2",
      result: "needs-work",
    });

    expect(first.alreadyCompleted).toBe(false);
    expect(repeated).toEqual({ item: first.item, alreadyCompleted: true });
    expect(conflict).toEqual({
      item: first.item,
      alreadyCompleted: true,
      conflict: "SCENARIO_TURN_CONFLICT",
    });
  });
});
