import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LearnPageContent } from "@/app/(product)/learn/learn-page-content";
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

  it("exposes direct type navigation, search, and practical filters", async () => {
    const user = userEvent.setup();
    render(<LearnPageContent query={{ kind: "podcast", cefr: "B1" }} result={{ items: [], nextCursor: null, hasMore: false }} />);

    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
    // The topic navigation was removed by product decision; the filters live in
    // the popover behind 筛选.
    expect(screen.queryByRole("navigation", { name: "学习主题" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    // The panel and the toolbar's screen-reader copy both carry the fields, so
    // the assertion targets the visible panel.
    const panel = screen.getByRole("heading", { name: "筛选内容" }).closest("div")?.parentElement ?? document.body;
    expect(within(panel).getByRole("combobox", { name: "地区" })).toBeInTheDocument();
    expect(within(panel).getByRole("combobox", { name: "难度" })).toHaveValue("B1");
    expect(within(panel).getByRole("combobox", { name: "时长" })).toBeInTheDocument();
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
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});
