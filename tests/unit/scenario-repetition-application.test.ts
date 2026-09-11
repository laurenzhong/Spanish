import { describe, expect, it, vi } from "vitest";

import {
  completeScenarioRepetition,
  listDueScenarioRepetitions,
  type ScenarioPracticeRepository,
  type ScenarioRepetitionItem,
} from "@/src/modules/scenario-practice";

const item: ScenarioRepetitionItem = {
  id: "repetition-1", userId: "user-1", sourceSessionId: "session-1", intervalStep: 1,
  intervalDays: 1, dueAt: new Date("2026-09-11T00:00:00.000Z"), status: "pending",
  expressionSnapshot: ["Quisiera cambiar la fecha."], goalSnapshot: "协商新的日期",
  variantRequirements: [{ kind: "condition", value: "日期不可用" }], idempotencyKey: "schedule:1",
  completionKey: null, completedAt: null, result: null,
};

function repository() {
  return {
    listDueRepetitionItems: vi.fn(async () => [item]),
    getRepetitionItem: vi.fn(async () => item),
    completeRepetitionItem: vi.fn(async (_userId, _id, completion) => ({ ...item, status: "completed" as const, ...completion })),
  } as unknown as ScenarioPracticeRepository;
}

describe("scenario repetition application", () => {
  it("lists only items due at the injected clock", async () => {
    const store = repository();
    const result = await listDueScenarioRepetitions(store, "user-1", () => new Date("2026-09-11T02:00:00.000Z"));
    expect(store.listDueRepetitionItems).toHaveBeenCalledWith("user-1", new Date("2026-09-11T02:00:00.000Z"), 20);
    expect(result).toEqual([item]);
  });

  it("does not consume a repetition after a technical failure", async () => {
    const store = repository();
    const result = await completeScenarioRepetition(store, {
      userId: "user-1", repetitionId: item.id, completionKey: "complete-1",
      result: "technical-failure", now: () => new Date("2026-09-11T02:00:00.000Z"),
    });
    expect(result).toEqual({ status: "retry-required", reason: "technical-failure", item });
    expect(store.completeRepetitionItem).not.toHaveBeenCalled();
  });

  it("completes a trustworthy result idempotently through the repository", async () => {
    const store = repository();
    const result = await completeScenarioRepetition(store, {
      userId: "user-1", repetitionId: item.id, completionKey: "complete-1",
      result: "contextual-success", now: () => new Date("2026-09-11T02:00:00.000Z"),
    });
    expect(result.status).toBe("completed");
    expect(store.completeRepetitionItem).toHaveBeenCalledWith("user-1", item.id, {
      completionKey: "complete-1", completedAt: new Date("2026-09-11T02:00:00.000Z"), result: "contextual-success",
    });
  });
});
