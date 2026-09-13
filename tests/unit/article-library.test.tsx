import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ReadShelf } from "@/app/(product)/read/read-shelf";
import { filterArticles, type ArticleCardProjection, type ArticleListResult } from "@/src/modules/content/domain";

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

  it("keeps the shelf header to two sources, a passive count, and one compact tool row", () => {
    render(<ReadShelf result={result} visibleCount={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "公共文章" })).toHaveAttribute("href", "/read");
    expect(screen.getByText("0 篇")).not.toHaveAttribute("role", "button");
    expect(screen.getByRole("link", { name: "我的文章" })).toHaveAttribute("href", "/read?saved=1");
    expect(screen.queryByRole("link", { name: "Web Sites" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "找到你现在关心的方向" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索文章" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "排序" })).toBeInTheDocument();
    expect(screen.getByText("添加内容", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "生成私人故事" })).toHaveAttribute("href", "/read/generate");
    expect(screen.queryByText(/Upload Text or Audio/u)).not.toBeInTheDocument();
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
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} visibleCount={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    const saveButton = await screen.findByRole("button", { name: `收藏文章：${article.title}` });
    await user.click(saveButton);
    await waitFor(() => expect(screen.getByRole("button", { name: `取消收藏：${article.title}` })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: `取消收藏：${article.title}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `收藏文章：${article.title}` })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/saved", expect.objectContaining({ method: "POST" }));
  });

  it("uses one show-more action and preserves reading filters", () => {
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 25, hasMore: true }} visibleCount={12} search="vida" topic="topic.daily-life" cefr="A2" minutes="short" source="public" sort="newest" savedOnly={false} />);

    expect(screen.queryByRole("navigation", { name: "Article pages" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "显示更多" })).toHaveAttribute("href", "/read?visible=24&search=vida&topic=topic.daily-life&cefr=A2&minutes=short&sort=newest");
  });

  it("keeps server-filtered My Texts on the same show-more path", () => {
    const generatedArticle = { ...article, id: "generated.private@1", stableKey: "generated.private", title: "Mi cuento", origin: "generated" as const, generatedAt: new Date("2026-09-12T00:00:00.000Z") };
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 25, hasMore: true, savedFilterAvailable: true }} visibleCount={24} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly initialReaderProgress={{}} generatedArticles={[generatedArticle]} />);

    expect(screen.getByRole("link", { name: "显示更多" })).toHaveAttribute("href", "/read?visible=25&saved=1");
    expect(screen.getByText("26 篇")).toBeInTheDocument();
  });

  it("requires confirmation before deleting a private story", async () => {
    const user = userEvent.setup();
    const generatedArticle = { ...article, id: "generated.private@1", stableKey: "generated.private", title: "Mi cuento", origin: "generated" as const, generatedAt: new Date("2026-09-12T00:00:00.000Z") };
    const confirmMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/v1/read/saved" ? { data: { articleIds: [] } } : { data: {} },
      status: 200,
      init,
    }));
    vi.stubGlobal("confirm", confirmMock);
    vi.stubGlobal("fetch", fetchMock);
    render(<ReadShelf result={result} visibleCount={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly generatedArticles={[generatedArticle]} />);

    const deleteButton = screen.getByRole("button", { name: `删除私人故事：${generatedArticle.title}` });
    await user.click(deleteButton);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("generated-stories"), expect.anything());
    expect(deleteButton).toBeInTheDocument();

    await user.click(deleteButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: `删除私人故事：${generatedArticle.title}` })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/read/generated-stories/${encodeURIComponent(generatedArticle.id)}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("removes a server-filtered saved article immediately after unsaving it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      json: async () => init?.method === "POST"
        ? { data: { articleId: article.id, saved: false } }
        : { data: { articleIds: [article.id] } },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1, savedFilterAvailable: true }} visibleCount={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly />);

    await user.click(await screen.findByRole("button", { name: `取消收藏：${article.title}` }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "还没有收藏文章" })).toBeInTheDocument());
    expect(screen.getByText("0 篇")).toBeInTheDocument();
  });

  it("makes the article title region the only reading link", () => {
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} visibleCount={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    expect(screen.getByRole("link", { name: article.title })).toHaveAttribute("href", `/read/article/${encodeURIComponent(article.id)}`);
    expect(screen.getByRole("link", { name: article.title })).toHaveAttribute("title", article.title);
    expect(screen.queryByText(article.summary)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /打开文章/u })).not.toBeInTheDocument();
  });

  it("dismisses shelf menus on outside click or Escape and keeps them mutually exclusive", async () => {
    const user = userEvent.setup();
    render(<ReadShelf result={result} visibleCount={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" savedOnly={false} />);

    const filter = screen.getByText("筛选", { selector: "summary" }).closest("details");
    const add = screen.getByText("添加内容", { selector: "summary" }).closest("details");
    expect(filter).not.toBeNull();
    expect(add).not.toBeNull();

    await user.click(screen.getByText("筛选", { selector: "summary" }));
    expect(filter).toHaveAttribute("open");
    await user.click(screen.getByText("添加内容", { selector: "summary" }));
    expect(filter).not.toHaveAttribute("open");
    expect(add).toHaveAttribute("open");

    await user.click(document.body);
    expect(add).not.toHaveAttribute("open");

    await user.click(screen.getByText("筛选", { selector: "summary" }));
    await user.keyboard("{Escape}");
    expect(filter).not.toHaveAttribute("open");
  });

  it("filters saved IDs before applying pagination", () => {
    const filtered = filterArticles([article, { ...article, id: "article.other@1", stableKey: "article.other", title: "Otra historia" }], {
      savedOnly: true,
      savedArticleIds: [article.id],
      pageSize: 12,
    });

    expect(filtered.articles.map((item) => item.id)).toEqual([article.id]);
    expect(filtered.totalCount).toBe(1);
    expect(filtered.savedFilterAvailable).toBe(true);
  });
});
