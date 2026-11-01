import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { phrasebookEntries } from "@/src/modules/lexicon-corpus/content/phrasebook-v4";
import { phrasebookEntries as originalEntries, phrasebookVersion } from "@/src/modules/lexicon-corpus/content/phrasebook-v1";
import review from "@/src/modules/lexicon-corpus/content/phrasebook-v1.review.json";
import { matchesPhrasebookSearch, phrasebookEntrySchema, phraseTopics } from "@/src/modules/lexicon-corpus/domain/phrasebook";
import { Phrasebook } from "@/src/modules/lexicon-corpus/ui/phrasebook";

const speech = vi.hoisted(() => ({ speakingId: null as string | null, errorMessage: "", clearError: vi.fn(), speak: vi.fn<(...args: unknown[]) => void>(), stop: vi.fn() }));
vi.mock("@/src/modules/providers/tts/use-read-aloud", () => ({ useReadAloud: () => speech }));

afterEach(() => { cleanup(); localStorage.clear(); speech.speakingId = null; vi.clearAllMocks(); });

describe("reviewed practical phrasebook", () => {
  it("ties this exact content version to separate approved language and teaching reviews", () => {
    const source = readFileSync("src/modules/lexicon-corpus/content/phrasebook-v1.ts", "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(review.sha256);
    expect(review.contentVersion).toBe(phrasebookVersion);
    expect(review.entryCount).toBe(originalEntries.length);
    expect(review.reviewerKind).toBe("ai");
    expect(review.reviews.map((item) => [item.locale, item.status, item.entryCount])).toEqual([["es-ES", "approved", 24], ["zh-CN", "approved", 24]]);
  });

  it("contains complete, unique, validated teaching entries for every topic", () => {
    expect(phrasebookEntries).toHaveLength(150);
    expect(new Set(phrasebookEntries.map((item) => item.id)).size).toBe(150);
    for (const entry of phrasebookEntries) expect(phrasebookEntrySchema.safeParse(entry).success).toBe(true);
    for (const topic of phraseTopics) expect(phrasebookEntries.filter((entry) => entry.topic === topic.id)).toHaveLength(25);
    expect(phrasebookEntrySchema.safeParse({ ...phrasebookEntries[0], dialogue: [] }).success).toBe(false);
  });

  it("finds expressions without requiring accents, including Chinese situations and alternative phrasing", () => {
    expect(matchesPhrasebookSearch(phrasebookEntries[0], "QUE tal")).toBe(true);
    expect(matchesPhrasebookSearch(phrasebookEntries[0], "近况")).toBe(true);
    expect(matchesPhrasebookSearch(phrasebookEntries[0], "como te va")).toBe(true);
    expect(matchesPhrasebookSearch(phrasebookEntries[0], "airport")).toBe(false);
  });

  it("opens on usable expressions with full original dialogue and no fragment/source controls", () => {
    render(<Phrasebook userId="owner" />);
    expect(screen.getByRole("heading", { name: "短语" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "¿Qué tal te va?" })).toBeVisible();
    expect(screen.getByText("Bastante bien. He empezado un trabajo nuevo.")).toBeVisible();
    expect(screen.queryByText("打开来源")).not.toBeInTheDocument();
    expect(screen.queryByText("释义与用法尚未审核")).not.toBeInTheDocument();
  });

  it("filters by purpose and search and gives a working reset for zero matches", async () => {
    const user = userEvent.setup(); render(<Phrasebook userId="owner" />);
    expect(screen.getByRole("button", { name: /没听懂时/u })).toHaveTextContent("25");
    await user.click(screen.getByRole("button", { name: /没听懂时/u }));
    expect(screen.getByRole("heading", { name: "¿Puedes repetirlo, por favor?" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "¿Qué tal te va?" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "搜索短语" }), "不可能找到的词");
    expect(screen.getByRole("heading", { name: "换个说法试试" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看全部表达" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("heading", { name: "¿Qué tal te va?" })).toBeVisible();
  });

  it("keeps saved entries per account and persists after remounting without API writes", async () => {
    const user = userEvent.setup(); const fetchSpy = vi.spyOn(globalThis, "fetch");
    const first = render(<Phrasebook userId="owner" />);
    await user.click(screen.getByRole("button", { name: "收藏 ¿Qué tal te va?" }));
    await user.click(screen.getByRole("button", { name: /我的收藏/u }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    first.unmount(); render(<Phrasebook userId="another" />);
    await user.click(screen.getByRole("button", { name: /我的收藏/u }));
    expect(screen.getByText("把想用的表达留在这里")).toBeVisible();
    cleanup(); render(<Phrasebook userId="owner" />);
    await user.click(screen.getByRole("button", { name: /我的收藏/u }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });

  it("hides Spanish in recall mode and reveals only on request", async () => {
    const user = userEvent.setup(); render(<Phrasebook userId="owner" initialSearch="最近过得怎么样" />);
    await user.click(screen.getByRole("button", { name: "遮住西语" }));
    const card = screen.getByRole("article");
    expect(within(card).queryByText("¿Qué tal te va?", { exact: true })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "揭晓表达" }));
    expect(within(card).getByRole("heading", { name: "¿Qué tal te va?" })).toBeVisible();
  });

  it("runs a scenario recall with optional references, no grading and no evidence request", async () => {
    const user = userEvent.setup(); render(<Phrasebook userId="owner" initialSearch="最近过得怎么样" />);
    await user.click(screen.getByRole("button", { name: /情境自测/u }));
    const practice = screen.getByRole("region", { name: "情境自测" });
    expect(within(practice).getByText(phrasebookEntries[0].prompt)).toBeVisible();
    expect(within(practice).queryByText("¿Qué tal te va?", { exact: true })).not.toBeInTheDocument();
    await user.click(within(practice).getByRole("button", { name: "查看参考表达" }));
    expect(within(practice).getByText(phrasebookEntries[0].replacement.es, { exact: true })).toBeVisible();
    await user.click(within(practice).getByRole("button", { name: "还想再练" }));
    expect(screen.getByRole("heading", { name: "给表达一个真实的使用机会" })).toBeVisible();
    expect(screen.getByText(/不计入能力评分/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "返回表达库" }));
    expect(screen.getByRole("searchbox")).toHaveValue("最近过得怎么样");
  });

  it("reads the revealed reference sentence, can stop it, and reads the core expression separately", async () => {
    const user = userEvent.setup();
    const view = render(<Phrasebook userId="owner" initialSearch="最近过得怎么样" />);
    await user.click(screen.getByRole("button", { name: "情境自测" }));
    expect(screen.queryByRole("button", { name: "朗读参考表达" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看参考表达" }));
    await user.click(screen.getByRole("button", { name: "朗读参考表达" }));
    expect(speech.speak).toHaveBeenLastCalledWith("practice-reference:connect-how-going", "¿Qué tal te va con el español?", expect.any(Function));
    speech.speakingId = "practice-reference:connect-how-going";
    view.rerender(<Phrasebook userId="owner" initialSearch="最近过得怎么样" />);
    expect(screen.getByRole("button", { name: "停止朗读参考表达" })).toHaveAttribute("aria-pressed", "true");
    speech.stop.mockClear();
    await user.click(screen.getByRole("button", { name: "停止朗读参考表达" }));
    expect(speech.stop).toHaveBeenCalledOnce();
    await user.click(screen.getByText("回看本条核心表达与用法"));
    await user.click(screen.getByRole("button", { name: "朗读核心表达" }));
    expect(speech.speak).toHaveBeenLastCalledWith("practice-core:connect-how-going", "¿Qué tal te va?", expect.any(Function));
    speech.stop.mockClear();
    await user.click(screen.getByRole("button", { name: "想到说法了" }));
    expect(speech.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "朗读参考表达" })).not.toBeInTheDocument();
  });

  it("reads each dialogue turn without Chinese and stops on repeat or closing the entry", async () => {
    const user = userEvent.setup();
    const view = render(<Phrasebook userId="owner" initialSearch="最近过得怎么样" />);
    await user.click(screen.getByRole("button", { name: "朗读对话第1句" }));
    expect(speech.speak).toHaveBeenLastCalledWith("dialogue:connect-how-going:0", "¡Hola! ¿Qué tal te va?", expect.any(Function));
    speech.speakingId = "dialogue:connect-how-going:0";
    view.rerender(<Phrasebook userId="owner" initialSearch="最近过得怎么样" />);
    expect(screen.getByRole("button", { name: "停止朗读对话第1句" })).toHaveAttribute("aria-pressed", "true");
    speech.stop.mockClear();
    await user.click(screen.getByRole("button", { name: "停止朗读对话第1句" }));
    expect(speech.stop).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "朗读对话第2句" }));
    expect(speech.speak).toHaveBeenLastCalledWith("dialogue:connect-how-going:1", "Bastante bien. He empezado un trabajo nuevo.", expect.any(Function));
    speech.stop.mockClear();
    await user.click(screen.getByRole("button", { name: "收起" }));
    expect(speech.stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "朗读对话第2句" })).not.toBeInTheDocument();
  });

  it("stops a dialogue when removing its entry from saved phrases, including external storage changes", async () => {
    const user = userEvent.setup();
    localStorage.setItem("sueno:phrasebook:v1:owner", JSON.stringify(["connect-how-going"]));
    const view = render(<Phrasebook userId="owner" />);
    await user.click(screen.getByRole("button", { name: /我的收藏/u }));
    speech.speakingId = "dialogue:connect-how-going:0";
    view.rerender(<Phrasebook userId="owner" />);
    speech.stop.mockClear();
    await user.click(screen.getByRole("button", { name: "取消收藏 ¿Qué tal te va?" }));
    expect(screen.getByText("把想用的表达留在这里")).toBeVisible();
    expect(speech.stop).toHaveBeenCalledOnce();
    speech.speakingId = null;
    cleanup();
    localStorage.setItem("sueno:phrasebook:v1:owner", JSON.stringify(["connect-how-going"]));
    const second = render(<Phrasebook userId="owner" />);
    await user.click(screen.getByRole("button", { name: /我的收藏/u }));
    speech.speakingId = "dialogue:connect-how-going:1";
    second.rerender(<Phrasebook userId="owner" />);
    speech.stop.mockClear();
    act(() => { localStorage.setItem("sueno:phrasebook:v1:owner", "[]"); window.dispatchEvent(new Event("storage")); });
    expect(screen.getByText("把想用的表达留在这里")).toBeVisible();
    expect(speech.stop).toHaveBeenCalledOnce();
  });

  it("offers clear feedback when browser speech or local saving is unavailable", async () => {
    const user = userEvent.setup(); render(<Phrasebook userId="owner" />);
    await user.click(screen.getByRole("button", { name: "朗读 ¿Qué tal te va?" }));
    const onUnsupported = speech.speak.mock.calls[0]?.[2] as (() => void);
    expect(onUnsupported).toBeTypeOf("function");
    act(() => onUnsupported());
    expect(screen.getByRole("status")).toHaveTextContent("当前浏览器不支持朗读");
    fireEvent(window, new Event("storage"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("disabled"); });
    await user.click(screen.getByRole("button", { name: "收藏 ¿Qué tal te va?" }));
    expect(screen.getByRole("status")).toHaveTextContent("无法保存收藏");
    vi.restoreAllMocks();
  });
});
