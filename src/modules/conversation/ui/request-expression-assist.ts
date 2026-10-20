import { expressionAssistResponseSchema } from "../schemas/expression-assist";

/** A local deadline also covers a stalled response body or a fetch that ignores abort. */
export async function requestExpressionAssist(input: Readonly<{
  characterKey: string;
  characterVersion: number;
  text: string;
  attemptId: string;
  signal: AbortSignal;
}>): Promise<string> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new Error("cancelled")); };
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  else timeout = setTimeout(() => { controller.abort(); rejectAbort(new Error("timeout")); }, 30_000);
  try {
    return await Promise.race([interrupted, (async () => {
      if (controller.signal.aborted) throw new Error("cancelled");
      const response = await fetch(`/api/v1/conversations/${input.characterKey}/expression-assist`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text: input.text, characterVersion: input.characterVersion, attemptId: input.attemptId }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("unavailable");
      const result = expressionAssistResponseSchema.safeParse(await response.json());
      if (controller.signal.aborted) throw new Error("cancelled");
      if (!result.success || result.data.data.attemptId !== input.attemptId) throw new Error("invalid");
      const text = result.data.data.text.trim();
      if (!text || /\p{Script=Han}/u.test(text) || !/\p{Script=Latin}/u.test(text)) throw new Error("invalid");
      return text;
    })()]);
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", abort);
  }
}
