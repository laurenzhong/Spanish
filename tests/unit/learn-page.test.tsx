import { cleanup, render, screen } from "@testing-library/react";
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

    expect(screen.getByRole("heading", { name: "看点、听点真实西语" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeInTheDocument();
    expect(screen.queryByText(/开始第一次练习|继续学习|当前沟通目标|练习任务时间线/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /开始|继续/ })).not.toBeInTheDocument();
  });

  it("exposes direct type navigation, search, and practical filters", () => {
    render(<LearnPageContent query={{ kind: "podcast", topic: "current-events", cefr: "B1" }} result={{ items: [], nextCursor: null, hasMore: false }} />);

    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "学习主题" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "时事新闻" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();
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
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});
