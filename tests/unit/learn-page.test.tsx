import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LearnPage from "@/app/(product)/learn/page";

describe("LearnPage", () => {
  it("keeps one clear primary learning action", () => {
    render(<LearnPage />);

    expect(
      screen.getByRole("heading", { name: "问候后自然继续交流" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("可以独立完成简单自我介绍"),
    ).toBeInTheDocument();

    const primaryActions = screen.getAllByRole("link", {
      name: "继续学习",
    });
    expect(primaryActions).toHaveLength(1);
    expect(screen.queryByText(/分钟/)).not.toBeInTheDocument();
    expect(screen.queryByText(/模式/)).not.toBeInTheDocument();
  });
});
