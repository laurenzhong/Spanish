import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, onClick, prefetch, ...props }: { children: ReactNode; onClick?: MouseEventHandler<HTMLAnchorElement>; prefetch?: boolean | null } & Record<string, unknown>) => (
    <a {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }} data-prefetch={prefetch === true ? "full" : prefetch === false ? "disabled" : "auto"}>{children}</a>
  ),
}));

import { ReadShelf } from "@/app/(product)/read/read-shelf";
import { ToastProvider } from "@/src/shared/ui/toast";
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
    window.localStorage.clear();
  });

  it("keeps the public shelf to one compact tool row with no personal tabs", () => {
    render(<ReadShelf result={result} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);

    expect(screen.getByRole("heading", { name: "可公开阅读的文章正在准备中" })).toBeInTheDocument();
    // Personal content lives on /read/saved-items now, so the shelf must not
    // carry any tab of its own.
    expect(screen.queryByRole("link", { name: "公共文章" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "我的文章" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "我的文章书架" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ 篇$/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Web Sites" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "找到你现在关心的方向" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索文章" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "排序" })).toBeInTheDocument();
    expect(screen.getByText("添加内容", { selector: "summary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "生成私人故事" })).toHaveAttribute("href", "/read/generate");
    expect(screen.getByRole("link", { name: "查看已保存" })).toHaveAttribute("href", "/read/saved-items");
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
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);

    const saveButton = await screen.findByRole("button", { name: `收藏文章：${article.title}` });
    await user.click(saveButton);
    await waitFor(() => expect(screen.getByRole("button", { name: `取消收藏：${article.title}` })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: `取消收藏：${article.title}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `收藏文章：${article.title}` })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/saved", expect.objectContaining({ method: "POST" }));
  });

  it("uses compact numbered pagination and preserves reading filters", () => {
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 105, hasMore: true }} page={5} pageSize={12} search="vida" topic="topic.daily-life" cefr="A2" minutes="short" source="public" sort="newest" />);

    const pagination = screen.getByRole("navigation", { name: "文章分页" });
    expect(pagination).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "显示更多" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute("href", "/read?page=4&search=vida&topic=topic.daily-life&cefr=A2&minutes=short&sort=newest");
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/read?page=6&search=vida&topic=topic.daily-life&cefr=A2&minutes=short&sort=newest");
    expect(screen.getByLabelText("第 5 页，当前页")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "第 1 页" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第 9 页" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "第 2 页" })).not.toBeInTheDocument();
    expect(pagination.querySelectorAll(".read-pagination__ellipsis")).toHaveLength(2);
  });









  it("makes the article title region the only reading link", () => {
    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);

    expect(screen.getByRole("link", { name: article.title })).toHaveAttribute("href", `/read/article/${encodeURIComponent(article.id)}`);
    expect(screen.getByRole("link", { name: article.title })).toHaveAttribute("title", article.title);
    expect(screen.queryByText(article.summary)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /打开文章/u })).not.toBeInTheDocument();
  });

  it("dismisses shelf menus on outside click or Escape and keeps them mutually exclusive", async () => {
    const user = userEvent.setup();
    render(<ReadShelf result={result} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);

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

  it("labels a card from the reader's progress fetched after the shelf paints", async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/v1/read/progress"
        ? {
          apiVersion: "v1",
          data: {
            progress: [{ articleId: article.id, lastOpenedAt: "2026-10-10T10:00:00.000Z", position: 4, status: "completed" }],
          },
        }
        : { data: { articleIds: [] } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);

    // Reading progress is decoration: the shelf renders first and the label
    // arrives with the response, so per-user reads never hold the list open.
    expect(screen.getByText("未开始")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("已读")).toBeInTheDocument());
    expect(await screen.findByText("已读")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/progress", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("keeps the device's own state when the progress response is unusable", async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve({
      ok: url !== "/api/v1/read/progress",
      json: async () => (url === "/api/v1/read/progress" ? { apiVersion: "v1", data: { progress: "not-an-array" } } : { data: { articleIds: [] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/progress", expect.anything()));
    // A failed fetch leaves the honest local default instead of breaking the shelf.
    expect(screen.getByText("未开始")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: article.title })).toBeInTheDocument();
  });

  it("offers undo for a reversible save toggle through the toast layer", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/v1/read/saved"
        ? { apiVersion: "v1", data: { saved: JSON.parse(String(init?.body)).saved } }
        : { data: { articleIds: [] } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `收藏文章：${article.title}` }));
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("已收藏。");

    // Undo re-issues the same server action with the previous value instead of
    // leaving the reader with a dead-end confirmation.
    fireEvent.click(within(toast).getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/read/saved",
      expect.objectContaining({ body: JSON.stringify({ articleId: article.id, saved: false }) }),
    ));
  });

  it("reverts a save exactly once and never offers the reader a second undo", async () => {
    const posts: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/read/saved" && init?.method === "POST") posts.push(String(init.body));
      return Promise.resolve({
        ok: true,
        json: async () => (url === "/api/v1/read/saved"
          ? { apiVersion: "v1", data: { articleId: article.id, saved: JSON.parse(String(init?.body)).saved } }
          : { data: { articleIds: [] } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `收藏文章：${article.title}` }));
    const toast = await screen.findByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "撤销" }));

    await waitFor(() => expect(posts).toHaveLength(2));
    // Exactly one reversal request, carrying the reverted value.
    expect(posts[1]).toBe(JSON.stringify({ articleId: article.id, saved: false }));
    expect(posts.filter((body) => body === JSON.stringify({ articleId: article.id, saved: false }))).toHaveLength(1);

    // The undo must close the toast without pushing another one: a second toast
    // carrying another "撤销" is what let the reader ping-pong forever.
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `收藏文章：${article.title}` })).toBeInTheDocument();
  });

  it("keeps the undo button pending until a slow reversal resolves", async () => {
    const posts: string[] = [];
    let resolveUndo: (() => void) | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      if (url !== "/api/v1/read/saved" || init?.method !== "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ data: { articleIds: [] } }) });
      }
      const body = JSON.parse(String(init.body)) as { saved: boolean };
      posts.push(String(init.body));
      const response = {
        ok: true,
        json: async () => ({ apiVersion: "v1", data: { articleId: article.id, saved: body.saved } }),
      };
      // The reversal is deliberately slow, so the pending state stays visible.
      return body.saved ? Promise.resolve(response) : new Promise((resolve) => { resolveUndo = () => resolve(response); });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <ReadShelf result={{ ...result, articles: [article], totalCount: 1 }} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="public" sort="hot" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `收藏文章：${article.title}` }));
    const toast = await screen.findByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "撤销" }));

    const pendingAction = await within(toast).findByRole("button", { name: "撤销中…" });
    expect(pendingAction).toBeDisabled();
    expect(posts).toEqual([
      JSON.stringify({ articleId: article.id, saved: true }),
      JSON.stringify({ articleId: article.id, saved: false }),
    ]);

    // Still in flight: a repeated click must not issue a second request, and the
    // toast may not offer another undo either.
    fireEvent.click(pendingAction);
    expect(posts).toHaveLength(2);
    expect(within(toast).queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();

    await act(async () => { resolveUndo?.(); });

    // Only a settled reversal closes the toast.
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: `收藏文章：${article.title}` })).toBeInTheDocument();
  });

  it("reads no private state on the Web Sites tab", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ data: { articleIds: [] } }) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReadShelf result={result} page={1} pageSize={12} search="" topic="" cefr="" minutes="" source="web" sort="hot" />);

    expect(await screen.findByRole("heading", { name: "外部网站暂未开放" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
