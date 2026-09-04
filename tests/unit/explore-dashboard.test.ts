import { describe, expect, it } from "vitest";

import { explorePackStateKey, getExploreDashboard, toExploreCard, type ExploreContentPackRecord, type ExploreRepository } from "@/src/modules/explore/domain";

const pack: ExploreContentPackRecord = {
  id: "pack.cafe@1",
  stableKey: "pack.cafe",
  version: 1,
  title: { "zh-CN": "咖啡馆对话" },
  summary: { "zh-CN": "在咖啡馆开始一段自然交流。" },
  cefr: "A2",
  sourceTitle: "Sueño 原创内容",
  copyrightStatus: "cleared",
  status: "published",
  skills: ["listen", "read", "speak"],
  activityCount: 5,
  updatedAt: "2026-08-28T00:00:00.000Z",
};

const repository: ExploreRepository = {
  async listGoals() {
    return [
      { stableKey: "communication.start.check-in", title: { "zh-CN": "询问近况" }, description: { "zh-CN": "轻松开始交流。" }, position: 0, status: "draft", expressionCount: 2 },
    ];
  },
  async listContentPacks() {
    return [pack];
  },
};

describe("explore dashboard", () => {
  it("uses a stable key that isolates content-pack versions", () => {
    expect(explorePackStateKey("pack.cafe", 1)).toBe("pack.cafe@1");
    expect(explorePackStateKey("pack.cafe", 2)).not.toBe(explorePackStateKey("pack.cafe", 1));
  });

  it("maps a published pack with partial progress to an in-progress card and a real route", async () => {
    const dashboard = await getExploreDashboard(repository, "user-1", {
      async getForUser() {
        return { status: "available", packs: { [pack.id]: { saved: true, progress: { completedSteps: 2, totalSteps: 5 } } } };
      },
    });

    expect(dashboard.packs[0]).toMatchObject({
      status: "in_progress",
      route: "/explore/packs/pack.cafe",
      saved: true,
      progress: { completedSteps: 2, totalSteps: 5 },
      source: { title: "Sueño 原创内容", copyrightStatus: "cleared" },
    });
    expect(dashboard.resume).toHaveLength(1);
    expect(dashboard.goals[0]).toMatchObject({ title: "询问近况", expressionCount: 2 });
  });

  it("does not expose a route for draft or unavailable content", () => {
    expect(toExploreCard({ ...pack, status: "draft" }, undefined)).toMatchObject({ status: "draft" });
    expect(toExploreCard({ ...pack, status: "unavailable" }, undefined)).toMatchObject({ status: "unavailable" });
    expect(toExploreCard({ ...pack, status: "draft" }, undefined).route).toBeUndefined();
    expect(toExploreCard({ ...pack, status: "draft" }, undefined, { allowDraft: true }).route).toBe("/explore/packs/pack.cafe");
  });

  it("keeps user-state failures explicit instead of inventing saved or progress values", async () => {
    const dashboard = await getExploreDashboard(repository, "user-1", {
      async getForUser() {
        return { status: "unavailable", packs: {} };
      },
    });

    expect(dashboard.userState).toBe("unavailable");
    expect(dashboard.packs[0]?.saved).toBeUndefined();
    expect(dashboard.packs[0]?.progress).toBeUndefined();
  });
});
