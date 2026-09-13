import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceComposer } from "@/src/modules/conversation/ui/voice-composer";

describe("VoiceComposer", () => {
  afterEach(() => cleanup());

  it("keeps send disabled until text is present", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VoiceComposer onCancel={vi.fn()} onChange={onChange} onSubmit={vi.fn()} value="" />);

    expect(screen.getByRole("textbox")).toHaveAttribute("lang", "es");
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "Hola");
    expect(onChange).toHaveBeenCalled();
  });

  it("uses the same trailing control position for stopping a stream", () => {
    render(<VoiceComposer disabled onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="" />);

    expect(screen.getByRole("button", { name: "停止回复" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();
  });

  it("becomes honestly unavailable without showing a false stop action", () => {
    render(<VoiceComposer unavailable onCancel={vi.fn()} onChange={vi.fn()} onSubmit={vi.fn()} value="Hola" />);

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "使用语音输入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "停止回复" })).not.toBeInTheDocument();
    expect(screen.queryByText("Enter 发送 · Shift + Enter 换行")).not.toBeInTheDocument();
  });
});
