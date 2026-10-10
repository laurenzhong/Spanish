import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CorpusSearch } from "@/src/modules/lexicon-corpus/ui/corpus-search";

// B4 regression: the corpus search form used to send only `query`, so the page
// could never leave the API's first page even though the API supports
// `page`/`pageSize` and returns `page`/`pageSize`/`total`.

function corpusItem(index: number) {
  return {
    leftContext: "Hoy",
    keyword: "casa",
    rightContext: "grande",
    sourceTitle: `Fuente ${index}`,
    sourceKind: "media",
    document: { kind: "media" as const, stableKey: `media.${index}`, version: 1 },
    location: { kind: "media" as const, startMs: 1_000, endMs: 2_000, segmentIndex: index },
  };
}

function corpusResponse(page: number, pageSize: number, total: number, count: number) {
  const firstIndex = (page - 1) * pageSize;
  return new Response(JSON.stringify({
    data: { items: Array.from({ length: count }, (_, offset) => corpusItem(firstIndex + offset)), page, pageSize, total },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function requestUrl(call: number): URL {
  const fetchMock = vi.mocked(globalThis.fetch);
  return new URL(String(fetchMock.mock.calls[call]?.[0]), "http://localhost");
}

async function searchFor(user: ReturnType<typeof userEvent.setup>, term: string, documentKind?: string) {
  await user.type(screen.getByRole("textbox", { name: /搜索词或短语/ }), term);
  if (documentKind) await user.selectOptions(screen.getByRole("combobox", { name: /来源/ }), documentKind);
  await user.click(screen.getByRole("button", { name: "查询" }));
}

describe("corpus search pagination", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sends the first page with the query and the selected filter", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(corpusResponse(1, 20, 45, 20));
    render(<CorpusSearch />);

    await searchFor(user, "casa", "media");

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const url = requestUrl(0);
    expect(url.pathname).toBe("/api/v1/corpus/search");
    expect(url.searchParams.get("query")).toBe("casa");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("documentKind")).toBe("media");
    expect(await screen.findByText("第 1 / 3 页")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });

  it("pages forward without losing the query or the filter, and back again", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(corpusResponse(1, 20, 45, 20))
      .mockResolvedValueOnce(corpusResponse(2, 20, 45, 20))
      .mockResolvedValueOnce(corpusResponse(1, 20, 45, 20));
    render(<CorpusSearch />);

    await searchFor(user, "dar cuenta", "article");
    await screen.findByText("第 1 / 3 页");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(requestUrl(1).searchParams.get("page")).toBe("2");
    expect(requestUrl(1).searchParams.get("query")).toBe("dar cuenta");
    expect(requestUrl(1).searchParams.get("documentKind")).toBe("article");
    expect(await screen.findByText("第 2 / 3 页")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    expect(requestUrl(2).searchParams.get("page")).toBe("1");
    expect(requestUrl(2).searchParams.get("query")).toBe("dar cuenta");
    expect(requestUrl(2).searchParams.get("documentKind")).toBe("article");
    expect(await screen.findByText("第 1 / 3 页")).toBeInTheDocument();
  });

  it("disables paging on the last page and starts a new search on page one", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(corpusResponse(3, 20, 45, 5))
      .mockResolvedValueOnce(corpusResponse(1, 20, 3, 3));
    render(<CorpusSearch />);

    await searchFor(user, "casa");
    await screen.findByText("第 3 / 3 页");
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: /搜索词或短语/ }));
    await user.type(screen.getByRole("textbox", { name: /搜索词或短语/ }), "parque");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(requestUrl(1).searchParams.get("page")).toBe("1");
    expect(requestUrl(1).searchParams.get("query")).toBe("parque");
    expect(await screen.findByText("找到 3 条出现记录")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "语料分页" })).not.toBeInTheDocument();
  });

  it("keeps the empty and error states explicit", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(corpusResponse(1, 20, 0, 0))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    render(<CorpusSearch />);

    await searchFor(user, "nada");
    expect(await screen.findByText("没有找到同时包含这些词的内容。")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "语料分页" })).not.toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: /搜索词或短语/ }));
    await user.type(screen.getByRole("textbox", { name: /搜索词或短语/ }), "casa");
    await user.click(screen.getByRole("button", { name: "查询" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("语料库暂时不可用，请稍后再试。");
  });
});
