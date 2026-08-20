import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("describes the foundation without presenting unfinished product flows", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "基础工程已就绪" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Next.js App Router")).toBeInTheDocument();
    expect(screen.queryByText("继续学习")).not.toBeInTheDocument();
  });
});
