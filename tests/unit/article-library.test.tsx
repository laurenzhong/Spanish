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

  it("explains the empty published library and exposes topic filters", async () => {
    const user = userEvent.setup();
    render(<ReadShelf result={result} search="" topic="" savedOnly={false} />);

    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "daily life" })).toHaveAttribute("href", "/read?topic=topic.daily-life");
    await user.click(screen.getByRole("link", { name: "已保存" }));
    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
  });
});
