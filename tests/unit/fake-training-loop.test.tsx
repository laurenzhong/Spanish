import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeTrainingLoop } from "@/src/modules/training/ui/fake-training-loop";

describe("FakeTrainingLoop", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores a stable checkpoint without replaying input playback", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FakeTrainingLoop userId="checkpoint-user" />);

    await screen.findByText("轮到你了");
    expect(screen.getByTestId("training-loop")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    unmount();
    cleanup();
    render(<FakeTrainingLoop userId="checkpoint-user" />);

    expect(await screen.findByText("已恢复上次稳定进度")).toBeInTheDocument();
    expect(screen.getByText("轮到你了")).toBeInTheDocument();
    expect(screen.queryByText("先听一遍")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "用文字回答" }));
    expect(screen.getByLabelText("写下你的回应")).toBeInTheDocument();
  });

  it("loads the first expression and reaches output selection", async () => {
    render(<FakeTrainingLoop />);

    expect(screen.getByText("先听一遍")).toBeInTheDocument();
    expect(await screen.findByText("轮到你了")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用文字回答" })).toBeInTheDocument();
  });

  it("accepts a natural typed alternative and starts the next expression after completion", async () => {
    const user = userEvent.setup();
    render(<FakeTrainingLoop />);

    await screen.findByText("轮到你了");
    await user.click(screen.getByRole("button", { name: "用文字回答" }));
    await user.type(screen.getByLabelText("写下你的回应"), "¿Qué tal todo?");
    await user.click(screen.getByRole("button", { name: "提交文字回答" }));

    expect(await screen.findByText("正在给出这轮反馈……")).toBeInTheDocument();
    expect(await screen.findByText("对方可以接住你的意思")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "完成这句" }));
    await user.click(screen.getByRole("button", { name: "下一句" }));

    expect(await screen.findByText("¿Cómo se llama?")).toBeInTheDocument();
    expect(screen.getByText("先听一遍")).toBeInTheDocument();
  });
});
