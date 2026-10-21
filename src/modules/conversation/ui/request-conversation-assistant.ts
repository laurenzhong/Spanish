import {
  conversationAssistantResponseSchema,
  type ConversationAssistantData,
  type ConversationAssistantIntent,
} from "../schemas/conversation-assistant";

export type ConversationAssistantRequestInput = Readonly<{
  characterKey: string;
  characterVersion: number;
  intent: ConversationAssistantIntent;
  question?: string;
  targetText?: string;
  /** Client-side race guard and provider-call correlation; never a capability. */
  attemptId: string;
  signal: AbortSignal;
}>;

/** Provider budget is 30s server-side; the client keeps a slightly longer local bound. */
export const conversationAssistantTimeoutMs = 45_000;

/**
 * Ask the private in-chat learning assistant one question.
 *
 * The request carries only what the learner typed; recent conversation context
 * is read server-side. Failures throw a bare Error whose message is one of
 * `cancelled` | `timeout` | `unavailable` | `invalid` so the panel can pick
 * localized copy without leaking provider or transport details.
 */
export async function requestConversationAssistant(
  input: ConversationAssistantRequestInput,
): Promise<ConversationAssistantData> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new Error("cancelled")); };
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  else timeout = setTimeout(() => { controller.abort(); rejectAbort(new Error("timeout")); }, conversationAssistantTimeoutMs);

  const question = input.question?.trim();
  const targetText = input.targetText?.trim();
  try {
    return await Promise.race([interrupted, (async () => {
      if (controller.signal.aborted) throw new Error("cancelled");
      const response = await fetch(`/api/v1/conversations/${encodeURIComponent(input.characterKey)}/assistant`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          characterVersion: input.characterVersion,
          intent: input.intent,
          attemptId: input.attemptId,
          ...(question ? { question } : {}),
          ...(targetText ? { targetText } : {}),
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error("cancelled");
      // 504 is the server's provider deadline; the learner sees the same
      // retryable timeout copy as the local deadline.
      if (response.status === 504) throw new Error("timeout");
      if (!response.ok) throw new Error("unavailable");
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("invalid");
      }
      if (controller.signal.aborted) throw new Error("cancelled");
      const parsed = conversationAssistantResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("invalid");
      const data = parsed.data.data;
      // A response for another attempt or intent must never render as this
      // answer; it belongs to a cancelled request or a broken server.
      if (data.attemptId !== input.attemptId || data.intent !== input.intent) throw new Error("invalid");
      return data;
    })()]);
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", abort);
  }
}
