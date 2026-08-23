import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildLearningHeatmap } from "@/src/modules/profile/domain";
import { LearningHeatmap } from "@/src/modules/profile/ui/learning-heatmap";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("LearningHeatmap", () => {
  it("renders the empty calendar and reveals a selected day", async () => {
    const payload = buildLearningHeatmap([], new Date("2026-08-23T12:00:00.000Z"));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: payload }),
    });

    render(<LearningHeatmap />);
    await waitFor(() => expect(screen.getByTestId("learning-heatmap")).toBeInTheDocument());

    const today = screen.getByRole("button", { name: /8月23日/ });
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("heatmap-day-detail")).toHaveTextContent("暂无场景记录");

    const anotherDay = screen.getByRole("button", { name: /8月22日/ });
    fireEvent.click(anotherDay);
    expect(anotherDay).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveAttribute("aria-pressed", "false");
  });
});
