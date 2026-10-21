import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LearnPageContent } from "@/app/(product)/learn/learn-page-content";
import { LearnLibrarySkeleton } from "@/app/(product)/learn/learn-library-skeleton";
import LearnLoading from "@/app/(product)/learn/loading";
import type { MediaCard } from "@/src/modules/media";

const item: MediaCard = {
  id: "media.fixture.cafe@1",
  stableKey: "media.fixture.cafe",
  version: 1,
  kind: "video",
  title: "Una charla en el café",
  summary: "Una conversación cotidiana.",
  sourceName: "Canal ejemplo",
  language: "es",
  region: "es-ES",
  cefr: "A2",
  topics: ["topic.daily-life"],
  durationMs: 180_000,
  publishedAt: "2026-09-12T08:00:00.000Z",
  curatedAt: "2026-09-13T08:00:00.000Z",
  contentHash: "a".repeat(64),
  progress: null,
};

afterEach(cleanup);

describe("LearnPage", () => {
  it("opens directly on the honest media library without the former task UI", () => {
    render(<LearnPageContent query={{}} result={{ items: [], nextCursor: null, hasMore: false }} />);

    // The former marketing heading and the topic pills are gone; the shelf shows
    // channels, search and an honest empty state instead.
    expect(screen.queryByRole("heading", { name: "看点、听点真实西语" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeInTheDocument();
    expect(screen.queryByText(/开始第一次练习|继续学习|当前沟通目标|练习任务时间线/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /开始|继续/ })).not.toBeInTheDocument();
  });

  it("exposes direct type navigation, search and the compact filter and sort controls", () => {
    render(<LearnPageContent query={{ kind: "podcast", topic: "current-events", cefr: "B1" }} result={{ items: [], nextCursor: null, hasMore: false }} />);

    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("navigation", { name: "学习主题" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();
    // The applied state lives in the trigger's accessible name and count badge
    // instead of a sentence of its own; the clear action sits with the fields
    // it resets, inside the panel.
    const filterTrigger = screen.getByRole("button", { name: "筛选，已应用 1 个条件" });
    expect(filterTrigger).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "排序" })).toHaveValue("recently_added");
    expect(screen.queryByRole("link", { name: "清除筛选" })).not.toBeInTheDocument();
    fireEvent.click(filterTrigger);
    expect(screen.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/learn?kind=podcast");
    // The range filters arrive in that same panel and carry the URL selection.
    expect(screen.getByRole("combobox", { name: "地区" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "难度" })).toHaveValue("B1");
    expect(screen.getByRole("combobox", { name: "时长" })).toBeInTheDocument();
  });

  it("renders every eligible item as an equal-weight direct content link", () => {
    render(<LearnPageContent query={{}} result={{ items: [item, { ...item, id: "media.fixture.radio@1", stableKey: "media.fixture.radio", kind: "podcast", title: "Radio de barrio" }], nextCursor: null, hasMore: false }} />);

    expect(screen.getByRole("link", { name: /Una charla en el café/ })).toHaveAttribute("href", "/learn/media/media.fixture.cafe");
    expect(screen.getByRole("link", { name: /Radio de barrio/ })).toHaveAttribute("href", "/learn/media/media.fixture.radio");
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("makes a data outage explicit without fabricating content", () => {
    render(<LearnPageContent unavailable query={{}} result={{ items: [], nextCursor: null, hasMore: false }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("媒体资料库暂时无法读取");
    expect(screen.queryByText("内容准备中")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "媒体资料库正在准备中" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("reserves the header slots the loaded library fills, without a drawn search icon", () => {
    const { container } = render(<LearnLibrarySkeleton />);

    const header = container.querySelector(".media-library__topbar");
    expect(header).not.toBeNull();
    expect(header?.querySelector(".media-library__toolbar--loading")).not.toBeNull();
    expect(container.querySelectorAll(".media-library__toolbar--loading > span")).toHaveLength(2);
    // The skeleton search field is placeholders only; a drawn magnifier used to
    // sit there and read as a stray icon next to an almost empty box.
    expect(container.querySelector(".media-library__search-loading-icon")).toBeNull();
    expect(header?.querySelector(".media-library__search--loading")).not.toBeNull();
  });

  it("keeps the adaptive card grid in the in-page library skeleton", () => {
    const { container } = render(<LearnLibrarySkeleton />);

    expect(container.querySelector('[data-testid="learn-loading"]')).not.toBeNull();
    expect(container.querySelector(".media-grid--loading")).not.toBeNull();
    expect(container.querySelectorAll(".media-card--skeleton").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the route-level loading shell neutral so entering a media page never flashes the library grid", () => {
    const { container } = render(<LearnLoading />);

    const shell = container.querySelector('[data-testid="learn-loading"]');
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".media-library__topbar")).not.toBeNull();
    expect(container.querySelector(".media-grid")).toBeNull();
    expect(container.querySelectorAll(".media-card")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("正在打开");
  });
});
