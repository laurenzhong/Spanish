import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { getScenarioPracticeDetail, ScenarioDetail, ScenarioPracticeWorkbench } from "@/src/modules/scenario-practice";

describe("scenario practice shared UI", () => {
  afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

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
});
