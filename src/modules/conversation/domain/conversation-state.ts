import type {
  ConversationErrorEvent,
  ConversationStreamEvent,
} from "./stream-protocol";

export type ConversationStatus = "idle" | "streaming" | "completed" | "cancelled" | "failed";

export type ConversationMessage = Readonly<{
  id: string;
  clientMessageId?: string;
  role: "user" | "character";
  text: string;
  generationId?: string;
  complete: boolean;
  status?: "completed" | "withdrawn";
  withdrawn?: boolean;
  createdAt?: string;
  sourceType?: "conversation" | "authored_opening" | "proactive" | string;
}>;

export type ConversationState = Readonly<{
  status: ConversationStatus;
  messages: readonly ConversationMessage[];
  activeGenerationId: string | null;
  activeMessageId: string | null;
  error: ConversationErrorEvent | null;
}>;

export type ConversationAction =
  | Readonly<{ type: "hydrate"; messages: readonly ConversationMessage[] }>
  | Readonly<{ type: "replace-hydrate"; messages: readonly ConversationMessage[]; staleMessageKeys: readonly string[] }>
  | Readonly<{ type: "submit"; text: string; clientMessageId: string; generationId: string; createdAt?: string }>
  | Readonly<{ type: "retry"; userMessageId: string; generationId: string }>
  | Readonly<{ type: "stream-event"; event: ConversationStreamEvent }>
  | Readonly<{ type: "cancel"; generationId: string }>
  | Readonly<{ type: "remove-message"; messageId: string }>
  | Readonly<{ type: "withdraw-message"; messageId: string }>
  | Readonly<{ type: "reset" }>;

export function createConversationState(): ConversationState {
  return {
    status: "idle",
    messages: [],
    activeGenerationId: null,
    activeMessageId: null,
    error: null,
  };
}

function isCurrent(state: ConversationState, generationId: string): boolean {
  return state.activeGenerationId === generationId;
}

function statusAfterHydrate(state: ConversationState): ConversationStatus {
  return state.status === "streaming" || state.status === "failed" || state.status === "cancelled"
    ? state.status
    : "idle";
}

function withMessage(
  messages: readonly ConversationMessage[],
  id: string,
  update: (message: ConversationMessage) => ConversationMessage,
): readonly ConversationMessage[] {
  return messages.map((message) => (message.id === id ? update(message) : message));
}

function dedupeMessages(messages: readonly ConversationMessage[]): readonly ConversationMessage[] {
  const byKey = new Map<string, ConversationMessage>();
  for (const message of messages) byKey.set(message.clientMessageId ?? message.id, message);
  return [...byKey.values()];
}

export function transitionConversationState(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  if (action.type === "reset") return createConversationState();

  if (action.type === "hydrate") {
    const persistedMessages = dedupeMessages(action.messages);
    const persistedKeys = new Set(
      persistedMessages.map((message) => message.clientMessageId ?? message.id),
    );
    const currentOnly = state.messages.filter(
      (message) => !persistedKeys.has(message.clientMessageId ?? message.id),
    );
    return {
      ...state,
      messages: [...persistedMessages, ...currentOnly],
      status: statusAfterHydrate(state),
      activeGenerationId: state.activeGenerationId,
      activeMessageId: state.activeMessageId,
      error: state.error,
    };
  }

  if (action.type === "replace-hydrate") {
    const persistedMessages = dedupeMessages(action.messages);
    const staleKeys = new Set(action.staleMessageKeys);
    const currentOnly = state.messages.filter(
      (message) => !staleKeys.has(message.clientMessageId ?? message.id),
    );
    return {
      ...state,
      messages: [...persistedMessages, ...currentOnly],
      status: statusAfterHydrate(state),
      activeGenerationId: state.activeGenerationId,
      activeMessageId: state.activeMessageId,
      error: state.error,
    };
  }

  if (action.type === "submit") {
    const alreadyAdded = state.messages.some(
      (message) => message.clientMessageId === action.clientMessageId,
    );
    return {
      ...state,
      status: "streaming",
      messages: alreadyAdded
        ? state.messages
        : [
            ...state.messages,
            {
              id: action.clientMessageId,
              clientMessageId: action.clientMessageId,
              role: "user",
              text: action.text,
              complete: true,
              createdAt: action.createdAt,
            },
          ],
      activeGenerationId: action.generationId,
      activeMessageId: null,
      error: null,
    };
  }

  if (action.type === "retry") {
    if (state.status !== "failed" && state.status !== "cancelled") return state;
    const userMessage = state.messages.find((message) => message.id === action.userMessageId);
    if (!userMessage || userMessage.role !== "user") return state;
    return {
      ...state,
      status: "streaming",
      activeGenerationId: action.generationId,
      activeMessageId: null,
      error: null,
    };
  }

  if (action.type === "cancel") {
    if (!isCurrent(state, action.generationId)) return state;
    return { ...state, status: "cancelled", error: null };
  }

  if (action.type === "remove-message") {
    return { ...state, messages: state.messages.filter((message) => message.id !== action.messageId) };
  }

  if (action.type === "withdraw-message") {
    return {
      ...state,
      messages: withMessage(state.messages, action.messageId, (message) => ({
        ...message,
        text: "",
        complete: true,
        status: "withdrawn",
        withdrawn: true,
      })),
    };
  }

  const event = action.event;
  if (!isCurrent(state, event.generationId)) return state;

  if (event.type === "meta") {
    const existing = state.messages.some((message) => message.id === event.messageId);
    return {
      ...state,
      status: "streaming",
      activeMessageId: event.messageId,
      messages: existing
        ? state.messages
        : [
            ...state.messages,
            {
              id: event.messageId,
              role: "character",
              text: "",
              generationId: event.generationId,
              complete: false,
              createdAt: event.createdAt,
            },
          ],
    };
  }

  if (event.type === "error") {
    return {
      ...state,
      status: event.code === "stream-aborted" ? "cancelled" : "failed",
      error: event,
    };
  }

  if (!state.activeMessageId || event.messageId !== state.activeMessageId) return state;

  if (event.type === "delta") {
    return {
      ...state,
      status: "streaming",
      messages: withMessage(state.messages, event.messageId, (message) => ({
        ...message,
        text: `${message.text}${event.text}`,
      })),
    };
  }
  if (event.type === "done") {
    return {
      ...state,
      status: "completed",
      messages: withMessage(state.messages, event.messageId, (message) => ({
        ...message,
        complete: true,
      })),
    };
  }
  return state;
}

export function findRetryableUserMessage(state: ConversationState): ConversationMessage | null {
  if (state.status !== "failed" && state.status !== "cancelled") return null;

  const assistant = state.activeMessageId
    ? state.messages.find((message) => message.id === state.activeMessageId)
    : null;
  if (assistant) {
    const index = state.messages.findIndex((message) => message.id === assistant.id);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (state.messages[cursor]?.role === "user") return state.messages[cursor] ?? null;
    }
  }

  // HTTP failures and cancellations can happen before the stream emits meta.
  // In that case the latest user message is still the safe retry target.
  for (let cursor = state.messages.length - 1; cursor >= 0; cursor -= 1) {
    if (state.messages[cursor]?.role === "user") return state.messages[cursor] ?? null;
  }
  return null;
}
