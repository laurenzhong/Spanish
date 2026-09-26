import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const speechMocks = vi.hoisted(() => ({
  createBrowserAudioRecorder: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigationMocks.push }) }));
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
    navigationMocks.push.mockReset();
    vi.restoreAllMocks();
  });

  it.each(["scenario.restaurant-ordering", "scenario.campus-administration", "scenario.rental-conversation"])("renders %s with the generic detail component", (key) => {
    const scenario = getScenarioPracticeDetail(key)!;
    render(<ScenarioDetail scenario={scenario} />);
    expect(screen.getByRole("heading", { name: scenario.title })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /开始实战/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /开始实战/ })).toHaveAttribute("href", `/explore/scenarios/${key}/practice`);
    expect(screen.getAllByText(/自然替代表达/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^收藏表达：/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^朗读表达：/ })).toHaveLength(scenario.expressions.length);
    expect(screen.getAllByText(/对应目标/)).toHaveLength(scenario.expressions.length);
    expect(document.querySelector(".scenario-detail__action")).not.toBeInTheDocument();
  });

  it("keeps expression listening local and explains the matching communication goal", async () => {
    const scenario = getScenarioPracticeDetail("scenario.campus-administration")!;
    render(<ScenarioDetail scenario={scenario} />);

    fireEvent.click(screen.getByRole("button", { name: `朗读表达：${scenario.expressions[0]!.text}` }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("浏览器暂时无法朗读"));
    expect(screen.getByText(/目标 1 · 说明你要完成注册手续/)).toBeInTheDocument();
    expect(screen.queryByText(/能力证据|评分/)).not.toBeInTheDocument();
  });

  it("saves a formal expression by versioned server reference", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: "v1", data: { id: "saved-1" } }), { status: 201 }));
    const scenario = getScenarioPracticeDetail("scenario.restaurant-ordering")!;
    render(<ScenarioDetail scenario={scenario} />);
    fireEvent.click(screen.getByRole("button", { name: `收藏表达：${scenario.expressions[0]!.text}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `已收藏：${scenario.expressions[0]!.text}` })).toBeInTheDocument());
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
    expect(screen.queryByRole("button", { name: "按住说话" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "暂停" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "键盘" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "切换到语音输入" }));
    const recordButton = await screen.findByRole("button", { name: "按住说话" });
    fireEvent.pointerDown(recordButton, { pointerId: 1 });
    fireEvent.pointerUp(recordButton, { pointerId: 1 });
    resolveStart();

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByText("录音已取消，未送去转写。你可以重新按住录音或改用文字。")).toBeInTheDocument();
  });

  it("uses text by default, reveals voice on demand, and only offers completion after two turns", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/respond")) return new Response("{\"type\":\"delta\",\"text\":\"Vale.\"}\n{\"type\":\"done\"}\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });
      return new Response(null, { status: 503 });
    });
    render(<ScenarioPracticeWorkbench scenario={getScenarioPracticeDetail("scenario.campus-administration")!} />);

    expect(await screen.findByPlaceholderText("用西班牙语完成你的表达…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按住说话" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成练习" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换到语音输入" }));
    expect(screen.getByRole("button", { name: "按住说话" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换到文字输入" }));
    expect(screen.getByPlaceholderText("用西班牙语完成你的表达…")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("用西班牙语完成你的表达…");
    fireEvent.change(input, { target: { value: "Primera respuesta." } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByText("Vale.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "完成练习" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Segunda respuesta." } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getAllByText("Vale.")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "完成练习" })).toBeInTheDocument();
  });

  it("exposes the practice hierarchy and keeps secondary expression actions reversible", async () => {
    const scenario = getScenarioPracticeDetail("scenario.restaurant-ordering")!;
    render(<ScenarioPracticeWorkbench scenario={scenario} />);

    expect(await screen.findByRole("heading", { name: scenario.title })).toBeInTheDocument();
    expect(screen.getByText("场景实战")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "练习目标进度" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("button", { name: "提示" })).toBeEnabled();

    const input = screen.getByLabelText("用西班牙语完成你的表达");
    const send = screen.getByRole("button", { name: "发送" });
    expect(input).toHaveAttribute("aria-describedby", "scenario-composer-title");
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: "Quiero reservar una mesa." } });
    expect(send).toBeEnabled();

    const expressions = screen.getByRole("button", { name: "常用表达" });
    fireEvent.click(expressions);
    expect(screen.getByRole("region", { name: "常用表达" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭常用表达" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "常用表达" })).not.toBeInTheDocument());
    expect(expressions).toHaveFocus();
  });

  it("uses Enter as the typing submit action while keeping Shift+Enter available for a new line", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/respond")) return new Response("{\"type\":\"delta\",\"text\":\"Perfecto.\"}\n{\"type\":\"done\"}\n", { status: 200 });
      return new Response(null, { status: 503 });
    });
    render(<ScenarioPracticeWorkbench scenario={getScenarioPracticeDetail("scenario.restaurant-ordering")!} />);
    const input = await screen.findByLabelText("用西班牙语完成你的表达");
    fireEvent.change(input, { target: { value: "Quería pedir una mesa." } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(input).toHaveValue("Quería pedir una mesa.");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(screen.getByText("Perfecto.")).toBeInTheDocument());
  });

  it("returns to the detail route through the router", async () => {
    const scenario = getScenarioPracticeDetail("scenario.campus-administration")!;
    render(<ScenarioPracticeWorkbench scenario={scenario} />);
    fireEvent.click(await screen.findByRole("button", { name: "返回场景详情" }));
    expect(navigationMocks.push).toHaveBeenCalledWith(`/explore/scenarios/${scenario.stableKey}`);
  });
});
