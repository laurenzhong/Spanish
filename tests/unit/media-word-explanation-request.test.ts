import { afterEach, describe, expect, it, vi } from "vitest";
import { requestWordExplanation } from "@/src/modules/media/ui/request-word-explanation";

const explanation = { partOfSpeech: "名词", meaning: "咖啡", contextualMeaning: "这句指一杯咖啡。", example: "Quiero un café." };
const signal = () => new AbortController().signal;
const streamResponse = (lines: string) => new Response(lines, { headers: { "content-type": "application/x-ndjson" } });
afterEach(() => vi.unstubAllGlobals());

describe("subtitle contextual explanation request", () => {
  it("accepts a validated JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: explanation }))));
    expect(await requestWordExplanation("café", "Un café.", signal())).toEqual(explanation);
  });
  it("accepts split UTF-8 chunks with an explicit done event", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "done", explanation }));
    const body = new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "application/x-ndjson" } })));
    expect(await requestWordExplanation("café", "Un café.", signal())).toEqual(explanation);
  });
  it("rejects a disconnected stream without done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(JSON.stringify({ type: "delta", text: "preview" }))));
    await expect(requestWordExplanation("café", "Un café.", signal())).rejects.toThrow("连接中断");
  });
  it("rejects invalid done payloads and explicit errors", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(streamResponse(JSON.stringify({ type: "done", explanation: {} })))
      .mockResolvedValueOnce(streamResponse(JSON.stringify({ type: "error" })));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestWordExplanation("café", "Un café.", signal())).rejects.toThrow();
    await expect(requestWordExplanation("café", "Un café.", signal())).rejects.toThrow("解析失败");
  });
  it("bounds accumulated response bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("x".repeat(100_001))));
    await expect(requestWordExplanation("café", "Un café.", signal())).rejects.toThrow("响应过长");
  });
  it("cancels a stalled stream on abort and rejects rather than treating cancellation as success", async () => {
    const cancelled = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), { headers: { "content-type": "application/x-ndjson" } })));
    const controller = new AbortController();
    const pending = requestWordExplanation("café", "Un café.", controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
