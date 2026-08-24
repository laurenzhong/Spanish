export const conversationProtocolVersion = "v1" as const;

export const conversationStreamErrorCodes = [
  "stream-aborted",
  "stream-failed",
  "character-unavailable",
  "input-invalid",
] as const;

export type ConversationStreamErrorCode =
  (typeof conversationStreamErrorCodes)[number];

export type ConversationMetaEvent = Readonly<{
  type: "meta";
  protocolVersion: typeof conversationProtocolVersion;
  characterKey: "lucia";
  characterVersion: 1;
  generationId: string;
  messageId: string;
}>;

export type ConversationDeltaEvent = Readonly<{
  type: "delta";
  generationId: string;
  messageId: string;
  text: string;
}>;

export type ConversationDoneEvent = Readonly<{
  type: "done";
  generationId: string;
  messageId: string;
}>;

export type ConversationErrorEvent = Readonly<{
  type: "error";
  generationId: string;
  messageId: string | null;
  code: ConversationStreamErrorCode;
  retryable: boolean;
}>;

export type ConversationStreamEvent =
  | ConversationMetaEvent
  | ConversationDeltaEvent
  | ConversationDoneEvent
  | ConversationErrorEvent;

export function encodeConversationEvent(event: ConversationStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseConversationEvent(value: unknown): ConversationStreamEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string" || typeof event.generationId !== "string") return null;

  if (event.type === "meta") {
    return event.protocolVersion === conversationProtocolVersion &&
        event.characterKey === "lucia" &&
        event.characterVersion === 1 &&
        isNonEmptyString(event.generationId) &&
        isNonEmptyString(event.messageId)
      ? (event as unknown as ConversationMetaEvent)
      : null;
  }
  if (event.type === "delta") {
    return isNonEmptyString(event.generationId) &&
        isNonEmptyString(event.messageId) &&
        typeof event.text === "string" &&
        event.text.length > 0
      ? (event as unknown as ConversationDeltaEvent)
      : null;
  }
  if (event.type === "done") {
    return isNonEmptyString(event.generationId) && isNonEmptyString(event.messageId)
      ? (event as unknown as ConversationDoneEvent)
      : null;
  }
  if (event.type === "error") {
    return isNonEmptyString(event.generationId) &&
        (event.messageId === null || isNonEmptyString(event.messageId)) &&
        conversationStreamErrorCodes.includes(event.code as ConversationStreamErrorCode) &&
        typeof event.retryable === "boolean"
      ? (event as unknown as ConversationErrorEvent)
      : null;
  }
  return null;
}

export class ConversationNdjsonParser {
  private buffer = "";
  private invalid = false;

  push(chunk: string): ConversationStreamEvent[] {
    if (this.invalid) return [];
    this.buffer += chunk;
    const events: ConversationStreamEvent[] = [];
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/u, "").trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const event = parseConversationEvent(JSON.parse(line));
          if (!event) {
            this.invalid = true;
            return [this.failure()];
          }
          events.push(event);
        } catch {
          this.invalid = true;
          return [this.failure()];
        }
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
    return events;
  }

  finish(): ConversationStreamEvent[] {
    if (this.invalid) return [];
    if (this.buffer.trim().length > 0) {
      this.invalid = true;
      return [this.failure()];
    }
    return [];
  }

  private failure(): ConversationErrorEvent {
    return {
      type: "error",
      generationId: "unknown",
      messageId: null,
      code: "stream-failed",
      retryable: true,
    };
  }
}
