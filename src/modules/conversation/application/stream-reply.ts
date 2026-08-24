import {
  type ConversationErrorEvent,
  type ConversationStreamEvent,
} from "../domain/stream-protocol";
import { generateCharacterReply } from "./generate-character-reply";
import type { ReplyContext } from "./build-reply-context";

export type StreamReplyInput = Readonly<{
  characterKey: string;
  characterVersion: number;
  text: string;
  clientMessageId: string;
  generationId: string;
  messageId: string;
  replyContext?: ReplyContext;
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
  if (input.signal?.aborted) {
    yield errorEvent(input, "stream-aborted", true);
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

  const context = input.replyContext ?? {
    generationId: input.generationId,
    userId: "anonymous",
    userMessage: trimmed,
    recentMessages: [],
    character: {
      characterKey: input.characterKey,
      characterVersion: input.characterVersion,
      displayName: "Lucía Martín",
      homeLocation: "Madrid",
      initiative: "balanced" as const,
      tone: ["cercana", "natural"],
      topics: ["fotografía urbana", "comida local", "Madrid"],
      facts: [],
    },
    relationshipStage: "new_contact" as const,
    relationshipSummary: null,
    memories: [],
    teachingOpportunity: null,
  };
  const reply = generateCharacterReply({ context, signal: input.signal }).text;
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
