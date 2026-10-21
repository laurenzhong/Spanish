import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LearningHeatmap } from "@/src/modules/profile/ui/learning-heatmap";

// Regression: a failed heatmap read used to render the empty state, so a
// network error or a 503 was shown as "还没有有效学习记录" - a claim about the
// user's own learning history that the client cannot make when the read never
// succeeded. The successful-but-empty path is already covered by
// tests/unit/learning-heatmap-panel.test.tsx.
describe("LearningHeatmap when the read fails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says the activity could not be read instead of claiming there is none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const onError = vi.fn();

    render(<LearningHeatmap onError={onError} showError={false} />);

    await waitFor(() => expect(screen.getByTestId("learning-heatmap-unavailable")).toBeInTheDocument());
    expect(screen.queryByTestId("learning-heatmap-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("learning-heatmap-unavailable")).toHaveTextContent("暂时无法读取学习活动");
    expect(onError).toHaveBeenCalled();
  });
});