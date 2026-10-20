import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** The bundle-backed half of the library, i.e. what the server can send without a private read. */
const publicLibrary: ExploreLibraryDto = {
  privateState: "loading",
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
  ],
};

/** The same page once the owned rows arrived: one personal scenario and one saved expression. */
const decoratedLibrary: ExploreLibraryDto = {
  privateState: "available",
  scenarios: [
    { stableKey: "personal.10000000-0000-4000-8000-000000000001", title: "药店沟通", description: "说明症状并询问用法。", cefr: "A2", region: "es-ES", category: "personal", categoryLabel: "私人场景", role: "药剂师", communicationGoal: "询问药物用法", expressionTexts: ["¿Cómo debo tomarlo?"], sourceKind: "personal", route: "/explore/scenarios/personal.10000000-0000-4000-8000-000000000001" },
    ...publicLibrary.scenarios,
  ],
  expressions: [
    ...publicLibrary.expressions,
    { id: "saved-1", text: "¿Me puede ayudar?", translation: "您能帮我吗？", intent: null, cefr: null, region: null, category: "saved", categoryLabel: "我的收藏", sourceKind: "saved", saved: true, savedExpressionId: "saved-1", generationSource: { sourceType: "saved-expression", sourceId: "saved-1" } },
  ],
};

const ownedDashboard: ExploreDashboardDto = {
  ...dashboard,
  userState: "available",
  packs: dashboard.packs.map((pack) => pack.stableKey === "published-pack" ? { ...pack, saved: true } : pack),
};

function privatePayload(library: ExploreLibraryDto = decoratedLibrary): Response {
  return new Response(JSON.stringify({ apiVersion: "v1", data: { ...ownedDashboard, library } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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

    const heading = screen.getByRole("heading", { name: "探索场景" });
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

  it("keeps scenarios as the default and exposes expressions and content packs as separate views", () => {
    render(<ExplorePageContent dashboard={dashboard} library={library} />);

    expect(screen.getByRole("tablist", { name: "探索内容" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "场景" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument();
    expect(screen.queryByText("咖啡馆里的新朋友")).not.toBeInTheDocument();
    expect(screen.queryByText("询问近况")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    expect(screen.getByRole("tab", { name: "表达" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("¿Cómo va todo?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏表达：¿Cómo va todo?" })).toBeInTheDocument();
    expect(screen.queryByText("校园办事：注册与材料")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "内容包" }));
    expect(screen.getByRole("tab", { name: "内容包" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("咖啡馆里的新朋友")).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument();
  });

  it("uses expressions as scenario search metadata without listing them separately", () => {
    render(<ExplorePageContent dashboard={dashboard} library={library} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "A2 entregar" } });
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
    expect(screen.queryByText("Quisiera entregar estos documentos.")).not.toBeInTheDocument();
  });

  it("filters only scenarios and preserves the available filter in the URL", () => {
    window.history.replaceState(null, "", "/explore");
    render(<ExplorePageContent dashboard={dashboard} library={library} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选场景" }));
    fireEvent.click(screen.getByRole("button", { name: /^可立即开始/u }));
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("filter")).toBe("available");
  });

  it("filters expression sources, restores focus, and grows the list in batches of twelve", () => {
    const expressions = Array.from({ length: 13 }, (_, index) => ({
      ...library.expressions[0]!,
      id: `formal-${index}`,
      text: `Expresión ${index + 1}`,
      saveSource: { sourceType: "formal-expression" as const, expressionKey: `expression.${index}`, version: 1 },
    }));
    render(<ExplorePageContent dashboard={dashboard} library={{ ...library, expressions }} initialView="expressions" />);

    expect(screen.getAllByRole("button", { name: /收藏表达：Expresión/u })).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
    expect(screen.getAllByRole("button", { name: /收藏表达：Expresión/u })).toHaveLength(13);

    const filterButton = screen.getByRole("button", { name: "筛选表达" });
    fireEvent.click(filterButton);
    fireEvent.click(screen.getByRole("button", { name: "正式表达" }));
    expect(screen.getByRole("button", { name: /正式表达.*移除筛选/u })).toBeInTheDocument();
    expect(filterButton).toHaveFocus();
  });

  it("saves a listed expression through the existing owner-scoped endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: "v1", data: { id: "saved-new" } }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<ExplorePageContent dashboard={dashboard} library={library} initialView="expressions" />);

    fireEvent.click(screen.getByRole("button", { name: "收藏表达：¿Cómo va todo?" }));
    expect(await screen.findByRole("button", { name: "已收藏：¿Cómo va todo?" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/expressions/saved", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });

  it("offers one clear recovery action when the library has no matches", () => {
    render(<ExplorePageContent dashboard={dashboard} library={library} initialQuery="不存在" />);
    expect(screen.getByText("没有匹配的场景")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索和筛选" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("校园办事：注册与材料")).toBeInTheDocument();
  });

  it("restores a legacy content-pack deep link and removes conflicting saved-expression state", () => {
    window.history.replaceState(null, "", "/explore?q=A2&pack=published-pack&saved=1&filter=reading");
    render(<ExplorePageContent dashboard={dashboard} library={library} initialQuery="A2" initialPack="published-pack" initialSaved initialFilter="reading" />);

    const params = new URL(window.location.href).searchParams;
    expect(params.get("q")).toBe("A2");
    expect(params.get("view")).toBe("packs");
    expect(params.get("pack")).toBe("published-pack");
    expect(params.has("saved")).toBe(false);
    expect(params.has("filter")).toBe(false);
    expect(screen.getByRole("tab", { name: "内容包" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("咖啡馆里的新朋友")).toBeInTheDocument();
  });
});

/**
 * The owned part of the library is fetched by this component after paint, so
 * the page no longer waits on it. These tests pin the three states the user can
 * be in: the read is in flight, it succeeded, it failed.
 */
describe("ExplorePageContent owned-data lifecycle", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the public scenarios while the owned read never settles", async () => {
    // A private read that never resolves is the whole point: nothing in this
    // component may wait for it before showing the public catalogue.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));

    render(<ExplorePageContent dashboard={dashboard} library={publicLibrary} userId="user-1" />);

    expect(screen.getByRole("link", { name: /校园办事/u })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "场景" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("没有匹配的场景")).not.toBeInTheDocument();
    // An owned read in flight is silent: the catalogue is not announced as partial.
    expect(screen.queryByText(/私人内容/u)).not.toBeInTheDocument();
  });

  it("does not claim 我的收藏 is empty while the owned read is in flight", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));

    render(<ExplorePageContent dashboard={dashboard} library={publicLibrary} userId="user-1" initialView="expressions" initialFilter="saved" />);

    expect(screen.getByText("正在加载你的收藏与阅读来源…")).toBeInTheDocument();
    expect(screen.queryByText("没有匹配的表达")).not.toBeInTheDocument();
    expect(screen.queryByText(/私人内容/u)).not.toBeInTheDocument();
  });

  it("has not read anything owned when no viewer is supplied", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    render(<ExplorePageContent dashboard={dashboard} library={publicLibrary} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /校园办事/u })).toBeInTheDocument();
  });

  it("merges the owned scenarios and saved expressions when the read arrives", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(privatePayload());

    const { container } = render(<ExplorePageContent dashboard={dashboard} library={publicLibrary} userId="user-1" />);

    expect(await screen.findByText("药店沟通")).toBeInTheDocument();
    expect(screen.queryByText(/私人内容/u)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".explore-scenario-grid > a")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    expect(screen.getByText("¿Me puede ayudar?")).toBeInTheDocument();
  });

  it("keeps the public catalogue and reports unavailable when the owned read fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503, headers: { "content-type": "application/json" } }));

    render(<ExplorePageContent dashboard={dashboard} library={publicLibrary} userId="user-1" />);

    expect(await screen.findByText("私人内容暂不可用，当前显示公共内容。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /校园办事/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "表达" }));
    expect(screen.getByRole("button", { name: "收藏表达：¿Cómo va todo?" })).toBeInTheDocument();
  });

  it("pages the pack filters by what they actually need: 可打开 is catalogue data, 已收藏 is owned", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    render(<ExplorePageContent dashboard={dashboard} library={publicLibrary} userId="user-1" initialView="packs" />);

    fireEvent.click(screen.getByRole("button", { name: "筛选内容包" }));
    fireEvent.click(screen.getByRole("button", { name: "可打开" }));
    expect(screen.getByText("咖啡馆里的新朋友")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "筛选内容包" }));
    fireEvent.click(screen.getByRole("button", { name: "已收藏" }));
    expect(screen.getByText("正在加载你的内容包状态…")).toBeInTheDocument();
    expect(screen.queryByText("没有匹配的内容包")).not.toBeInTheDocument();
  });
});
