import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const speechMocks = vi.hoisted(() => ({
  createBrowserAudioRecorder: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/src/modules/providers/speech", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/modules/providers/speech")>()),
  createBrowserAudioRecorder: speechMocks.createBrowserAudioRecorder,
}));

import { getScenarioPracticeDetail, ScenarioDetail, ScenarioPracticeWorkbench } from "@/src/modules/scenario-practice";

describe("scenario practice shared UI", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    speechMocks.createBrowserAudioRecorder.mockReset();
    vi.restoreAllMocks();
  });

  it.each(["scenario.restaurant-ordering", "scenario.campus-administration", "scenario.rental-conversation"])("renders %s with the generic detail component", (key) => {
    const scenario = getScenarioPracticeDetail(key)!;
    render(<ScenarioDetail scenario={scenario} />);
    expect(screen.getByRole("heading", { name: scenario.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /开始实战/ })).toHaveAttribute("href", `/explore/scenarios/${key}/practice`);
    expect(screen.getAllByText(/自然替代表达/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "收藏表达" }).length).toBeGreaterThan(0);
  });

  it("saves a formal expression by versioned server reference", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: "v1", data: { id: "saved-1" } }), { status: 201 }));
    const scenario = getScenarioPracticeDetail("scenario.restaurant-ordering")!;
    render(<ScenarioDetail scenario={scenario} />);
    fireEvent.click(screen.getAllByRole("button", { name: "收藏表达" })[0]!);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "已收藏" }).length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/expressions/saved", expect.objectContaining({ method: "POST", body: expect.stringContaining(scenario.expressions[0]!.stableKey) }));
  });

  it("shows hints without correcting the learner before an expression is submitted", async () => {
    render(<ScenarioPracticeWorkbench scenario={getScenarioPracticeDetail("scenario.campus-administration")!} />);
    await waitFor(() => expect(screen.getByText("Buenos días. ¿En qué puedo ayudarle?")).toBeInTheDocument());
    expect(screen.queryByText(/错误|纠正/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    expect(screen.getAllByText("提示 1")).toHaveLength(2);
    expect(screen.getByText(getScenarioPracticeDetail("scenario.campus-administration")!.tasks[0]!.hints.level1)).toBeInTheDocument();
  });

  it("cancels a recording when the press ends before microphone startup completes", async () => {
    let resolveStart!: () => void;
    const cancel = vi.fn(async () => undefined);
    const stop = vi.fn();
    speechMocks.createBrowserAudioRecorder.mockReturnValue({
      start: vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; })),
      stop,
      cancel,
    });

    render(<ScenarioPracticeWorkbench scenario={getScenarioPracticeDetail("scenario.campus-administration")!} />);
    const recordButton = await screen.findByRole("button", { name: "按住说话" });
    fireEvent.pointerDown(recordButton, { pointerId: 1 });
    fireEvent.pointerUp(recordButton, { pointerId: 1 });
    resolveStart();

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByText("录音已取消，未送去转写。你可以重新按住录音或改用文字。")).toBeInTheDocument();
  });
});
