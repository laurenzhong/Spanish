import { describe, expect, it } from "vitest";

import {
  buildLearningHeatmap,
  learningHeatmapConstants,
  type LearningSession,
} from "@/src/modules/profile/domain";

const generatedAt = new Date("2026-08-23T12:00:00.000Z");

function session(overrides: Partial<LearningSession>): LearningSession {
  return {
    activeSeconds: 25 * 60,
    attemptCount: 1,
    completedAt: new Date("2026-08-23T08:25:00.000Z"),
    id: crypto.randomUUID(),
    independentExpressionCount: 2,
    sceneLabel: "在咖啡馆点单",
    startedAt: new Date("2026-08-23T08:00:00.000Z"),
    status: "completed",
    skillKeys: ["task.request", "fluency.turn-taking"],
    ...overrides,
  };
}

describe("buildLearningHeatmap", () => {
  it("fills a full year and aggregates completed sessions by day", () => {
    const result = buildLearningHeatmap([
      session({}),
      session({
        id: crypto.randomUUID(),
        startedAt: new Date("2026-08-23T09:00:00.000Z"),
        completedAt: new Date("2026-08-23T09:10:00.000Z"),
        activeSeconds: 10 * 60,
        sceneLabel: "和朋友确认时间",
        independentExpressionCount: 1,
        skillKeys: ["transfer.rephrase"],
      }),
      session({
        id: crypto.randomUUID(),
        status: "abandoned",
        completedAt: null,
        activeSeconds: 0,
      }),
    ], generatedAt);

    expect(result.days).toHaveLength(learningHeatmapConstants.dayCount);
    expect(result.range).toEqual({ from: "2025-08-24", to: "2026-08-23" });
    expect(result.totals).toEqual({
      activeDays: 1,
      totalMinutes: 35,
      totalSessions: 2,
    });
    expect(result.days.at(-1)).toMatchObject({
      date: "2026-08-23",
      durationMinutes: 35,
      independentExpressionCount: 3,
      sceneLabels: ["在咖啡馆点单", "和朋友确认时间"],
      sessionCount: 2,
      skillLabels: ["交际策略", "语流节奏", "迁移表达"],
    });
  });

  it("caps completed sessions and ignores sessions without a completed attempt", () => {
    const result = buildLearningHeatmap([
      session({
        startedAt: new Date("2026-08-22T08:00:00.000Z"),
        completedAt: new Date("2026-08-22T10:00:00.000Z"),
        activeSeconds: 60 * 60,
      }),
      session({
        startedAt: new Date("2026-08-21T08:00:00.000Z"),
        completedAt: new Date("2026-08-21T08:25:00.000Z"),
        status: "active",
        activeSeconds: 25 * 60,
      }),
    ], generatedAt);

    expect(result.days.find((day) => day.date === "2026-08-22")).toMatchObject({
      durationMinutes: learningHeatmapConstants.maxSessionMinutes,
    });
    expect(result.days.find((day) => day.date === "2026-08-21")).toMatchObject({
      durationMinutes: 25,
      sessionCount: 1,
    });
  });
});
