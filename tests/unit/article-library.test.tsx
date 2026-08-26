import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ReadShelf } from "@/app/(product)/read/read-shelf";
import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";

const result: ArticleListResult = {
  articles: [],
  totalCount: 0,
  topics: ["topic.daily-life", "topic.relationships"],
  nextCursor: null,
  hasMore: false,
  savedFilterAvailable: false,
};

const article: ArticleCardProjection = {
  id: "article.test@1",
  stableKey: "article.test",
  version: 1,
  locale: "es-ES",
  title: "Una historia breve",
  summary: "Una historia para probar el guardado.",
  cefr: "A2",
  topics: ["topic.daily-life"],
  region: "es-ES",
  register: "neutral",
  format: "story",
  estimatedReadingMinutes: 4,
  sourceName: "Sueño Editorial",
  author: null,
  publicationDate: "2026-08-26",
  assets: { audio: false, chineseSummary: false, wordHelp: false, image: false },
  oralTransferType: "summary",
};

describe("article library shelf", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows Readlang source tabs and explains the empty public library", async () => {
    const user = userEvent.setup();
    render(<ReadShelf result={result} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Public Texts" })).toHaveAttribute("href", "/read");
    expect(screen.getByText("0 texts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Texts" })).toHaveAttribute("href", "/read?saved=1");
    expect(screen.queryByRole("heading", { name: "找到你现在关心的方向" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Generate Story/ }));
    expect(screen.getByText("Generate Story 当前仅保留入口；生成内容需要经过内容审核后才会进入文章库。")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "My Texts" }));
    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
  });

  it("saves and unsaves an article from the shelf star", async () => {
    const user = userEvent.setup();
    let saved = false;
    const fetchMock = vi.fn((_: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      json: async () => {
        if (init?.method === "POST") {
          saved = Boolean(JSON.parse(String(init.body)).saved);
          return { data: { articleId: article.id, saved } };
        }
        return { data: { articleIds: [] } };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    const saveButton = await screen.findByRole("button", { name: `保存到 My Texts：${article.title}` });
    await user.click(saveButton);
    await waitFor(() => expect(screen.getByRole("button", { name: `从 My Texts 移除：${article.title}` })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: `从 My Texts 移除：${article.title}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `保存到 My Texts：${article.title}` })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/saved", expect.objectContaining({ method: "POST" }));
  });

  it("renders numbered pages and preserves reading filters", () => {
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 25, hasMore: true }} page={2} pageSize={12} search="vida" topic="topic.daily-life" cefr="A2" minutes="short" source="public" sort="newest" savedOnly={false} />);

    expect(screen.getByRole("navigation", { name: "Article pages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/read?search=vida&topic=topic.daily-life&cefr=A2&minutes=short&sort=newest");
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/read?page=3&search=vida&topic=topic.daily-life&cefr=A2&minutes=short&sort=newest");
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
  });
});
