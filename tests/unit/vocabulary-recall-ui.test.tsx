import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VocabularyShelf } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";
import { VocabularyShelfList, type VocabularyShelfItem } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf-list";

const speech = vi.hoisted(() => ({ stop: vi.fn(), speak: vi.fn() }));
vi.mock("@/src/modules/providers/tts", () => ({ useReadAloud: () => ({ ...speech, speakingId: null, errorMessage: "" }) }));
vi.mock("@/src/shared/ui/use-media-query", () => ({ useMediaQuery: () => false, wordPanelSheetQuery: "(max-width: 600px)" }));

const items: readonly VocabularyShelfItem[] = [
  { id: "word:casa", markKey: "casa", text: "casa", meaning: "房子、家", context: null, source: null },
  { id: "word:tambien", markKey: "tambien", text: "también", meaning: "也", context: null, source: null },
  { id: "word:otro", markKey: "otro", text: "otro", meaning: "其他的", context: null, source: null },
  { id: "word:missing", markKey: "missing", text: "missing", meaning: null, context: null, source: null },
];
const dictionary = { casa: ["房子、家", "住所"], tambien: ["也"], otro: ["其他的"] };

function shelf(scope: string, marks: Record<string, string> = { casa: "familiar", tambien: "familiar", otro: "learning", missing: "familiar" }) {
  window.localStorage.setItem(`sueno:vocabulary-status:v1:${scope}`, JSON.stringify(marks));
  return render(<VocabularyShelf storageScope={scope} glossary={{}} dictionary={dictionary} total={4} bands={[]} ranked={false}
    controls={<label>搜索词表<input aria-label="搜索词表" defaultValue="" /></label>}>
    <VocabularyShelfList items={items} ranked={false} total={4} />
  </VocabularyShelf>);
}

describe("vocabulary shelf recall", () => {
  beforeEach(() => { window.localStorage.clear(); speech.speak.mockClear(); speech.stop.mockClear(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("celebrates independently correct answers and exposes distinct, accessible correction feedback", async () => {
    const user = userEvent.setup();
    shelf("recall-feedback", { casa: "familiar", tambien: "familiar" });
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    const first = screen.getByRole("textbox", { name: "第 1 个词的西语答案" });
    const second = screen.getByRole("textbox", { name: "第 2 个词的西语答案" });
    await user.type(first, "casa{Enter}");
    expect(screen.getByText("答对了！")).toBeInTheDocument();
    expect(first).toHaveAccessibleDescription("答对了！");
    expect(first).not.toHaveAttribute("aria-invalid", "true");
    expect(second).toHaveFocus();
    await user.type(second, "tambien{Enter}");
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(second).toHaveAccessibleDescription(expect.stringContaining("重音有误"));
    expect(screen.getByText("é", { selector: "mark" })).toBeInTheDocument();
    await user.clear(second);
    expect(second).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("重音有误")).not.toBeInTheDocument();
    await user.type(second, "wrong{Enter}");
    expect(screen.getByText("需要复习", { selector: ".vocabulary-recall__result-label" })).toBeInTheDocument();
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(second).toHaveAccessibleDescription(expect.stringContaining("también"));
    await user.click(screen.getByRole("button", { name: "看单词写释义" }));
    const meaning = screen.getByRole("textbox", { name: "casa 的中文释义" });
    await user.type(meaning, "居所{Enter}");
    expect(meaning).not.toHaveAttribute("aria-invalid", "true");
    expect(meaning).toHaveFocus();
    expect(meaning).toHaveAccessibleDescription(expect.stringContaining("待确认"));
    expect(screen.getByRole("button", { name: "我的意思正确" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "需要复习" }));
    expect(screen.getByText("自行标为需复习")).toBeInTheDocument();
    expect(meaning).toHaveAttribute("aria-invalid", "true");
  });

  it("distinguishes hinted and self-confirmed success from an independent celebration", async () => {
    const user = userEvent.setup();
    shelf("recall-feedback-hints", { casa: "familiar" });
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    await user.click(screen.getByRole("button", { name: "查看答案" }));
    await user.type(screen.getByRole("textbox"), "casa{Enter}");
    expect(screen.getByText("正确", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("已使用提示")).toBeInTheDocument();
    expect(screen.queryByText("答对了！")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看单词写释义" }));
    await user.type(screen.getByRole("textbox"), "居所{Enter}");
    await user.click(screen.getByRole("button", { name: "我的意思正确" }));
    expect(screen.getByText("自行确认正确")).toBeInTheDocument();
    expect(screen.queryByText("答对了！")).not.toBeInTheDocument();
  });

  it("replaces only eligible known words in their existing rows and restores the shelf on exit", async () => {
    const user = userEvent.setup();
    shelf("recall-placement");
    const tile = document.querySelector<HTMLElement>('[data-word="casa"]')!;
    const row = tile.parentElement!;
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    expect(tile).not.toBeVisible();
    expect(within(row).getByRole("textbox")).toHaveAttribute("placeholder", "填写西语单词");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByText("已跳过 1 个缺释义的已知词。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "otro其他的" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "点词自动发音" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "搜索词表" })).not.toBeInTheDocument();
    fireEvent.mouseOver(screen.getByRole("button", { name: "otro其他的" }));
    await user.click(screen.getByRole("button", { name: "otro其他的" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(speech.speak).not.toHaveBeenCalled();
    expect(speech.stop).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "退出默写" }));
    expect(tile).toBeVisible();
    expect(screen.queryByPlaceholderText("填写西语单词")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索词表" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "点词自动发音" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "看释义写单词" })).toHaveFocus();
    expect(JSON.parse(window.localStorage.getItem("sueno:vocabulary-status:v1:recall-placement")!)).toMatchObject({ casa: "familiar", tambien: "familiar" });
  });

  it("grades only on submission, ignores IME Enter, distinguishes accents and retries mistakes", async () => {
    const user = userEvent.setup();
    shelf("recall-check");
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    const first = screen.getByRole("textbox", { name: "第 1 个词的西语答案" });
    await user.type(first, "CASA");
    fireEvent.keyDown(first, { key: "Enter", isComposing: true });
    expect(first).toHaveFocus();
    expect(screen.queryByText("答对了！", { exact: true })).not.toBeInTheDocument();
    fireEvent.keyDown(first, { key: "Enter", keyCode: 229 });
    expect(first).toHaveFocus();
    expect(screen.queryByText("答对了！", { exact: true })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(screen.getByText("答对了！", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "第 2 个词的西语答案" })).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: "第 2 个词的西语答案" }), "tambien");
    await user.click(screen.getByRole("button", { name: "批改" }));
    expect(screen.getByText("重音有误")).toBeInTheDocument();
    expect(document.querySelector(".vocabulary-recall__summary")).toHaveTextContent("独立匹配 1");
    await user.click(screen.getByRole("button", { name: "重练错词" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText("重音有误")).not.toBeInTheDocument();
  });

  it("keeps blank Enter in place, skips filled words, wraps and stays when all answers are filled", async () => {
    const user = userEvent.setup();
    shelf("recall-navigation", { casa: "familiar", tambien: "familiar", otro: "familiar" });
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    const first = screen.getByRole("textbox", { name: "第 1 个词的西语答案" });
    const second = screen.getByRole("textbox", { name: "第 2 个词的西语答案" });
    const third = screen.getByRole("textbox", { name: "第 3 个词的西语答案" });
    await user.type(first, "  {Enter}");
    expect(first).toHaveFocus();
    expect(within(first.parentElement!.parentElement!).getByText("未作答", { exact: true })).toBeInTheDocument();
    await user.type(second, "también");
    await user.clear(first);
    await user.type(first, "wrong{Enter}");
    expect(third).toHaveFocus();
    expect(within(second.parentElement!.parentElement!).queryByText("正确", { exact: true })).not.toBeInTheDocument();
    await user.clear(first);
    await user.type(third, "otro{Enter}");
    expect(first).toHaveFocus();
    await user.type(first, "casa{Enter}");
    expect(first).toHaveFocus();
  });

  it("keeps pending Chinese answers focused and advances after a matched meaning", async () => {
    const user = userEvent.setup();
    shelf("recall-meaning-navigation");
    await user.click(screen.getByRole("button", { name: "看单词写释义" }));
    const first = screen.getByRole("textbox", { name: "casa 的中文释义" });
    const second = screen.getByRole("textbox", { name: "también 的中文释义" });
    await user.type(first, "居所{Enter}");
    expect(first).toHaveFocus();
    expect(screen.getByText("待确认", { exact: true })).toBeInTheDocument();
    await user.clear(first);
    await user.type(first, "家{Enter}");
    expect(second).toHaveFocus();
    await user.type(second, "也{Enter}");
    expect(second).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    await user.type(screen.getByRole("textbox", { name: "第 1 个词的西语答案" }), "casa{Enter}");
    expect(screen.getByRole("textbox", { name: "第 2 个词的西语答案" })).toHaveFocus();
  });

  it("focuses only mounted retry inputs and releases them on exit and restart", async () => {
    const user = userEvent.setup();
    shelf("recall-retry-navigation", { casa: "familiar", tambien: "familiar", otro: "familiar" });
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    await user.type(screen.getByRole("textbox", { name: "第 1 个词的西语答案" }), "casa{Enter}");
    await user.type(screen.getByRole("textbox", { name: "第 2 个词的西语答案" }), "wrong{Enter}");
    await user.click(screen.getByRole("button", { name: "重练错词" }));
    const retryFirst = screen.getByRole("textbox", { name: "第 1 个词的西语答案" });
    const retrySecond = screen.getByRole("textbox", { name: "第 2 个词的西语答案" });
    await user.type(retryFirst, "también{Enter}");
    expect(retrySecond).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "退出默写" }));
    expect(retrySecond).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    await user.type(screen.getByRole("textbox", { name: "第 1 个词的西语答案" }), "casa{Enter}");
    expect(screen.getByRole("textbox", { name: "第 2 个词的西语答案" })).toHaveFocus();
  });

  it("keeps separate mode progress and labels uncertain Chinese answers for explicit self-confirmation", async () => {
    const user = userEvent.setup();
    shelf("recall-modes", { casa: "familiar" });
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    await user.type(screen.getByRole("textbox"), "casa");
    await user.click(screen.getByRole("button", { name: "批改" }));
    await user.click(screen.getByRole("button", { name: "看单词写释义" }));
    expect(screen.getByRole("textbox", { name: "casa 的中文释义" })).toHaveValue("");
    expect(document.querySelector('[data-word="casa"] .vocabulary-study__word-meaning')).not.toBeVisible();
    expect(document.querySelector(".vocabulary-recall__roller-front")).toHaveAttribute("aria-hidden", "true");
    await user.type(screen.getByRole("textbox"), "居所");
    await user.click(screen.getByRole("button", { name: "批改" }));
    expect(screen.getByText("待确认", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "我的意思正确" }));
    expect(screen.getByText("自行确认正确")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("独立匹配 0 · 自行确认 1");
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    expect(screen.getByRole("textbox")).toHaveValue("casa");
    expect(screen.getByRole("status")).toHaveTextContent("独立匹配 1");
  });

  it("tracks answer reveals and corrections after feedback as prompted, with no network or evidence writes", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, "fetch");
    shelf("recall-hints", { casa: "familiar" });
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    await user.click(screen.getByRole("button", { name: "查看答案" }));
    await user.type(screen.getByRole("textbox"), "casa");
    await user.click(screen.getByRole("button", { name: "批改" }));
    expect(screen.getByText("已使用提示")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("独立匹配 0");
    expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "重练错词" }));
    await user.type(screen.getByRole("textbox"), "x");
    await user.click(screen.getByRole("button", { name: "批改" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "casa");
    await user.click(screen.getByRole("button", { name: "批改" }));
    expect(screen.getByText("已使用提示")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("独立匹配 0");
  });

  it("reports no known words and releases portals and original visibility on unmount", async () => {
    const user = userEvent.setup();
    const empty = shelf("recall-empty", {});
    await user.click(screen.getByRole("button", { name: "看释义写单词" }));
    expect(screen.getByRole("status")).toHaveTextContent("先把认识的词标为已知");
    empty.unmount();
    const view = shelf("recall-unmount", { casa: "familiar" });
    const tile = document.querySelector<HTMLElement>('[data-word="casa"]')!;
    await user.click(screen.getByRole("button", { name: "看单词写释义" }));
    expect(tile.hidden).toBe(true);
    view.unmount();
    expect(tile.hidden).toBe(false);
    expect(screen.queryByPlaceholderText("填写中文释义")).not.toBeInTheDocument();
  });

  it("finishes the exit rotation before restoring words, and cancels its timer on unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const view = shelf("recall-motion", { casa: "familiar" });
    const tile = document.querySelector<HTMLElement>('[data-word="casa"]')!;
    fireEvent.click(screen.getByRole("button", { name: "看释义写单词" }));
    fireEvent.click(screen.getByRole("button", { name: "退出默写" }));
    expect(document.querySelector(".vocabulary-recall__roller")).toHaveClass("is-exiting");
    expect(tile.hidden).toBe(true);
    expect(screen.getByRole("button", { name: "看单词写释义" })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(460); });
    expect(tile.hidden).toBe(false);
    expect(screen.queryByPlaceholderText("填写西语单词")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "看释义写单词" }));
    fireEvent.click(screen.getByRole("button", { name: "退出默写" }));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
