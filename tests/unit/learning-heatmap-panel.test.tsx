import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildLearningHeatmap } from "@/src/modules/profile/domain";
import { LearningHeatmap } from "@/src/modules/profile/ui/learning-heatmap";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("LearningHeatmap", () => {
  it("renders a compact empty state without a full calendar", async () => {
    const payload = buildLearningHeatmap([], new Date("2026-08-23T12:00:00.000Z"));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: payload }),
    });

    render(<LearningHeatmap />);
    await waitFor(() => expect(screen.getByTestId("learning-heatmap")).toBeInTheDocument());

    expect(screen.getByTestId("learning-heatmap-empty")).toHaveTextContent("还没有有效学习记录");
    expect(screen.queryByRole("group", { name: "最近 12 周学习活动" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("heatmap-day-detail")).not.toBeInTheDocument();
  });
});
