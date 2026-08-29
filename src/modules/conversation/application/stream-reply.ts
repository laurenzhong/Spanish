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
import { deriveReplyOpenTopics, type ReplyContext } from "./build-reply-context";
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
    characterClaims: [],
    openCommitments: [],
    conversationTimeZone: "Europe/Madrid",
    currentLocalDate: new Date().toISOString().slice(0, 10),
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
        const returnedPlan = context.openCommitments.some((commitment) => commitment.owner === "user" && commitment.status === "returned");
        generationContext = {
          ...context,
          ...(returnedPlan || (context.questionPolicy && context.questionPolicy.maxQuestionPressure !== "none")
            ? {}
            : {
                questionPolicy: {
                  maxSubstantiveQuestions: 0,
                  allowReciprocalQuestion: false,
                  maxQuestionPressure: "none" as const,
                },
              }),
          continuityInstruction: returnedPlan
            ? "La persona ya ha vuelto o ha terminado el plan mencionado. Responde desde después de la actividad: no uses deseos propios de antes de salir (por ejemplo, 'que lo pases bien' o 'espero que disfrutes'). Puedes preguntar una sola cosa concreta sobre cómo fue, o responder con calidez sin preguntar; no inventes el resultado."
            : "La respuesta anterior repetía un tema tratado hoy o contradecía un dato que ya dijiste. Reformula sin repetir la misma respuesta y, si algo cambió, explícalo de forma natural y breve.",
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
  if (isRepeatedSameDayTopicReply(context, text)) return false;
  if (isUnexplainedSameDayClaimChange(context, text)) return false;
  if (isPreReturnWishAfterReturn(context, text)) return false;
  return questionPolicyAllows(text, context.questionPolicy ?? questionPolicyForReply({ userMessage: context.userMessage }));
}

function isPreReturnWishAfterReturn(context: ReplyContext, text: string): boolean {
  const hasReturnedPlan = context.openCommitments.some((commitment) => commitment.owner === "user" && commitment.status === "returned");
  if (!hasReturnedPlan) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
  return /\b(?:que\s+lo\s+pas(?:es|e)|que\s+disfrut(?:es|e)|que\s+te\s+vaya\s+bien|disfruta(?:s|r)?|te\s+deseo\s+que|espero\s+que).{0,140}\b(?:actividad|tarde|salida|fotos?|puerto|haya\s+ido|hayas\s+captado|te\s+haya\s+sentado)\b/iu.test(normalized);
}

function normalizedReplyTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("es-ES")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter((token) => token.length > 2),
  );
}

function isRepeatedSameDayTopicReply(context: ReplyContext, text: string): boolean {
  const currentTopic = deriveReplyOpenTopics([{ role: "user", content: context.userMessage }])[0];
  if (!currentTopic) return false;
  const previous = context.openTopics.find((topic) =>
    topic.topicKey === currentTopic.topicKey && topic.status === "answered" && topic.sameLocalDay && topic.lastAnswer,
  )?.lastAnswer;
  if (!previous || previous.length < 24 || text.trim().length < 24) return false;
  const previousTokens = normalizedReplyTokens(previous);
  const generatedTokens = normalizedReplyTokens(text);
  if (previousTokens.size < 5 || generatedTokens.size < 5) return false;
  let intersection = 0;
  for (const token of previousTokens) if (generatedTokens.has(token)) intersection += 1;
  const overlap = intersection / Math.min(previousTokens.size, generatedTokens.size);
  return overlap >= 0.82 || (previousTokens.size === generatedTokens.size && overlap >= 0.7);
}

function mealSignature(value: string): string | null {
  const normalized = normalizedReplyTokens(value);
  if (normalized.has("pure") && normalized.has("patatas")) return "pure-patatas";
  if (normalized.has("arroz")) return "arroz";
  if (normalized.has("tortilla")) return "tortilla";
  if (normalized.has("pasta")) return "pasta";
  if (normalized.has("ensalada")) return "ensalada";
  return null;
}

function isUnexplainedSameDayClaimChange(context: ReplyContext, text: string): boolean {
  const currentTopic = deriveReplyOpenTopics([{ role: "user", content: context.userMessage }])[0];
  if (currentTopic?.topicKey !== "daily:meal") return false;
  const claim = context.characterClaims.find((item) => item.claimKey === "daily:meal" && item.sameLocalDay);
  if (!claim) return false;
  const previousMeal = mealSignature(claim.statement);
  const currentMeal = mealSignature(text);
  if (!previousMeal || !currentMeal || previousMeal === currentMeal) return false;
  return !/\b(?:antes|te dije|como te decia|habia pensado|he cambiado|cambie|cambie de idea|cambi[eé] de idea|mantengo|sigo con|me he decidido por)\b/iu.test(text.normalize("NFD").replace(/[\u0300-\u036f]/gu, ""));
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
