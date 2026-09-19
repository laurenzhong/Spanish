import { z } from "zod";

const explanationSchema = z.object({
  partOfSpeech: z.string().min(1).max(120), meaning: z.string().min(1).max(500),
  contextualMeaning: z.string().min(1).max(700), example: z.string().min(1).max(500),
});
export type MediaWordExplanation = z.infer<typeof explanationSchema>;

export async function requestWordExplanation(word: string, context: string, signal: AbortSignal): Promise<MediaWordExplanation> {
  const selectedAt = context.indexOf(word);
  const start = Math.max(0, selectedAt - 800);
  const response = await fetch("/api/v1/read/word-explanation", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ word, context: context.slice(start, start + 2000), locale: "es-ES", selectionType: "word" }), signal,
  });
  if (!response.ok) throw new Error("解析暂时不可用，请重试。");
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await response.json();
    return explanationSchema.parse(body.data);
  }
  if (!response.body) throw new Error("解析未完成，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let length = 0;
  let explanation: MediaWordExplanation | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error("解析失败，请重试。");
    if (event.type === "done") explanation = explanationSchema.parse(event.explanation);
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      length += chunk.value?.byteLength ?? 0;
      if (length > 100_000) throw new Error("解析响应过长，请重试。");
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consume);
      if (chunk.done) break;
    }
    consume(buffer);
    if (!explanation) throw new Error("解析连接中断，请重试。");
    return explanation;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
