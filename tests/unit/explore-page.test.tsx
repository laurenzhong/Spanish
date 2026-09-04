import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ExploreDashboardDto } from "@/src/modules/explore/domain";
import { ExplorePageContent } from "@/app/(product)/explore/explore-page-content";

const dashboard: ExploreDashboardDto = {
  userState: "available",
  goals: [
    { key: "communication.start.check-in", title: "询问近况", description: "用轻松问候开始交流。", position: 0, status: "published", expressionCount: 2 },
    { key: "communication.repair.ask-repeat", title: "请求重复", description: "没有听清时请求重说。", position: 1, status: "draft", expressionCount: 1 },
  ],
  packs: [
    { id: "pack-1", stableKey: "published-pack", title: "咖啡馆里的新朋友", summary: "在校园咖啡馆开启一段自然交流。", level: "A2", skills: ["listen", "speak"], durationLabel: "约 6 分钟", status: "published", version: "v1", updatedAt: null, route: "/explore/packs/published-pack", source: { title: "Sueño 原创", copyrightStatus: "cleared" } },
    { id: "pack-2", stableKey: "draft-pack", title: "周末市场", summary: "内容仍在整理。", level: "A2", skills: ["read"], durationLabel: "约 4 分钟", status: "draft", version: "v1", updatedAt: null },
  ],
  resume: [],
};

const progressPack: ExploreDashboardDto["packs"][number] = {
  id: "pack-progress",
  stableKey: "progress-pack",
  title: "办公室里的寒暄",
  summary: "继续完成一轮自然回应。",
  level: "B1",
  skills: ["listen", "speak"],
  durationLabel: "约 8 分钟",
  status: "in_progress",
  version: "v2",
  updatedAt: "2026-08-28T00:00:00.000Z",
  route: "/explore/packs/progress-pack",
  progress: { completedSteps: 2, totalSteps: 5 },
};

const unavailablePack: ExploreDashboardDto["packs"][number] = {
  id: "pack-unavailable",
  stableKey: "unavailable-pack",
  title: "地铁站问路",
  summary: "来源暂时不可用。",
  level: "A2",
  skills: ["listen"],
  durationLabel: "约 5 分钟",
  status: "unavailable",
  version: "v1",
  updatedAt: null,
};

describe("ExplorePageContent", () => {
  afterEach(() => cleanup());

  it("filters known goals and keeps draft goals visibly unavailable", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    expect(screen.getByRole("heading", { name: "探索真实表达" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "沟通目标" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "内容包" })).toBeInTheDocument();
    expect(screen.queryByText("表达资料库")).not.toBeInTheDocument();
    expect(screen.queryByText("从真实沟通目的出发，不按孤立的语法章节堆叠内容。")).not.toBeInTheDocument();
    expect(screen.queryByText("输入一句话，我们只会匹配已有的沟通目标，不会把文字发送给 AI。")).not.toBeInTheDocument();
    expect(screen.queryByText("新的内容包正在审核，先从今天的沟通目标开始。")).not.toBeInTheDocument();
    expect(screen.getByText("询问近况")).toBeInTheDocument();
    expect(screen.getByLabelText("请求重复，内容整理中")).toBeInTheDocument();
    expect(screen.getByText("约 6 分钟")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "重复" } });
    expect(screen.queryByText("询问近况")).not.toBeInTheDocument();
    expect(screen.getByText("请求重复")).toBeInTheDocument();
  });

  it("opens draft goal previews when local preview mode is enabled", () => {
    render(<ExplorePageContent allowDraftPreview dashboard={dashboard} />);
    expect(screen.getByRole("link", { name: /请求重复/ })).toHaveAttribute(
      "href",
      "/learn?goal=communication.repair.ask-repeat",
    );
  });

  it("opens a conditional rail with one route-backed primary action", () => {
    const { container } = render(<ExplorePageContent dashboard={dashboard} />);
    expect(container.querySelector(".explore-workspace")).not.toHaveClass("explore-workspace--with-rail");
    fireEvent.click(screen.getByRole("button", { name: "查看咖啡馆里的新朋友详情，可开始" }));
    expect(container.querySelector(".explore-workspace")).toHaveClass("explore-workspace--with-rail");
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("Sueño 原创");
    expect(screen.getByRole("link", { name: "开始这组内容" })).toHaveAttribute("href", "/explore/packs/published-pack");
    expect(screen.getAllByRole("link", { name: "开始这组内容" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭内容详情" }));
    expect(screen.queryByTestId("explore-detail-rail")).not.toBeInTheDocument();
  });

  it("supports saving a pack without nesting the save action inside the card selector", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    const save = screen.getByRole("button", { name: "保存咖啡馆里的新朋友" });
    fireEvent.click(save);
    expect(save).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("已保存到你的探索清单。")).toBeInTheDocument();
  });

  it("keeps the saved filter in the URL after selecting it", () => {
    window.history.replaceState(null, "", "/explore");
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("button", { name: "已保存" }));
    expect(new URL(window.location.href).searchParams.get("saved")).toBe("1");
  });

  it("shows an honest blocked state for a draft pack", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("button", { name: "查看周末市场详情，内容整理中" }));
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("内容整理中");
    expect(screen.getByText("这组内容完成审核后会出现在这里。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "开始这组内容" })).not.toBeInTheDocument();
  });

  it("renders the resume rail for in-progress content and keeps unavailable content blocked", async () => {
    const statefulDashboard = { ...dashboard, packs: [...dashboard.packs, progressPack, unavailablePack], resume: [progressPack] };
    render(<ExplorePageContent dashboard={statefulDashboard} />);

    expect(screen.getByRole("heading", { name: "继续探索" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看办公室里的寒暄详情，继续中" }));
    expect(screen.getByRole("link", { name: "继续这组内容" })).toHaveAttribute("href", "/explore/packs/progress-pack");
    fireEvent.click(screen.getByRole("button", { name: "关闭内容详情" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("aria-label", "查看办公室里的寒暄详情，继续中"));

    fireEvent.click(screen.getByRole("button", { name: "查看地铁站问路详情，暂不可用" }));
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("暂不可用");
    expect(screen.getByText("这组内容暂时无法读取，请稍后重试。")).toBeInTheDocument();
  });
});
