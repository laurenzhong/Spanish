import { findCharacterRuntimeDefinition, isCharacterConversationEnabled } from "@/src/modules/characters";
import {
  ConversationAssistantProviderError,
  type ConversationAssistantProvider,
} from "@/src/modules/providers/assistant/assistant";
import { findConversationCharacter } from "../domain/character-catalog";
import type { ConversationAssistantRepository } from "../repositories/conversation-assistant-repository";
import {
  conversationAssistantDataSchema,
  conversationAssistantRequestSchema,
  type ConversationAssistantData,
} from "../schemas/conversation-assistant";
import { ConversationAssistantError } from "./conversation-assistant-error";
import { isConversationStaticFallbackAllowed } from "./resolve-character-runtime";

export { ConversationAssistantError } from "./conversation-assistant-error";
export type { ConversationAssistantErrorReason } from "./conversation-assistant-error";

/** Provider metadata observation; never contains questions, drafts or output. */
export type ConversationAssistantObservation = Readonly<{
  provider: "minimax" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  status: "succeeded" | "failed" | "cancelled";
  errorType?: string;
}>;

export type ConsultConversationAssistantInput = Readonly<{
  userId: string;
  characterKey: string;
  intent: string;
  characterVersion: number;
  attemptId: string;
  question?: string | null;
  targetText?: string | null;
}>;

/**
 * Every dependency here is either read-only or an observation sink. There is
 * intentionally no message, memory, relationship, evidence or scoring port.
 */
export type ConsultConversationAssistantDependencies = Readonly<{
  repository?: ConversationAssistantRepository;
  getContactStatus?: (userId: string, characterKey: string) => Promise<string>;
  provider: ConversationAssistantProvider;
  signal?: AbortSignal;
  allowStaticFallback?: boolean;
  onProviderResult?: (result: ConversationAssistantObservation) => void | Promise<void>;
}>;

function observe(
  dependencies: ConsultConversationAssistantDependencies,
  observation: ConversationAssistantObservation,
): void {
  try {
    void Promise.resolve(dependencies.onProviderResult?.(observation)).catch(() => undefined);
  } catch {
    // Provider metadata is best-effort and must not block a private answer.
  }
}

function cancelledError(timedOut: boolean): ConversationAssistantProviderError {
  return timedOut
    ? new ConversationAssistantProviderError("provider-timeout", "Conversation assistance timed out.", true)
    : new ConversationAssistantProviderError("provider-cancelled", "Conversation assistance was cancelled.", false);
}

/**
 * Answers one private learning request (reply, grammar, structure or question)
 * using only the learner's own completed conversation context.
 *
 * The helper never persists anything and never sends a message on the
 * learner's behalf: the caller previews the structured result and the learner
 * decides what to do with it.
 */
export async function consultConversationAssistant(
  input: ConsultConversationAssistantInput,
  dependencies: ConsultConversationAssistantDependencies,
): Promise<ConversationAssistantData> {
  const parsed = conversationAssistantRequestSchema.safeParse({
    intent: input.intent,
    characterVersion: input.characterVersion,
    attemptId: input.attemptId,
    question: input.question ?? undefined,
    targetText: input.targetText ?? undefined,
  });
  if (!parsed.success) throw new ConversationAssistantError("VALIDATION_FAILED", 400);
  const command = parsed.data;

  const controller = new AbortController();
  let timedOut = false;
  const checkActive = () => {
    if (controller.signal.aborted) throw cancelledError(timedOut);
  };
  const abort = () => controller.abort();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  if (dependencies.signal?.aborted) abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);
  let rejectCancelled!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancelled = () => reject(cancelledError(timedOut));
  });
  controller.signal.addEventListener("abort", rejectCancelled, { once: true });
  if (controller.signal.aborted) rejectCancelled();

  async function perform(): Promise<ConversationAssistantData> {
    checkActive();
    const catalog = findConversationCharacter(input.characterKey);
    if (!catalog || catalog.version !== command.characterVersion) {
      throw new ConversationAssistantError("CHARACTER_UNAVAILABLE", 404);
    }
    // Enforce the authored release/capability gate without loading canon or memory.
    const definition = findCharacterRuntimeDefinition(input.characterKey, command.characterVersion);
    if (!definition || !isCharacterConversationEnabled(definition)) {
      throw new ConversationAssistantError("CHARACTER_UNAVAILABLE", 404);
    }
    const characterDisplayName = catalog.displayName;
    if (!dependencies.repository) {
      // The explicit non-production seam keeps tests deterministic; production
      // can never consult a character without persistence.
      if (!dependencies.allowStaticFallback || !isConversationStaticFallbackAllowed()) {
        throw new ConversationAssistantError("CONVERSATION_UNAVAILABLE", 503);
      }
    } else {
      let currentVersion: number | null;
      try {
        currentVersion = await dependencies.repository.getCurrentPublishedVersion(input.characterKey);
      } catch {
        throw new ConversationAssistantError("CONVERSATION_UNAVAILABLE", 503);
      }
      checkActive();
      if (currentVersion !== command.characterVersion) {
        throw new ConversationAssistantError("CHARACTER_UNAVAILABLE", 404);
      }
      let status: string;
      try {
        status = (await dependencies.getContactStatus?.(input.userId, input.characterKey)) ?? "unavailable";
      } catch {
        throw new ConversationAssistantError("CONTACT_UNAVAILABLE", 503);
      }
      checkActive();
      if (status !== "active") {
        throw new ConversationAssistantError(
          status === "unavailable" ? "CONTACT_UNAVAILABLE" : "CONTACT_REQUIRED",
          status === "unavailable" ? 503 : 403,
        );
      }
    }

    let context;
    try {
      context = dependencies.repository
        ? await dependencies.repository.listContext(input.userId, input.characterKey)
        : [];
    } catch {
      throw new ConversationAssistantError("CONVERSATION_UNAVAILABLE", 503);
    }
    checkActive();
    // Defensive bounds even when a buggy adapter ignores the SQL projection.
    const safeContext = context
      .slice(-8)
      .map((message) => ({ role: message.role, text: message.text.slice(0, 2_000) }))
      .filter((message) => message.text.trim().length > 0);

    let lastCharacterMessage: string | null = null;
    for (let index = safeContext.length - 1; index >= 0; index -= 1) {
      const message = safeContext[index];
      if (message?.role === "assistant") {
        lastCharacterMessage = message.text;
        break;
      }
    }
    const requestedTarget = command.targetText?.trim() ?? "";
    const targetText = command.intent === "grammar"
      ? requestedTarget
      : command.intent === "structure"
        ? requestedTarget || lastCharacterMessage
        : requestedTarget || null;
    if ((command.intent === "grammar" || command.intent === "structure") && !targetText) {
      throw new ConversationAssistantError(
        "VALIDATION_FAILED",
        400,
        command.intent === "structure" ? "no-target-sentence" : undefined,
      );
    }
    const question = command.question ?? null;

    async function produce(signal: AbortSignal): Promise<ConversationAssistantData> {
      const startedAt = Date.now();
      try {
        const raw = await dependencies.provider.assist({
          intent: command.intent,
          question,
          targetText,
          characterDisplayName,
          recentMessages: safeContext,
        }, { signal });
        if (signal.aborted) throw cancelledError(timedOut);
        const result = conversationAssistantDataSchema.safeParse({
          attemptId: command.attemptId,
          intent: command.intent,
          answer: raw.answer,
          suggestions: raw.suggestions,
          corrections: raw.corrections,
          structure: raw.structure,
          // An empty corrected sentence is semantically "no correction".
          correctedSentence: raw.correctedSentence?.trim() ? raw.correctedSentence : null,
        });
        if (!result.success) {
          throw new ConversationAssistantProviderError(
            "provider-response-invalid",
            "Conversation assistant response was invalid.",
            false,
          );
        }
        observe(dependencies, {
          provider: raw.provider,
          modelVersion: raw.modelVersion,
          providerRequestId: raw.providerRequestId,
          latencyMs: raw.latencyMs,
          estimatedCostMicros: raw.estimatedCostMicros,
          status: "succeeded",
        });
        return result.data;
      } catch (error) {
        observe(dependencies, {
          provider: "minimax",
          modelVersion: "MiniMax-M3",
          providerRequestId: null,
          latencyMs: Date.now() - startedAt,
          estimatedCostMicros: null,
          status: signal.aborted ? "cancelled" : "failed",
          errorType: error instanceof ConversationAssistantProviderError ? error.code : "provider-unavailable",
        });
        throw error;
      }
    }

    return produce(controller.signal);
  }

  try {
    return await Promise.race([perform(), cancelled]);
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectCancelled);
  }
}
