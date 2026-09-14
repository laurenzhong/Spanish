import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MediaLibrary } from "@/src/modules/media";

afterEach(cleanup);

describe("media library", () => {
  it("shows an honest empty library without task-style learning actions", () => {
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    expect(screen.getByRole("heading", { name: "学习媒体库" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "播客" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索视频和播客" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "媒体资料库正在准备中" })).toBeInTheDocument();
    expect(screen.queryByText(/开始第一次练习|继续学习|学习任务时间线/)).not.toBeInTheDocument();
  });

  it("renders equal-weight direct content links and real resume state", () => {
    render(<MediaLibrary result={{
      items: [{
        id: "media.fixture.cafe@1", stableKey: "media.fixture.cafe", version: 1, kind: "podcast",
        title: "Café de cada día", summary: "Charlas cortas.", sourceName: "Radio ejemplo",
        language: "es", region: "es-ES", cefr: "B1", topics: ["topic.daily-life"], durationMs: 600_000,
        publishedAt: "2026-09-12T08:00:00.000Z", curatedAt: "2026-09-13T08:00:00.000Z",
        contentHash: "a".repeat(64),
        progress: { lastPositionMs: 120_000, lastSegmentIndex: 4, status: "in_progress", revision: 2 },
      }], nextCursor: "next", hasMore: true,
    }} query={{ kind: "podcast" }} />);
    expect(screen.getByRole("link", { name: /Café de cada día/ })).toHaveAttribute("href", "/learn/media/media.fixture.cafe");
    expect(screen.getByText("继续 · 02:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "加载更多" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "暂无封面：Café de cada día" })).toBeInTheDocument();
  });

  it("renders a real artwork URL with its accessible alt text", () => {
    render(<MediaLibrary result={{ items: [{
      id: "media.fixture.video@1", stableKey: "media.fixture.video", version: 1, kind: "video",
      title: "Una conversación", summary: "", sourceName: "Canal", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 60_000,
      publishedAt: null, curatedAt: "2026-09-13T08:00:00.000Z", contentHash: "b".repeat(64),
      artwork: { url: "https://images.example.test/video.jpg", alt: "Una conversación", source: "youtube", width: 1280, height: 720, expiresAt: null }, progress: null,
    }], nextCursor: null, hasMore: false }} query={{}} />);
    expect(screen.getByRole("img", { name: "Una conversación" })).toHaveAttribute("src", "https://images.example.test/video.jpg");
  });

  it("opens a keyboard-accessible filter panel and restores focus on cancel", async () => {
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<MediaLibrary result={{ items: [], nextCursor: null, hasMore: false }} query={{}} />);
    const trigger = screen.getByRole("button", { name: "筛选" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "筛选内容" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "地区" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(trigger).toHaveFocus();
  });
});
