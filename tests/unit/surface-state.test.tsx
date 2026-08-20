import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SurfaceState } from "@/src/shared/ui/surface-state";

describe("SurfaceState", () => {
  it.each([
    ["loading", "正在准备内容"],
    ["empty", "这里还没有内容"],
    ["error", "暂时无法载入"],
    ["offline", "当前处于离线状态"],
  ] as const)("renders an accessible %s state", (state, message) => {
    render(<SurfaceState state={state} />);

    expect(screen.getByText(message)).toBeVisible();
  });
});
