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
import { greetingOpener, hasGreetedOnLocalDate } from "../domain/greeting";
import { planReply, questionPolicyForReply, type QuestionPolicy } from "../domain/reply-plan";
import { containsUnsupportedScript, requestedNonSpanishLanguage, translationesePhrase } from "../domain/language-purity";
import { attributesUnconfirmedCoffee, narrowsUnspecifiedWeekendWork, repeatsDailyActivityQuestion, requestsQuestionRepeat } from "../domain/reply-continuity";
import { getConversationCharacter, isKnownConversationVersion } from "../domain/character-catalog";
import { replyBubbleIntervalMs, splitReplyBubbles } from "../domain/reply-bubbles";

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
  /** Persist a complete, validated prefix while this generation still owns delivery. */
  onBubble?: (bubble: Readonly<{ text: string; prefix: string; index: number }>) => Promise<boolean>;
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
function waitForBubble(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!milliseconds || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
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
  const wait = input.wait ?? ((milliseconds: number) => waitForBubble(milliseconds, input.signal));
  const trimmed = input.text.trim();
  if (!trimmed || trimmed.length > 2_000 || !input.clientMessageId || !input.generationId) {
    yield errorEvent(input, "input-invalid", false);
    return;
  }
  if (!getConversationCharacterSafe(input.characterKey) || !isKnownConversationVersion(input.characterKey, input.characterVersion)) {
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
    characterVersion: input.characterVersion,
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
        const returnedPlan = context.openCommitments.some((commitment) => commitment.owner === "user" && (commitment.status === "returned" || commitment.status === "completed"));
        const redundantGreeting = isRedundantGreetingReply(context, replyResult.text);
        const recycledPhrase = isRecycledReplyPhrase(context, replyResult.text);
        const translationese = translationesePhrase(replyResult.text);
        const repeatedActivityQuestion = repeatsDailyActivityQuestion(context, replyResult.text);
        const unconfirmedCoffee = attributesUnconfirmedCoffee(context, replyResult.text);
        const narrowedWeekend = narrowsUnspecifiedWeekendWork(context, replyResult.text);
        const greetedToday = context.alreadyGreetedToday
          ?? hasGreetedOnLocalDate(context.recentMessages, context.currentLocalDate, context.conversationTimeZone);
        // The one permitted retry may fix the defect it was told about and still
        // introduce a new one. A character that already greeted today must not
        // greet in the retry either, even if the rejected text itself did not
        // greet: the 2026-10-21 transcript reached the user exactly this way.
        const greetingGuard = !redundantGreeting && greetedToday && !greetingOpener(context.userMessage)
          ? " No vuelvas a abrir con un saludo (nada de 'hola', 'buenos días', 'buenas tardes' ni 'buenas noches'): hoy ya has saludado y la persona no te ha saludado ahora; continúa directamente con lo que acaba de decir."
          : "";
        generationContext = {
          ...context,
          alreadyGreetedToday: greetedToday,
          ...(returnedPlan || (context.questionPolicy && context.questionPolicy.maxQuestionPressure !== "none")
            ? {}
            : {
                questionPolicy: {
                  maxSubstantiveQuestions: 0,
                  allowReciprocalQuestion: false,
                  maxQuestionPressure: "none" as const,
                },
              }),
          continuityInstruction: `${retryInstruction({ dishonestIdentity: hasDishonestIdentity(replyResult.text), returnedPlan, translationese, redundantGreeting, recycledPhrase, repeatedActivityQuestion, unconfirmedCoffee, narrowedWeekend })}${greetingGuard}`,
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
  const bubbles = splitReplyBubbles(replyResult.text);
  let prefix = "";
  for (const [index, bubble] of bubbles.entries()) {
    if (input.signal?.aborted) {
      yield errorEvent(input, "stream-aborted", true);
      return;
    }
    await wait(index === 0 ? 0 : replyBubbleIntervalMs);
    if (input.signal?.aborted) {
      yield errorEvent(input, "stream-aborted", true);
      return;
    }
    const chunk = `${index ? "\n\n" : ""}${bubble}`;
    prefix += chunk;
    if (input.onBubble) {
      try {
        if (!await input.onBubble({ text: bubble, prefix, index })) {
          yield errorEvent(input, "stream-aborted", true);
          return;
        }
      } catch {
        yield errorEvent(input, "stream-failed", true);
        return;
      }
    }
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
    modelVersion: `${context.character.characterKey}-reply-v1`,
    providerRequestId: null,
    latencyMs: 0,
    estimatedCostMicros: 0,
  };
}

/**
 * A greeting opens a conversation; it is not a per-message decoration. Once the
 * character has greeted the user on the current local day, a message that only
 * continues the exchange must not greet again — a repeated "¡Hola!" reads as a
 * bot restarting the conversation instead of a person talking. Answering a
 * greeting with a greeting stays allowed, and a new local day resets the rule.
 *
 * The whole current day is checked, not just the immediately previous message:
 * a 2026-10-21 transcript greeted at 16:40, then sent two non-greeting replies,
 * and greeted again at 16:58. The earlier check only inspected the last
 * character message ("Uff, los días de lluvia…") and let the repeat through.
 * Messages with an unusable timestamp never block on a guess.
 */
function isRedundantGreetingReply(context: ReplyContext, text: string): boolean {
  if (!greetingOpener(text)) return false;
  if (greetingOpener(context.userMessage)) return false;
  return context.alreadyGreetedToday
    ?? hasGreetedOnLocalDate(context.recentMessages, context.currentLocalDate, context.conversationTimeZone);
}

const recycledPhraseMinimumTokens = 4;
const recycledPhraseMinimumCharacters = 18;

/** Significant words: accent-free lowercase tokens long enough to carry meaning. */
function significantReplyTokens(value: string): readonly string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 3);
}

function sharesPhrase(
  previous: readonly string[],
  generated: readonly string[],
  size: number,
  minimumCharacters: number,
): boolean {
  if (previous.length < size || generated.length < size) return false;
  const phrases = new Set<string>();
  for (let index = 0; index + size <= previous.length; index += 1) {
    phrases.add(previous.slice(index, index + size).join(" "));
  }
  for (let index = 0; index + size <= generated.length; index += 1) {
    const phrase = generated.slice(index, index + size).join(" ");
    if (phrase.length >= minimumCharacters && phrases.has(phrase)) return true;
  }
  return false;
}

/**
 * Reusing your own wording is the same defect as repeating a greeting, one
 * level deeper. On 2026-10-12 Lucía closed a message with "A veces lo mejor que
 * se puede hacer un lunes es no hacer nada" and opened the next with "A veces
 * quedarse en casa, sin prisa, es lo mejor que se puede hacer".
 *
 * Whole-message token overlap cannot see that pair (0.43 against a threshold of
 * 0.82) because rephrasing keeps most words different; what survives a rephrase
 * is the distinctive contiguous phrase. So this gate looks for a shared run of
 * at least four significant words, and for the two shortest sizes it also
 * requires enough characters to be distinctive rather than incidental. A run of
 * six words is always distinctive, which is why no character floor applies
 * there. The worst case for a wrong call is one extra provider call, never a
 * message the user would not have wanted.
 */
function isRecycledReplyPhrase(context: ReplyContext, text: string): boolean {
  const previousCharacterMessage = [...context.recentMessages]
    .reverse()
    .find((message) => message.role === "character" && message.content.trim().length > 0);
  if (!previousCharacterMessage) return false;
  // Repeating a question is the requested action in this turn. Keep checking
  // the surrounding statements, so this does not permit replaying an entire
  // previous reply or dropping other safety checks.
  const comparable = requestsQuestionRepeat(context.userMessage)
    ? (value: string) => value.replace(/¿[^?]*\?/gu, "")
    : (value: string) => value;
  const previous = significantReplyTokens(comparable(previousCharacterMessage.content));
  const generated = significantReplyTokens(comparable(text));
  if (previous.length < recycledPhraseMinimumTokens || generated.length < recycledPhraseMinimumTokens) return false;
  return sharesPhrase(previous, generated, 6, 0)
    || sharesPhrase(previous, generated, 5, recycledPhraseMinimumCharacters)
    || sharesPhrase(previous, generated, 4, recycledPhraseMinimumCharacters);
}

/**
 * The single retry a rejected reply gets. The instruction names the defect that
 * was actually detected, so the second attempt corrects it instead of guessing
 * what went wrong. Strings here are asserted by tests; keep them stable.
 */
function retryInstruction(input: Readonly<{
  dishonestIdentity: boolean;
  returnedPlan: boolean;
  translationese: string | null;
  redundantGreeting: boolean;
  recycledPhrase: boolean;
  repeatedActivityQuestion: boolean;
  unconfirmedCoffee: boolean;
  narrowedWeekend: boolean;
}>): string {
  if (input.dishonestIdentity) {
    return "Responde con honestidad: eres un personaje de IA, no una persona real. No niegues ser una IA ni afirmes ser humana. Contesta de forma breve y directa a la pregunta.";
  }
  if (input.narrowedWeekend) {
    return "La persona solo dijo fin de semana: no confirmó sábado ni domingo para su trabajo. Mantén su expresión sin inventar el día ni corregirla por el calendario. Responde al último mensaje sin atribuirle otras actividades, emociones o resultados no confirmados.";
  }
  if (input.unconfirmedCoffee) {
    return "Has atribuido a la persona haber tomado café, pero solo tú habías mencionado esa opción; la persona no la ha confirmado. Responde al último mensaje sobre el trabajo sin convertir tus propuestas o tus propias experiencias en actividades de la persona. No inventes que ha terminado ni cómo se siente.";
  }
  if (input.repeatedActivityQuestion) {
    return "Tu respuesta volvía a preguntar por los planes del día, aunque ya lo habías preguntado. Responde primero al último mensaje de la persona; no reinicies la elección entre salir o quedarse en casa. Respeta lo que cuenta que ocurrió sin inventar un resultado o un final que no ha confirmado. Puedes reconocer lo que dijo sin preguntar o hacer una pregunta concreta sobre ese dato. No uses saludos como 'bienvenido al finde'.";
  }
  if (input.returnedPlan) {
    return "La persona ya ha vuelto o ha terminado el plan mencionado. Responde desde después de la actividad: no uses deseos propios de antes de salir (por ejemplo, 'que lo pases bien' o 'espero que disfrutes'). Puedes preguntar una sola cosa concreta sobre cómo fue, o responder con calidez sin preguntar; no inventes el resultado.";
  }
  if (input.translationese) {
    return `La respuesta anterior usaba una expresión que no suena natural en español ("${input.translationese}"). Reformúlala con la fórmula corriente que usaría un hablante nativo, sin traducir literalmente del chino ni del inglés.`;
  }
  if (input.redundantGreeting) {
    return "Ya has saludado en un mensaje anterior de hoy y la persona no te ha saludado ahora. No vuelvas a abrir con un saludo (nada de 'hola', 'buenos días', 'buenas tardes' ni 'buenas noches'): continúa directamente con lo que acaba de decir.";
  }
  if (input.recycledPhrase) {
    return "La respuesta anterior reutilizaba casi literalmente una frase de tu mensaje anterior. Dilo con tus propias palabras de otra forma, o añade algo nuevo, en vez de repetir la misma frase.";
  }
  return "La respuesta anterior repetía un tema tratado hoy o contradecía un dato que ya dijiste. Reformula sin repetir la misma respuesta y, si algo cambió, explícalo de forma natural y breve.";
}

function hasDishonestIdentity(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
  const deniesAi = /\bno\s+soy\s+(?:un(?:a)?\s+)?(?:personaje\s+de\s+)?(?:ia|inteligencia artificial)\b/u.test(normalized);
  // Remove explicit human denials before looking for affirmative claims.
  const withoutDenials = normalized.replace(/\bno\s+soy\s+(?:un(?:a)?\s+)?(?:persona\s+(?:real|humana)|humana?|ser\s+humano)\b/gu, "");
  return deniesAi || /\bsoy\s+(?:un(?:a)?\s+)?(?:persona\s+(?:real|humana)|humana?|ser\s+humano)\b/u.test(withoutDenials);
}

function isGeneratedReplySafe(context: ReplyContext, text: string): boolean {
  const unansweredText = context.unansweredUserMessages?.length ? context.unansweredUserMessages.join("\n\n") : context.userMessage;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
  if (!normalized.trim() || /\b(?:system prompt|memory permissions|provider details|mastery|confidence|evidence_events)\b/iu.test(normalized)) {
    return false;
  }
  // Spanish is the default; a stray Chinese fragment is the reported defect and
  // must not reach the user. Only an explicit in-conversation request unlocks it.
  if (containsUnsupportedScript(text) && !requestedNonSpanishLanguage(unansweredText)) return false;
  if (hasDishonestIdentity(text)) return false;
  const plan = planReply({
    userMessage: unansweredText,
    relationshipStage: context.relationshipStage,
    characterInitiative: context.character.initiative,
    characterTopics: context.character.topics,
    teachingOpportunity: context.teachingOpportunity ?? undefined,
  });
  if (plan.intent === "identity-disclosure" && !/\b(?:ia|inteligencia artificial|personaje)\b/iu.test(normalized)) return false;
  if (
    plan.intent !== "identity-disclosure"
    && (/(?:(?:soy|somos|recuerda que soy)\b.{0,48}|\bcomo\s+(?:personaje\s+de\s+)?|\ben\s+cuanto\s+a\s+)\b(?:ia|inteligencia artificial|personaje)\b/iu.test(normalized)
      || /\bcomo\s+personaje\s+de\s+ia\b/iu.test(normalized))
  ) return false;
  if (isRepeatedSameDayTopicReply(context, text)) return false;
  if (repeatsDailyActivityQuestion(context, text)) return false;
  if (attributesUnconfirmedCoffee(context, text)) return false;
  if (narrowsUnspecifiedWeekendWork(context, text)) return false;
  if (isUnexplainedSameDayClaimChange(context, text)) return false;
  if (isPreReturnWishAfterReturn(context, text)) return false;
  if (isUnfoundedGreetingWish(context, text)) return false;
  if (isRedundantGreetingReply(context, text)) return false;
  if (isRecycledReplyPhrase(context, text)) return false;
  if (translationesePhrase(text)) return false;
  return questionPolicyAllows(text, context.questionPolicy ?? questionPolicyForReply({ userMessage: unansweredText }));
}

function isUnfoundedGreetingWish(context: ReplyContext, text: string): boolean {
  const normalizedUserMessage = context.userMessage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!/^(?:(?:hola|hey)(?:\s+buenas)?(?:\s+(?:noches|tardes|dias))?|buenas(?:\s+(?:noches|tardes|dias))?)$/u.test(normalizedUserMessage)) return false;
  const normalizedReply = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
  return /\b(?:espero\s+que|ojala\s+que|ojala)\b/iu.test(normalizedReply);
}

function isPreReturnWishAfterReturn(context: ReplyContext, text: string): boolean {
  const hasFinishedPlan = context.openCommitments.some((commitment) => commitment.owner === "user" && (commitment.status === "returned" || commitment.status === "completed"));
  if (!hasFinishedPlan) return false;
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
