import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CorpusWorkbench } from "@/src/modules/lexicon-corpus/ui/corpus-workbench";
import { corpusExamplesQuerySchema, type CorpusExampleItem } from "@/src/modules/lexicon-corpus/schemas/corpus-examples";

const speech = vi.hoisted(() => ({ speakingId: null as string | null, errorMessage: "", speak: vi.fn(), stop: vi.fn(), clearError: vi.fn() }));
vi.mock("@/src/modules/providers/tts/use-read-aloud", () => ({ useReadAloud: () => speech }));

const item = (index = 0): CorpusExampleItem => ({ id: `article:one:1:${index}`, text: `A veces tomo café con Ana. ${index}`, translation: "有时我和安娜喝咖啡。", before: "¿Qué haces por la tarde?", after: "Luego vuelvo a casa.", sourceTitle: `Una charla ${index}`, sourceName: "Una fuente", contentKind: "article", document: { kind: "article", stableKey: "article.one", version: 1 }, location: { kind: "text", paragraphId: `segment-${index}`, segmentIndex: index } });
const response = (items = [item()], page = 1, total = items.length) => new Response(JSON.stringify({ data: { items, page, pageSize: 12, total } }), { status: 200 });
const initial = corpusExamplesQuerySchema.parse({});
function url(index: number) { return new URL(String(vi.mocked(fetch).mock.calls[index]?.[0]), "http://localhost"); }

describe("real corpus examples workspace", () => {
  beforeEach(() => { window.history.replaceState(null, "", "/read/corpus"); vi.clearAllMocks(); speech.speakingId = null; speech.errorMessage = ""; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("browses complete original text, existing translation and neighboring context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CorpusWorkbench initialState={initial} />);
    expect(await screen.findByText(item().text, { selector: ".corpus-example__text" })).toBeInTheDocument();
    expect(url(0).pathname).toBe("/api/v1/corpus/examples");
    expect(screen.getByText(item().translation!)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "隐藏译文" }));
    expect(screen.queryByText(item().translation!)).not.toBeInTheDocument();
    await user.click(screen.getByText("展开前后文"));
    expect(screen.getByText(item().before!)).toBeVisible();
    expect(screen.getByText(item().after!)).toBeVisible();
    expect(screen.getByRole("link", { name: /读原文：/ })).toHaveAttribute("href", "/read/article/article.one%401#segment-0");
    expect(screen.getByRole("link", { name: /读原文：/ })).toHaveAttribute("target", "_blank");
  });

  it("submits search, filters immediately, highlights original offsets and preserves URL pagination", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
      const query = new URL(String(request), "http://localhost");
      return response([item()], Number(query.searchParams.get("page")), 25);
    });
    render(<CorpusWorkbench initialState={initial} />);
    await screen.findByText(item().text, { selector: ".corpus-example__text" });
    await user.type(screen.getByRole("searchbox", { name: "搜索西语单词或短语" }), "cafe");
    await user.click(screen.getByRole("button", { name: "查用法" }));
    await waitFor(() => expect(url(1).searchParams.get("query")).toBe("cafe"));
    expect(await screen.findByText("café", { selector: "mark" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "用例内容类型" })).getByRole("button", { name: "视频" }));
    await waitFor(() => expect(url(2).searchParams.get("contentKind")).toBe("video"));
    await user.click(screen.getByRole("button", { name: "同段包含全部词" }));
    await waitFor(() => expect(url(3).searchParams.get("match")).toBe("all"));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("第 2 / 3 页");
    expect(url(4).searchParams.get("query")).toBe("cafe");
    expect(window.location.search).toContain("page=2");
    expect(speech.stop).toHaveBeenCalled();
  });

  it("restores query and filters on history navigation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    render(<CorpusWorkbench initialState={initial} />);
    await screen.findByText(item().text, { selector: ".corpus-example__text" });
    act(() => { window.history.replaceState(null, "", "/read/corpus?q=quedar&contentKind=podcast&match=all&page=3"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(url(1).searchParams.get("page")).toBe("3"));
    expect(screen.getByRole("searchbox")).toHaveValue("quedar");
    expect(url(1).searchParams.get("contentKind")).toBe("podcast");
  });

  it("shows a complete matching sentence from long articles and speaks and compares that sentence", async () => {
    const user = userEvent.setup();
    const sentence = "Por eso, María toma café antes de salir.";
    const original = "La vida cotidiana de la ciudad cambia con las estaciones y con las costumbres de sus habitantes. ".repeat(5) + sentence;
    const long = { ...item(), text: original, translation: null };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response([long]));
    render(<CorpusWorkbench initialState={{ ...initial, query: "por eso" }} />);
    const list = await screen.findByLabelText("真实用例");
    expect(list.querySelector(".corpus-example__text")).toHaveTextContent(sentence);
    expect(list.querySelector(".corpus-example__text")?.textContent).toBe(sentence);
    await user.click(within(list).getByRole("button", { name: `朗读：${sentence}` }));
    expect(speech.speak).toHaveBeenLastCalledWith(`example:${long.id}`, sentence, expect.any(Function));
    await user.click(within(list).getByRole("button", { name: "加入对照" }));
    expect(within(screen.getByRole("region", { name: "用例对照" })).getByText(sentence)).toBeVisible();
    await user.click(within(list).getByText("展开前后文"));
    expect(within(list).getByText(original, { exact: true })).toBeVisible();
  });

  it("preserves a translated paragraph as a whole so its translation remains aligned", async () => {
    const long = { ...item(), text: "Por eso, María toma café antes de salir. ".repeat(15) };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response([long]));
    render(<CorpusWorkbench initialState={{ ...initial, query: "por eso" }} />);
    expect((await screen.findByLabelText("真实用例")).querySelector(".corpus-example__text")?.textContent).toBe(long.text);
    expect(screen.getByText(long.translation!)).toBeInTheDocument();
  });

  it("compares up to three original examples and removes them without writes", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response([item(0), item(1), item(2), item(3)]));
    render(<CorpusWorkbench initialState={initial} />);
    await screen.findByText(item().text, { selector: ".corpus-example__text" });
    for (let index = 0; index < 4; index++) await user.click(screen.getAllByRole("button", { name: "加入对照" })[0]);
    expect(screen.getByText("最多同时对照3条，请先移除一条。")).toBeInTheDocument();
    const comparison = screen.getByRole("region", { name: "用例对照" });
    expect(within(comparison).getAllByRole("article")).toHaveLength(3);
    await user.click(within(comparison).getByRole("button", { name: "移除对照：Una charla 0" }));
    expect(within(comparison).getAllByRole("article")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "清空对照" }));
    expect(screen.queryByRole("region", { name: "用例对照" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not describe an out-of-range page as an empty corpus", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response([], 9, 25)).mockResolvedValueOnce(response([item()], 1, 25));
    render(<CorpusWorkbench initialState={{ ...initial, page: 9, query: "cafe" }} />);
    expect(await screen.findByRole("heading", { name: "这一页没有用例" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回第一页" }));
    await waitFor(() => expect(url(1).searchParams.get("page")).toBe("1"));
    expect(url(1).searchParams.get("query")).toBe("cafe");
  });

  it("speaks only original Spanish and supports stop and unsupported feedback", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const view = render(<CorpusWorkbench initialState={initial} />);
    await screen.findByText(item().text, { selector: ".corpus-example__text" });
    await user.click(screen.getByRole("button", { name: `朗读：${item().text}` }));
    expect(speech.speak).toHaveBeenCalledWith(`example:${item().id}`, item().text, expect.any(Function));
    act(() => speech.speak.mock.calls[0][2]());
    expect(screen.getByRole("alert")).toHaveTextContent("不支持合成朗读");
    speech.speakingId = `example:${item().id}`;
    view.rerender(<CorpusWorkbench initialState={initial} />);
    await user.click(screen.getByRole("button", { name: `停止：${item().text}` }));
    expect(speech.stop).toHaveBeenCalled();
  });

  it("keeps prior results on failure, retries the same query and rejects malformed payloads", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    render(<CorpusWorkbench initialState={initial} />);
    await screen.findByText(item().text, { selector: ".corpus-example__text" });
    await user.click(screen.getByRole("button", { name: "按原词序" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上一组结果仍保留");
    expect(screen.getByText(item().text, { selector: ".corpus-example__text" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "同段包含全部词" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取");
  });

  it("ignores stale resolved fetches after a later query", async () => {
    const pending: ((value: Response) => void)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    render(<CorpusWorkbench initialState={initial} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cafe" } });
    fireEvent.submit(screen.getByRole("button", { name: "查用法" }).closest("form")!);
    await act(async () => pending[1](response([{ ...item(), sourceTitle: "NEW" }])));
    expect(screen.getByText("NEW")).toBeInTheDocument();
    await act(async () => pending[0](response([{ ...item(), sourceTitle: "STALE" }])));
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });

  it("turns timeouts into a recoverable error and releases the request on unmount", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_request, init) => new Promise((_resolve, reject) => { signal = init?.signal as AbortSignal; signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
    const view = render(<CorpusWorkbench initialState={initial} />);
    await act(async () => vi.advanceTimersByTime(20_001));
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法读取");
    expect(signal?.aborted).toBe(true);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
