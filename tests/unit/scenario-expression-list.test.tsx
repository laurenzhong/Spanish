import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ttsMocks = vi.hoisted(() => ({
  createReadAloud: vi.fn(),
}));

vi.mock("@/src/modules/providers/tts", () => ({
  createReadAloud: ttsMocks.createReadAloud,
}));

import type { ScenarioPracticeExpression } from "@/src/modules/scenario-practice/content";
import { ScenarioExpressionList } from "@/src/modules/scenario-practice/ui/scenario-expression-list";
import { SpeechCapabilityError } from "@/src/modules/providers/speech";

const expression: ScenarioPracticeExpression = {
  stableKey: "campus.vengo-para",
  text: "Vengo para formalizar mi matrícula.",
  translation: "我是来完成注册手续的。",
  communicativeIntent: "清楚说明办理目的。",
  variants: [],
};

describe("scenario expression list", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    ttsMocks.createReadAloud.mockReset();
  });

  it("speaks the expression in the scenario locale and exposes a stop state", async () => {
    const speak = vi.fn<(text: string, options: { languageTag: string; rate: number; onStart?: () => void }) => Promise<void>>(() => new Promise<void>(() => undefined));
    const stop = vi.fn();
    ttsMocks.createReadAloud.mockReturnValue({ isSupported: true, speak, stop });
    const user = userEvent.setup();

    render(
      <ScenarioExpressionList
        expressions={[expression]}
        goalsByExpression={{ [expression.stableKey]: [{ position: 0, prompt: "说明你要完成注册手续。" }] }}
        version={1}
        allowSave={false}
        languageTag="es-MX"
      />,
    );

    const button = screen.getByRole("button", { name: `朗读表达：${expression.text}` });
    await user.click(button);
    expect(speak).toHaveBeenCalledWith(expression.text, { languageTag: "es-MX", rate: 1, onStart: expect.any(Function) });
    expect(screen.getByRole("button", { name: `停止朗读：${expression.text}` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(`正在准备朗读：${expression.text}`);
    act(() => speak.mock.calls[0]![1].onStart?.());
    expect(screen.getByRole("status")).toHaveTextContent(`正在朗读：${expression.text}`);

    await user.click(screen.getByRole("button", { name: `停止朗读：${expression.text}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `朗读表达：${expression.text}` })).toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(1);
    act(() => speak.mock.calls[0]![1].onStart?.());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not report a cancelled playback as a failure", async () => {
    const speak = vi.fn().mockRejectedValue(new SpeechCapabilityError("tts-cancelled", "cancelled"));
    ttsMocks.createReadAloud.mockReturnValue({ isSupported: true, speak, stop: vi.fn() });
    render(<ScenarioExpressionList expressions={[expression]} goalsByExpression={{}} version={1} allowSave={false} languageTag="es-ES" />);
    await userEvent.setup().click(screen.getByRole("button", { name: `朗读表达：${expression.text}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `朗读表达：${expression.text}` })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
