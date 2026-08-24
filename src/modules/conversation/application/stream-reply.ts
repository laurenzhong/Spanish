import {
  type ConversationErrorEvent,
  type ConversationStreamEvent,
} from "../domain/stream-protocol";

export type StreamReplyInput = Readonly<{
  characterKey: string;
  characterVersion: number;
  text: string;
  clientMessageId: string;
  generationId: string;
  messageId: string;
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
const replies = [
  {
    test: /\b(ia|inteligencia artificial|eres un bot|real)\b/iu,
    text: "Soy un personaje de IA, y me gusta hablar contigo con honestidad. ¿Qué te gustaría contarme?",
  },
  {
    test: /\b(hola|hey|buenas|qué tal|como va|cómo va)\b/iu,
    text: "¡Hola! Qué alegría leerte. Yo estoy bien; ¿cómo va todo por tu lado?",
  },
  {
    test: /\b(comida|comer|café|caf[eé]|cocina|sabor)\b/iu,
    text: "La comida siempre da para una buena charla. ¿Qué sabor te apetece descubrir hoy?",
  },
  {
    test: /\b(madrid|foto|fotografía|paseo|ciudad)\b/iu,
    text: "Me encanta fijarme en los detalles de la ciudad. ¿Qué escena te llamó la atención últimamente?",
  },
] as const;

const defaultReply = "Te leo. Cuéntame un poco más; me interesa saber qué tienes en mente.";

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
  if (input.characterKey !== "lucia" || input.characterVersion !== 1) {
    yield errorEvent(input, "character-unavailable", false);
    return;
  }

  yield {
    type: "meta",
    protocolVersion: "v1",
    characterKey: "lucia",
    characterVersion: 1,
    generationId: input.generationId,
    messageId: input.messageId,
  };

  const reply = replies.find((candidate) => candidate.test.test(trimmed))?.text ?? defaultReply;
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
