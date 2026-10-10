import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...props}>{children}</a>,
}));

import { SavedItemsLibrary } from "@/src/modules/reading/ui/saved-items-library";

const item = {
  id: "00000000-0000-4000-8000-000000000010",
  articleId: "article.saved@2",
  stableKey: "article.saved",
  version: 2,
  title: "Una historia",
  sourceName: "Sueño Editorial",
  sourceUrl: "https://example.test/story",
  itemType: "phrase" as const,
  text: "de repente",
  position: 3,
  context: "Llegó de repente a casa.",
  createdAt: "2026-09-26T00:00:00.000Z",
};

const savedArticle = {
  articleId: "article.saved@2",
  stableKey: "article.saved",
  version: 2,
  title: "Una historia guardada",
  sourceName: "Sueño Editorial",
  sourceUrl: "https://example.test/story",
  itemType: "article" as const,
  origin: "public" as const,
  saved: true,
  createdAt: "2026-09-26T00:00:00.000Z",
};

const privateStory = {
  articleId: "article.private@1",
  stableKey: "article.private",
  version: 1,
  title: "Un cuento privado",
  sourceName: "Sueño Story Bot",
  sourceUrl: null,
  itemType: "article" as const,
  origin: "generated" as const,
  saved: false,
  createdAt: "2026-09-25T00:00:00.000Z",
};

describe("saved reading items library", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("renders context, source, filters and a stable article anchor", () => {
    render(<SavedItemsLibrary items={[item]} total={1} page={1} pageSize={24} search="" />);
    expect(screen.getByRole("heading", { name: "已保存" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "de repente" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "Llegó de repente a casa.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到原文/ })).toHaveAttribute("href", "/read/article/article.saved%402#segment-3");
    expect(screen.getByRole("link", { name: /查看来源/ })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("exposes 全部 / 文章 / 保存词语 / 短语 / 高亮 tabs", () => {
    render(<SavedItemsLibrary items={[item]} total={1} page={1} pageSize={24} search="" />);
    const tabs = within(screen.getByRole("navigation", { name: "已保存内容类型" }));
    expect(tabs.getByRole("link", { name: "全部" })).toHaveAttribute("href", "/read/saved-items?pageSize=24");
    expect(tabs.getByRole("link", { name: "全部" })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: "文章" })).toHaveAttribute("href", "/read/saved-items?itemType=article&pageSize=24");
    expect(tabs.getByRole("link", { name: "保存词语 / 短语" })).toHaveAttribute("href", "/read/saved-items?itemType=phrase&pageSize=24");
    expect(tabs.getByRole("link", { name: "高亮" })).toHaveAttribute("href", "/read/saved-items?itemType=highlight&pageSize=24");

    cleanup();
    render(<SavedItemsLibrary items={[savedArticle]} total={1} page={1} pageSize={24} search="" itemType="article" />);
    expect(within(screen.getByRole("navigation", { name: "已保存内容类型" })).getByRole("link", { name: "文章" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Una historia guardada" })).toHaveAttribute("href", "/read/article/article.saved%402");
    expect(screen.getByText(/保存于/)).toBeInTheDocument();
  });

  it("shows private AI stories with a confirmation before deletion", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }));
    const user = userEvent.setup();
    render(<SavedItemsLibrary items={[privateStory]} total={1} page={1} pageSize={24} search="" itemType="article" />);
    expect(screen.getByText("私人 AI 故事")).toBeInTheDocument();
    expect(screen.getByText(/创建于/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /取消收藏/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除私人故事：Un cuento privado" }));
    expect(screen.getByRole("button", { name: "确认删除私人故事：Un cuento privado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Un cuento privado" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认删除私人故事：Un cuento privado" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Un cuento privado" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/generated-stories/article.private%401", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByRole("heading", { name: "还没有已保存的文章" })).toBeInTheDocument();
  });

  it("unsaves a saved article and drops it from the shelf", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { articleId: savedArticle.articleId, saved: false } }), { status: 200 }));
    const user = userEvent.setup();
    render(<SavedItemsLibrary items={[savedArticle, item]} total={2} page={1} pageSize={24} search="" />);

    await user.click(screen.getByRole("button", { name: "取消收藏：Una historia guardada" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Una historia guardada" })).not.toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/read/saved", expect.objectContaining({
      body: JSON.stringify({ articleId: savedArticle.articleId, saved: false }),
      method: "POST",
    }));
    // The saved words/phrases stay untouched by an article unsave.
    expect(screen.getByRole("heading", { name: "de repente" })).toBeInTheDocument();
  });

  it("uses browser speech synthesis without making an evidence request", async () => {
    const speak = vi.fn((utterance: { onstart?: (() => void) | null; onend?: (() => void) | null }) => {
      utterance.onstart?.();
      utterance.onend?.();
    });
    const cancel = vi.fn();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak, cancel, getVoices: () => [] } });
    class FakeUtterance {
      lang = "";
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public readonly text: string) {}
    }
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<SavedItemsLibrary items={[item]} total={1} page={1} pageSize={24} search="" />);
    await user.click(screen.getByRole("button", { name: "朗读 de repente" }));
    expect(speak).toHaveBeenCalledOnce();
    expect((speak.mock.calls[0]?.[0] as FakeUtterance).text).toBe("de repente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes an item only after explicit confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }));
    const user = userEvent.setup();
    render(<SavedItemsLibrary items={[item]} total={1} page={1} pageSize={24} search="" />);
    await user.click(screen.getByRole("button", { name: "移除" }));
    expect(screen.getByRole("button", { name: "确认移除" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "de repente" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "de repente" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "还没有已保存内容" })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(`/api/v1/read/saved-items/${item.id}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("keeps the type tabs and filters visible when the shelf is unavailable", () => {
    render(<SavedItemsLibrary items={[]} total={0} page={1} pageSize={24} search="" unavailable />);
    expect(screen.getByRole("navigation", { name: "已保存内容类型" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存内容暂时不可用" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not claim the shelf is empty on a page past the end", () => {
    render(<SavedItemsLibrary items={[]} total={12} page={2} pageSize={24} search="" />);
    expect(screen.getByRole("heading", { name: "这一页没有内容" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "还没有已保存内容" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute("href", "/read/saved-items?pageSize=24");
  });

  it("does not mutate a different article version in local reader state", async () => {
    const staleState = {
      stableKey: item.stableKey,
      version: item.version - 1,
      contentHash: "a".repeat(64),
      savedPhrases: [{ id: `${item.position}:${item.text}`, text: item.text, position: item.position }],
      highlights: [],
    };
    window.localStorage.setItem(`reading-reader:v1:${item.stableKey}`, JSON.stringify(staleState));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }));
    const user = userEvent.setup();
    render(<SavedItemsLibrary items={[item]} total={1} page={1} pageSize={24} search="" />);

    await user.click(screen.getByRole("button", { name: "移除" }));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: item.text })).not.toBeInTheDocument());

    expect(window.localStorage.getItem(`reading-reader:v1:${item.stableKey}`)).toBe(JSON.stringify(staleState));
  });
});
