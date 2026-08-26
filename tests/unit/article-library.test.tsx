import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ReadShelf } from "@/app/(product)/read/read-shelf";
import type { ArticleListResult } from "@/src/modules/content/domain";

const result: ArticleListResult = {
  articles: [],
  topics: ["topic.daily-life", "topic.relationships"],
  nextCursor: null,
  hasMore: false,
  savedFilterAvailable: false,
};

describe("article library shelf", () => {
  afterEach(() => cleanup());

  it("shows Readlang source tabs and explains the empty public library", async () => {
    const user = userEvent.setup();
    render(<ReadShelf result={result} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Public Texts" })).toHaveAttribute("href", "/read");
    expect(screen.getByRole("link", { name: "My Texts" })).toHaveAttribute("href", "/read?saved=1");
    expect(screen.queryByRole("heading", { name: "找到你现在关心的方向" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Generate Story/ }));
    expect(screen.getByText("Generate Story 当前仅保留入口；生成内容需要经过内容审核后才会进入文章库。")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "My Texts" }));
    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
  });
});
