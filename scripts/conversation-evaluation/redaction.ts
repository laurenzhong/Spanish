import { createHash } from "node:crypto";

/** Provider output sometimes contains malformed reasoning in a final-text block. Never archive it. */
export function hasProviderPlanning(text: string): boolean {
  return /<\/?(?:mm:)?(?:think(?:ing)?|analysis|reasoning)\b|<\|(?:analysis|thinking|reasoning)\|>|(?:^|\n)\s*(?:Need (?:clean|no|to)|Let's (?:formulate|think)|Final:)/iu.test(text);
}

export function redactProviderText(text: string): string {
  if (!hasProviderPlanning(text)) return text;
  const hash = createHash("sha256").update(text).digest("hex");
  return `[已移除供应商混入正文的内部规划内容；原候选 SHA-256：${hash}；字符数：${text.length}。原文不保存；保留调用、拦截和费用证据。]`;
}

/** Applies only to generated provider/character text; user-authored facts and manifest stay intact. */
export function redactCheckpointText<T>(checkpoint: T): T {
  const copy = structuredClone(checkpoint) as T & {
    traces?: { output: string | null }[];
    sandbox?: { messages: { role: string; content: string }[] };
    partial?: { content: string } | null;
  };
  for (const trace of copy.traces ?? []) if (typeof trace.output === "string") trace.output = redactProviderText(trace.output);
  for (const message of copy.sandbox?.messages ?? []) if (message.role === "character") message.content = redactProviderText(message.content);
  if (copy.partial) copy.partial.content = redactProviderText(copy.partial.content);
  return copy;
}
