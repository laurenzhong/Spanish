import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAloudFake as speech } from "../helpers/read-aloud-fake";

vi.mock("@/src/modules/providers/tts/read-aloud", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/modules/providers/tts/read-aloud")>(),
  createReadAloud: speech.create,
}));

import { ExpressionAssist } from "@/src/modules/conversation/ui/expression-assist";

const spanish = "Hoy estoy un poco cansado. ¿Quedamos otro día?";
const sourceText = "今天有点累，¿quedamos 改天？";
const props = () => ({ characterKey: "lucia" as const, characterVersion: 1, text: sourceText, onApply: vi.fn(), onAssisted: vi.fn(), onFocusInput: vi.fn() });
function response(text: string, attemptId: string) {
  return Response.json({ apiVersion: "v1", data: { text, attemptId } });
}

describe("chat expression assistance", () => {
  beforeEach(() => {
    speech.reset();
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as { attemptId: string };
      return response(spanish, body.attemptId);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  async function generate() {
    await userEvent.click(screen.getByRole("button", { name: "译成西语" }));
  }

  it("previews mixed input privately and only fills when explicitly asked", async () => {
    const callbacks = props();
    render(<ExpressionAssist {...callbacks} />);
    expect(fetch).not.toHaveBeenCalled();
    await generate();
    expect(await screen.findByText(spanish)).toHaveAttribute("lang", "es");
    expect(callbacks.onAssisted).toHaveBeenCalledOnce();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/v1/conversations/lucia/expression-assist", expect.objectContaining({
      method: "POST", credentials: "same-origin", cache: "no-store",
    }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ text: "今天有点累，¿quedamos 改天？", characterVersion: 1, attemptId: expect.any(String) });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "使用译文" }));
    expect(callbacks.onApply).toHaveBeenCalledExactlyOnceWith(spanish);
    expect(screen.queryByRole("region", { name: "翻译预览" })).not.toBeInTheDocument();
    expect(callbacks.onFocusInput).toHaveBeenCalledOnce();
  });

  it("reads only the Spanish through shared read aloud and stops on source edits", async () => {
    const callbacks = props();
    const view = render(<ExpressionAssist {...callbacks} />);
    await generate();
    await screen.findByText(spanish);
    await userEvent.click(screen.getByRole("button", { name: "听一遍" }));
    expect(speech.attempts[0]).toMatchObject({ text: spanish, lang: "es-ES", rate: 1 });
    view.rerender(<ExpressionAssist {...callbacks} text={`${sourceText}!`} />);
    expect(speech.cancel).toHaveBeenCalled();
    expect(screen.queryByText(spanish)).not.toBeInTheDocument();
  });

  it("cancels closing requests and discards late results even if fetch ignores abort", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const callbacks = props();
    render(<ExpressionAssist {...callbacks} />);
    await generate();
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    await userEvent.click(screen.getByRole("button", { name: "取消翻译" }));
    expect(options?.signal?.aborted).toBe(true);
    const attemptId = JSON.parse(String(options?.body)).attemptId as string;
    await act(async () => resolve(response(spanish, attemptId)));
    expect(screen.queryByText(spanish)).not.toBeInTheDocument();
    expect(callbacks.onAssisted).not.toHaveBeenCalled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });

  it("keeps source input on failure and permits a manual retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    render(<ExpressionAssist {...props()} />);
    await generate();
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法生成");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).text).toBe(sourceText);
    await userEvent.click(screen.getByRole("button", { name: "重试翻译" }));
    expect(await screen.findByText(spanish)).toBeInTheDocument();
  });

  it("rejects a mismatched attempt or non-Spanish response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(spanish, "another-attempt"));
    const callbacks = props();
    render(<ExpressionAssist {...callbacks} />);
    await generate();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(callbacks.onAssisted).not.toHaveBeenCalled();
  });

  it("closes on Escape and restores the original composer focus", async () => {
    const callbacks = props();
    render(<form><ExpressionAssist {...callbacks} /></form>);
    await generate();
    await screen.findByText(spanish);
    fireEvent.keyDown(screen.getByRole("button", { name: "译成西语" }), { key: "Escape" });
    expect(callbacks.onFocusInput).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "翻译预览" })).not.toBeInTheDocument();
  });

  it("times out an unresponsive request and can recover", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    render(<ExpressionAssist {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "译成西语" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("超时");
    expect(screen.getByRole("button", { name: "重试翻译" })).toBeEnabled();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("clears and cancels on page hide without filling the composer", async () => {
    const callbacks = props();
    render(<ExpressionAssist {...callbacks} />);
    await generate();
    await screen.findByText(spanish);
    fireEvent(window, new Event("pagehide"));
    await waitFor(() => expect(screen.queryByText(spanish)).not.toBeInTheDocument());
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });

  it("focuses the sole composer without generating for an empty draft", async () => {
    const callbacks = props();
    render(<ExpressionAssist {...callbacks} text="  " />);
    await generate();
    expect(callbacks.onFocusInput).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("cancels an edited draft and cannot resurrect its result when the old text is restored", async () => {
    let release!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const callbacks = props();
    const view = render(<ExpressionAssist {...callbacks} />);
    await generate();
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    const attemptId = JSON.parse(String(options?.body)).attemptId;
    view.rerender(<ExpressionAssist {...callbacks} text="新的私有草稿" />);
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => release(response(spanish, attemptId)));
    view.rerender(<ExpressionAssist {...callbacks} />);
    expect(screen.queryByText(spanish)).not.toBeInTheDocument();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    expect(callbacks.onAssisted).not.toHaveBeenCalled();
  });

  it("discards preview and audio when its context becomes unavailable", async () => {
    const callbacks = props();
    const view = render(<ExpressionAssist {...callbacks} />);
    await generate();
    await screen.findByText(spanish);
    await userEvent.click(screen.getByRole("button", { name: "听一遍" }));
    view.rerender(<ExpressionAssist {...callbacks} disabled />);
    expect(speech.cancel).toHaveBeenCalled();
    view.rerender(<ExpressionAssist {...callbacks} />);
    expect(screen.queryByText(spanish)).not.toBeInTheDocument();
  });
});
