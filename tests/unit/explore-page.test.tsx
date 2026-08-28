import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("ExplorePageContent", () => {
  afterEach(() => cleanup());

  it("filters known goals and keeps draft goals visibly unavailable", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    expect(screen.getByRole("heading", { name: "探索真实表达" })).toBeInTheDocument();
    expect(screen.getByText("询问近况")).toBeInTheDocument();
    expect(screen.getByLabelText("请求重复，内容整理中")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "重复" } });
    expect(screen.queryByText("询问近况")).not.toBeInTheDocument();
    expect(screen.getByText("请求重复")).toBeInTheDocument();
  });

  it("opens a conditional rail with one route-backed primary action", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("button", { name: "查看咖啡馆里的新朋友详情，可开始" }));
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("Sueño 原创");
    expect(screen.getByRole("link", { name: "开始这组内容" })).toHaveAttribute("href", "/explore/packs/published-pack");
    expect(screen.getAllByRole("link", { name: "开始这组内容" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭内容详情" }));
    expect(screen.queryByTestId("explore-detail-rail")).not.toBeInTheDocument();
  });

  it("shows an honest blocked state for a draft pack", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("button", { name: "查看周末市场详情，内容整理中" }));
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("完成审核后开放");
    expect(screen.getByText("这组内容完成审核后会出现在这里。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "开始这组内容" })).not.toBeInTheDocument();
  });
});
