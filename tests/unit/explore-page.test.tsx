import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExploreDashboardDto } from "@/src/modules/explore/domain";
import type { ExploreLibraryDto } from "@/src/modules/explore/domain/explore-library";
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

const library: ExploreLibraryDto = {
  privateState: "available",
  scenarios: [{
    stableKey: "scenario.campus-administration",
    title: "校园办事：注册与材料",
    description: "在学校行政窗口说明来意。",
    cefr: "A2",
    region: "es-ES",
    category: "study",
    categoryLabel: "学习办事",
    role: "校园行政工作人员",
    communicationGoal: "说明来意并确认材料",
    expressionTexts: ["Quisiera entregar estos documentos."],
    sourceKind: "public",
    route: "/explore/scenarios/scenario.campus-administration",
  }],
  expressions: [
    { id: "formal-1", text: "¿Cómo va todo?", translation: "一切都怎么样？", intent: "轻松询问近况", cefr: "A1", region: "es-ES", category: "start", categoryLabel: "开始交流", sourceKind: "formal", saved: false, saveSource: { sourceType: "formal-expression", expressionKey: "start.como-va-todo", version: 1 } },
    { id: "saved-1", text: "¿Me puede ayudar?", translation: "您能帮我吗？", intent: null, cefr: null, region: null, category: "saved", categoryLabel: "我的收藏", sourceKind: "saved", saved: true, savedExpressionId: "saved-1", generationSource: { sourceType: "saved-expression", sourceId: "saved-1" } },
    { id: "reading-1", text: "Necesito más información.", translation: null, intent: "来自你的阅读选区", cefr: null, region: null, category: "reading", categoryLabel: "阅读来源", sourceKind: "reading", saved: false, saveSource: { sourceType: "reading-selection", highlightId: "reading-1" }, generationSource: { sourceType: "reading", sourceId: "reading-1" } },
    { id: "review-1", text: "Quisiera explicarlo mejor.", translation: null, intent: "来自已确认的近期表达问题", cefr: null, region: null, category: "recent-error", categoryLabel: "近期难点", sourceKind: "recent-error", saved: false, saveSource: { sourceType: "scenario-review", reviewId: "review-1" }, generationSource: { sourceType: "recent-error", sourceId: "review-1" } },
  ],
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
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps search above three compact choices and previews an explainable scenario", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      apiVersion: "v1",
      data: {
        requestId: "request-1234",
        suggestionSessionId: "session-1234",
        scenario: {
          stableKey: "scenario.campus-administration",
          title: "校园办事：注册与材料",
          description: "在学校行政窗口说明来意。",
          cefr: "A2",
          category: "study",
          categoryLabel: "学习办事",
          role: "校园行政工作人员",
          communicationGoal: "说明来意并确认材料",
          sourceKind: "public",
          route: "/explore/scenarios/scenario.campus-administration",
        },
        reasons: [{ code: "level-match", text: "适合你当前的 A2 难度。" }],
        eligibleCount: 3,
        canSwap: true,
        limitReached: false,
        fallback: null,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    render(<ExplorePageContent dashboard={dashboard} />);

    const heading = screen.getByRole("heading", { name: "探索真实表达" });
    expect(heading).toHaveClass("sr-only");
    expect(screen.queryByRole("link", { name: "练习历史" })).not.toBeInTheDocument();
    expect(screen.queryByText("选择辅助")).not.toBeInTheDocument();
    expect(screen.queryByText("暂时不知道练什么？")).not.toBeInTheDocument();
    expect(screen.queryByText("根据可信学习状态和收藏表达推荐")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /适合我的/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /探索新场景/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /随机来一个/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /适合我的/ }));

    expect(await screen.findByRole("heading", { name: "校园办事：注册与材料" })).toBeInTheDocument();
    expect(screen.getByText("适合你当前的 A2 难度。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "开始练习" })).toHaveAttribute("href", "/explore/scenarios/scenario.campus-administration");
    expect(screen.getByRole("button", { name: "换一个" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/explore/scenario-suggestions", expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
  });

  it("keeps a recovery path when no eligible scenario exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      apiVersion: "v1",
      data: {
        requestId: "request-1234",
        suggestionSessionId: "session-1234",
        scenario: null,
        reasons: [],
        eligibleCount: 0,
        canSwap: false,
        limitReached: false,
        fallback: { canGeneratePersonalScenario: false, topicChips: ["日常生活", "学习办事", "社交沟通"] },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ExplorePageContent dashboard={dashboard} />);

    fireEvent.click(screen.getByRole("button", { name: /随机来一个/ }));
    expect(await screen.findByText("暂时没有合适的现成场景")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "学习办事" }));
    expect(screen.getByRole("searchbox")).toHaveValue("学习办事");
  });

  it("ignores a stale response after the user chooses another mode", async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    let resolveSecond: ((value: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecond = resolve; }));
    const responseFor = (stableKey: string, title: string) => new Response(JSON.stringify({
      apiVersion: "v1",
      data: { requestId: `request-${stableKey}`, suggestionSessionId: "session-1234", scenario: { stableKey, title, description: "可开始的场景。", cefr: "A2", category: "daily-life", categoryLabel: "日常生活", role: "临时对话者", communicationGoal: "完成沟通", sourceKind: "public", route: `/explore/scenarios/${stableKey}` }, reasons: [{ code: "safe-start", text: "适合作为一轮轻量基础练习。" }], eligibleCount: 2, canSwap: true, limitReached: false, fallback: null },
    }), { status: 200, headers: { "content-type": "application/json" } });

    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("button", { name: /适合我的/ }));
    fireEvent.click(screen.getByRole("button", { name: /探索新场景/ }));
    await act(async () => { resolveSecond?.(responseFor("discover12", "新的场景")); });
    expect(await screen.findByRole("heading", { name: "新的场景" })).toBeInTheDocument();
    await act(async () => { resolveFirst?.(responseFor("bestfit12", "过期场景")); });
    expect(screen.getByRole("heading", { name: "新的场景" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "过期场景" })).not.toBeInTheDocument();
  });

  it("preserves the current result when swapping fails", async () => {
    const success = new Response(JSON.stringify({
      apiVersion: "v1",
      data: { requestId: "request-1234", suggestionSessionId: "session-1234", scenario: { stableKey: "scenario.safe", title: "保留的场景", description: "当前结果不会因网络错误消失。", cefr: "A2", category: "daily-life", categoryLabel: "日常生活", role: "临时对话者", communicationGoal: "完成沟通", sourceKind: "public", route: "/explore/scenarios/scenario.safe" }, reasons: [{ code: "safe-start", text: "适合作为一轮轻量基础练习。" }], eligibleCount: 2, canSwap: true, limitReached: false, fallback: null },
    }), { status: 200, headers: { "content-type": "application/json" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(success).mockRejectedValueOnce(new Error("offline"));
    render(<ExplorePageContent dashboard={dashboard} />);

    fireEvent.click(screen.getByRole("button", { name: /适合我的/ }));
    expect(await screen.findByRole("heading", { name: "保留的场景" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "换一个" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法选择场景");
    expect(screen.getByRole("heading", { name: "保留的场景" })).toBeInTheDocument();
  });

  it("defaults to scenarios and exposes only three content views", () => {
    render(<ExplorePageContent dashboard={dashboard} library={library} />);

    const views = screen.getByRole("tablist", { name: "探索内容" });
    expect(within(views).getAllByRole("tab")).toHaveLength(3);
    expect(within(views).getByRole("tab", { name: "场景" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument();
    expect(screen.queryByText("咖啡馆里的新朋友")).not.toBeInTheDocument();
    expect(screen.queryByText("询问近况")).not.toBeInTheDocument();

    fireEvent.click(within(views).getByRole("tab", { name: "表达" }));
    expect(screen.getByText("¿Cómo va todo?")).toBeInTheDocument();
    expect(screen.queryByText("校园办事：注册与材料")).not.toBeInTheDocument();

    fireEvent.click(within(views).getByRole("tab", { name: "内容包" }));
    expect(screen.getByRole("heading", { name: "咖啡馆里的新朋友" })).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument();
  });

  it("searches scenario metadata and Spanish expressions without requiring accents", () => {
    render(<ExplorePageContent dashboard={dashboard} library={library} />);
    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "como" } });
    expect(screen.getByText("¿Cómo va todo?")).toBeInTheDocument();
    expect(screen.queryByText("校园办事：注册与材料")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "场景" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "A2 entregar" } });
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument();
  });

  it("filters the library by source and preserves that state in the URL", () => {
    window.history.replaceState(null, "", "/explore");
    render(<ExplorePageContent dashboard={dashboard} library={library} />);
    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    expect(screen.queryByRole("button", { name: /^阅读来源/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选表达" }));
    fireEvent.click(screen.getByRole("button", { name: /^阅读来源/u }));
    expect(screen.getByText("Necesito más información.")).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("filter")).toBe("reading");

    fireEvent.click(screen.getByRole("tab", { name: "场景" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选场景" }));
    fireEvent.click(screen.getByRole("button", { name: /^可立即开始/u }));
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
    expect(screen.queryByText("Necesito más información.")).not.toBeInTheDocument();
  });

  it("offers one clear recovery action when the library has no matches", () => {
    render(<ExplorePageContent dashboard={dashboard} library={library} initialFilter="recent-error" initialQuery="不存在" />);
    expect(screen.getByText("没有匹配的表达")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索和筛选" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("¿Cómo va todo?")).toBeInTheDocument();
  });

  it("saves a formal expression through its server-verifiable reference", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: "v1", data: { id: "saved-new" } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<ExplorePageContent dashboard={dashboard} library={library} initialQuery="como" />);
    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    fireEvent.click(screen.getByRole("button", { name: "收藏表达：¿Cómo va todo?" }));

    expect(await screen.findByText("已收藏表达，不会产生学习证据。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消收藏：¿Cómo va todo?" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/expressions/saved", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"expressionKey":"start.como-va-todo"'),
    }));
  });

  it("opens a preselected generation path and restores focus when it closes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: "v1", data: { generationSources: { savedExpressions: [], readingHighlights: [], recentErrors: [] } } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ExplorePageContent dashboard={dashboard} library={library} initialFilter="reading" />);
    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    const card = screen.getByRole("heading", { name: "Necesito más información." }).closest("article");
    const trigger = within(card!).getByRole("button", { name: "用此表达生成场景：Necesito más información." });
    fireEvent.click(trigger);
    expect(screen.getByText("已从表达库选择")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /从阅读迁移/u })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "关闭私人场景生成" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens a conditional rail with one route-backed primary action", () => {
    const { container } = render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
    const save = screen.getByRole("button", { name: "保存咖啡馆里的新朋友" });
    fireEvent.click(save);
    expect(save).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("已保存到你的探索清单。")).toBeInTheDocument();
  });

  it("uses the server saved state instead of a conflicting legacy browser cache", () => {
    window.localStorage.setItem("explore-saved-packs:v1", JSON.stringify({
      "published-pack": false,
      "published-pack@v1": false,
    }));
    const savedDashboard: ExploreDashboardDto = {
      ...dashboard,
      packs: dashboard.packs.map((pack) => pack.stableKey === "published-pack"
        ? { ...pack, saved: true }
        : pack),
    };

    render(<ExplorePageContent dashboard={savedDashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));

    expect(screen.getByRole("button", { name: "取消保存咖啡馆里的新朋友" })).toHaveAttribute("aria-pressed", "true");
  });

  it("restores only a save change whose account sync failed", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));

    fireEvent.click(screen.getByRole("button", { name: "保存咖啡馆里的新朋友" }));
    expect(await screen.findByText("已保存在本设备，账号同步失败，可重试。")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("explore-pending-saved-packs:v2") ?? "{}"))
      .toMatchObject({ "published-pack@v1": true });

    cleanup();
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
    expect(await screen.findByRole("button", { name: "取消保存咖啡馆里的新朋友" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("clears a pending browser fallback after account sync succeeds", async () => {
    window.localStorage.setItem("explore-pending-saved-packs:v2", JSON.stringify({
      "published-pack@v1": false,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const savedDashboard: ExploreDashboardDto = {
      ...dashboard,
      packs: dashboard.packs.map((pack) => pack.stableKey === "published-pack"
        ? { ...pack, saved: true }
        : pack),
    };
    render(<ExplorePageContent dashboard={savedDashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));

    fireEvent.click(await screen.findByRole("button", { name: "保存咖啡馆里的新朋友" }));
    expect(await screen.findByText("已保存到你的探索清单，已同步到账号。")).toBeInTheDocument();
    expect(window.localStorage.getItem("explore-pending-saved-packs:v2")).toBeNull();
  });

  it("keeps the saved filter in the URL after selecting it", () => {
    window.history.replaceState(null, "", "/explore");
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选内容包" }));
    fireEvent.click(screen.getByRole("button", { name: "已保存内容包" }));
    expect(new URL(window.location.href).searchParams.get("saved")).toBe("1");
  });

  it("shows an honest blocked state for a draft pack", () => {
    render(<ExplorePageContent dashboard={dashboard} />);
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
    fireEvent.click(screen.getByRole("button", { name: "查看周末市场详情，内容整理中" }));
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("内容整理中");
    expect(screen.getByText("这组内容完成审核后会出现在这里。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "开始这组内容" })).not.toBeInTheDocument();
  });

  it("renders the resume rail for in-progress content and keeps unavailable content blocked", async () => {
    const statefulDashboard = { ...dashboard, packs: [...dashboard.packs, progressPack, unavailablePack], resume: [progressPack] };
    render(<ExplorePageContent dashboard={statefulDashboard} />);

    expect(screen.queryByRole("heading", { name: "继续探索" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
    fireEvent.click(screen.getByRole("button", { name: "查看办公室里的寒暄详情，继续中" }));
    expect(screen.getByRole("link", { name: "继续这组内容" })).toHaveAttribute("href", "/explore/packs/progress-pack");
    fireEvent.click(screen.getByRole("button", { name: "关闭内容详情" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("aria-label", "查看办公室里的寒暄详情，继续中"));

    fireEvent.click(screen.getByRole("button", { name: "查看地铁站问路详情，暂不可用" }));
    expect(screen.getByTestId("explore-detail-rail")).toHaveTextContent("暂不可用");
    expect(screen.getByText("这组内容暂时无法读取，请稍后重试。")).toBeInTheDocument();
  });

  it("shows only twelve expressions initially and reveals the rest with one action", () => {
    const manyExpressions: ExploreLibraryDto = {
      ...library,
      expressions: Array.from({ length: 14 }, (_, index) => ({
        ...library.expressions[0]!,
        id: `formal-${index}`,
        text: `Expresión ${index + 1}`,
      })),
    };
    render(<ExplorePageContent dashboard={dashboard} library={manyExpressions} />);
    fireEvent.click(screen.getByRole("tab", { name: "表达" }));

    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(12);
    const more = screen.getByRole("button", { name: "显示更多表达" });
    fireEvent.click(more);
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(14);
    expect(screen.queryByRole("button", { name: "显示更多表达" })).not.toBeInTheDocument();
  });
});
