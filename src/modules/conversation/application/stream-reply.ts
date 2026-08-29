import {
  type ConversationErrorEvent,
  type ConversationStreamEvent,
} from "../domain/stream-protocol";
import type {
  CharacterReplyProvider,
  ConversationProviderResult,
} from "@/src/modules/providers/conversation";
import { ConversationProviderError } from "@/src/modules/providers/conversation";
import {
  generateCharacterReply,
} from "./generate-character-reply";
import type { ReplyContext } from "./build-reply-context";
import { planReply, questionPolicyForReply, type QuestionPolicy } from "../domain/reply-plan";
import { getConversationCharacter } from "../domain/character-catalog";

export type StreamReplyProviderObservation = Readonly<{
  provider: ConversationProviderResult["provider"];
  modelVersion: string;
  providerRequestId: string | null;
  status: "succeeded" | "failed" | "cancelled";
  latencyMs: number;
  estimatedCostMicros: number | null;
  errorType?: string | null;
}>;

export type StreamReplyInput = Readonly<{
  characterKey: string;
  characterVersion: number;
  text: string;
  clientMessageId: string;
  generationId: string;
  messageId: string;
  replyContext?: ReplyContext;
  replyProvider?: CharacterReplyProvider;
  providerName?: ConversationProviderResult["provider"];
  providerModelVersion?: string;
  onProviderResult?: (observation: StreamReplyProviderObservation) => Promise<void> | void;
  signal?: AbortSignal;
  wait?: (milliseconds: number) => Promise<void>;
}>;

export class StreamReplyError extends Error {
  readonly event: ConversationErrorEvent;

  constructor(event: ConversationErrorEvent) {
    super(event.code);
    this.name = "StreamReplyError";
    this.event = event;
  }
}

class ReplySafetyGateError extends ConversationProviderError {
  readonly safetyGate = true;

  constructor() {
    super(
      "provider-response-invalid",
      "Conversation provider response failed safety validation.",
      false,
    );
    this.name = "ReplySafetyGateError";
  }
}
function splitReply(text: string): readonly string[] {
  return text.match(/.{1,18}(?:\s+|$)/gu)?.map((part) =>
    /\s$/u.test(part) ? part.replace(/\s+$/u, " ") : part,
  ).filter(Boolean) ?? [text];
}

function errorEvent(
  input: StreamReplyInput,
  code: ConversationErrorEvent["code"],
  retryable: boolean,
): ConversationErrorEvent {
  return {
    type: "error",
    generationId: input.generationId,
    messageId: code === "input-invalid" || code === "character-unavailable" ? null : input.messageId,
    code,
    retryable,
  };
}

export async function* streamReply(
  input: StreamReplyInput,
): AsyncGenerator<ConversationStreamEvent> {
  const wait = input.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const trimmed = input.text.trim();
  if (!trimmed || trimmed.length > 2_000 || !input.clientMessageId || !input.generationId) {
    yield errorEvent(input, "input-invalid", false);
    return;
  }
  if (!getConversationCharacterSafe(input.characterKey) || input.characterVersion !== 1) {
    yield errorEvent(input, "character-unavailable", false);
    return;
  }
  if (input.signal?.aborted) {
    yield errorEvent(input, "stream-aborted", true);
    return;
  }

  yield {
    type: "meta",
    protocolVersion: "v1",
    characterKey: input.characterKey as "lucia" | "mateo" | "ines",
    characterVersion: 1,
    generationId: input.generationId,
    messageId: input.messageId,
  };

  const context = input.replyContext ?? {
    generationId: input.generationId,
    userId: "anonymous",
    userMessage: trimmed,
    recentMessages: [],
    rollingSummary: null,
    openTopics: [],
    character: getConversationCharacter(input.characterKey).snapshot,
    relationshipStage: "new_contact" as const,
    relationshipSummary: null,
    memories: [],
    teachingOpportunity: null,
    questionPolicy: undefined,
  };
  let replyResult: ConversationProviderResult;
  if (input.replyProvider) {
    try {
      let generationContext = context;
      let safetyRetryUsed = false;
      while (true) {
        replyResult = await input.replyProvider.generate(generationContext, { signal: input.signal });
        if (isGeneratedReplySafe(generationContext, replyResult.text)) break;
        if (safetyRetryUsed) throw new ReplySafetyGateError();
        safetyRetryUsed = true;
        await notifyProviderResult(input, {
          provider: replyResult.provider,
          modelVersion: replyResult.modelVersion,
          providerRequestId: replyResult.providerRequestId,
          status: "failed",
          latencyMs: replyResult.latencyMs,
          estimatedCostMicros: replyResult.estimatedCostMicros,
          errorType: "safety-gate",
        });
        generationContext = {
          ...context,
          questionPolicy: {
            maxSubstantiveQuestions: 0,
            allowReciprocalQuestion: false,
            maxQuestionPressure: "none",
          },
        };
      }
      await notifyProviderResult(input, {
        provider: replyResult.provider,
        modelVersion: replyResult.modelVersion,
        providerRequestId: replyResult.providerRequestId,
        status: "succeeded",
        latencyMs: replyResult.latencyMs,
        estimatedCostMicros: replyResult.estimatedCostMicros,
      });
    } catch (error) {
      const providerErrorType = errorCode(error);
      if (input.signal?.aborted || providerErrorType === "provider-cancelled") {
        await notifyProviderResult(input, {
          provider: input.providerName ?? "minimax",
          modelVersion: input.providerModelVersion ?? "MiniMax-M3",
          providerRequestId: null,
          status: "cancelled",
          latencyMs: 0,
          estimatedCostMicros: null,
          errorType: "provider-cancelled",
        });
        yield errorEvent(input, "stream-aborted", true);
        return;
      }
      await notifyProviderResult(input, {
        provider: input.providerName ?? "minimax",
        modelVersion: input.providerModelVersion ?? "MiniMax-M3",
        providerRequestId: null,
        status: "failed",
        latencyMs: 0,
        estimatedCostMicros: null,
        errorType: error instanceof ReplySafetyGateError ? "safety-gate" : providerErrorType,
      });
      yield errorEvent(input, "stream-failed", isRetryableProviderError(error));
      return;
    }
  } else {
    replyResult = deterministicResult(context, input.signal);
    await notifyProviderResult(input, {
      provider: replyResult.provider,
      modelVersion: replyResult.modelVersion,
      providerRequestId: replyResult.providerRequestId,
      status: "succeeded",
      latencyMs: replyResult.latencyMs,
      estimatedCostMicros: replyResult.estimatedCostMicros,
    });
  }
  const reply = replyResult.text;
  for (const chunk of splitReply(reply)) {
    if (input.signal?.aborted) {
      yield errorEvent(input, "stream-aborted", true);
      return;
    }
    await wait(45);
    if (input.signal?.aborted) {
      yield errorEvent(input, "stream-aborted", true);
      return;
    }
    yield {
      type: "delta",
      generationId: input.generationId,
      messageId: input.messageId,
      text: chunk,
    };
  }
  if (input.signal?.aborted) {
    yield errorEvent(input, "stream-aborted", true);
    return;
  }
  yield { type: "done", generationId: input.generationId, messageId: input.messageId };
}

function getConversationCharacterSafe(key: string): boolean {
  try {
    getConversationCharacter(key);
    return true;
  } catch {
    return false;
  }
}

async function notifyProviderResult(
  input: StreamReplyInput,
  observation: StreamReplyProviderObservation,
): Promise<void> {
  try {
    await input.onProviderResult?.(observation);
  } catch {
    // Provider observability must never change the user-visible reply.
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9._-]{1,96}$/u.test(code)) return code;
  }
  return "provider-unavailable";
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ConversationProviderError ? error.retryable : true;
}

function deterministicResult(context: ReplyContext, signal?: AbortSignal): ConversationProviderResult {
  return {
    ...generateCharacterReply({ context, signal }),
    provider: "deterministic-fake",
    modelVersion: "lucia-reply-v1",
    providerRequestId: null,
    latencyMs: 0,
    estimatedCostMicros: 0,
  };
}

function isGeneratedReplySafe(context: ReplyContext, text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
  if (!normalized.trim() || /\b(?:system prompt|memory permissions|provider details|mastery|confidence|evidence_events)\b/iu.test(normalized)) {
    return false;
  }
  const plan = planReply({
    userMessage: context.userMessage,
    relationshipStage: context.relationshipStage,
    characterInitiative: context.character.initiative,
    characterTopics: context.character.topics,
    teachingOpportunity: context.teachingOpportunity ?? undefined,
  });
  if (plan.intent === "identity-disclosure" && !/\b(?:ia|inteligencia artificial|personaje)\b/iu.test(normalized)) return false;
  if (plan.intent !== "identity-disclosure" && /\b(?:soy|somos|recuerda que soy)\b.{0,48}\b(?:ia|inteligencia artificial|personaje)\b/iu.test(normalized)) return false;
  return questionPolicyAllows(text, context.questionPolicy ?? questionPolicyForReply({ userMessage: context.userMessage }));
}

function questionPolicyAllows(text: string, policy: QuestionPolicy): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
  const questions = text.match(/¿[^?]*\?/gu) ?? [];
  const reciprocal = questions.filter((question) => /\b(?:y tu|y tú|tu que|tú qué|y usted)\b/iu.test(question.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")));
  const substantiveCount = questions.length - reciprocal.length;
  const investigativeInvite = /\b(?:cuentame|dime|explicame|que te ha pasado|que es lo que mas te preocupa|si te apetece (?:contar|hablar)|puedo preguntarte)\b/iu.test(normalized);
  if (substantiveCount > policy.maxSubstantiveQuestions) return false;
  if (!policy.allowReciprocalQuestion && reciprocal.length > 0) return false;
  if (policy.maxQuestionPressure === "none" && questions.length > 0) return false;
  if (policy.maxQuestionPressure === "none" && investigativeInvite) return false;
  return true;
}
