export type ConversationRole = "user" | "character";
export type ConversationMessageStatus = "streaming" | "completed" | "failed" | "cancelled" | "withdrawn";

export type ConversationMessageRecord = Readonly<{
  id: string;
  clientMessageId: string;
  generationId: string | null;
  role: ConversationRole;
  status: ConversationMessageStatus;
  content: string;
  replyToMessageId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  sourceType?: "conversation" | "authored_opening" | "proactive" | string;
}>;

export type ConversationSearchResultRecord = Readonly<ConversationMessageRecord & {
  characterKey: string;
  characterName: string;
}>;

export type ConversationListRecord = Readonly<{
  conversationId: string;
  characterKey: string;
  characterName: string;
  avatarUrl: string | null;
  lastMessageAt: Date | null;
  lastMessage: Readonly<{
    role: ConversationRole;
    content: string;
    createdAt: Date;
  }> | null;
  isPinned: boolean;
  isMuted: boolean;
  sortRank: number | null;
  unreadCount?: number;
}>;

export type ConversationPreferencePatch = Readonly<{
  isPinned?: boolean;
  isMuted?: boolean;
  sortRank?: number | null;
}>;

export type PendingConversationMessage = Readonly<{ text: string; clientMessageId: string; assistance?: "translation" }>;
export type ReplyGenerationScope = Readonly<{ userId: string; conversationId: string; generationId: string }>;
export type ReplyGenerationClaimInput = ReplyGenerationScope & Readonly<{
  characterKey: string;
  messageId: string;
  messages: readonly PendingConversationMessage[];
  supersedes?: Readonly<{ generationId: string; visibleBubbleCount: number }>;
}>;
export type ReplyGenerationClaim = Readonly<{
  status: "claimed" | "in-progress" | "completed" | "cancelled";
  assistant: ConversationMessageRecord;
  userMessages: readonly ConversationMessageRecord[];
}>;

export type ConversationRepository = Readonly<{
  claimReplyGeneration?(input: ReplyGenerationClaimInput): Promise<ReplyGenerationClaim>;
  saveReplyPrefix?(input: ReplyGenerationScope & Readonly<{ prefix: string; userMessageIds?: readonly string[] }>): Promise<boolean>;
  finishReplyGeneration?(input: ReplyGenerationScope & Readonly<{ content: string; userMessageIds?: readonly string[] }>): Promise<ConversationMessageRecord | null>;
  cancelReplyGeneration?(input: ReplyGenerationScope): Promise<boolean>;
  getOrCreateConversation(userId: string, characterKey: string, characterVersion: number): Promise<string>;
  appendUserMessage(input: Readonly<{
    userId: string;
    conversationId: string;
    characterKey: string;
    clientMessageId: string;
    generationId: string;
    content: string;
    /** Declared assistance; absence never authorizes independent learning evidence. */
    sourceType?: "conversation" | "translation_assisted";
  }>): Promise<ConversationMessageRecord>;
  completeAssistantMessage(input: Readonly<{
    userId: string;
    conversationId: string;
    characterKey: string;
    messageId: string;
    generationId: string;
    clientMessageId: string;
    content: string;
    replyToMessageId: string;
  }>): Promise<ConversationMessageRecord>;
  findAssistantMessage(userId: string, conversationId: string, clientMessageId: string): Promise<ConversationMessageRecord | null>;
  listMessages(userId: string, characterKey: string, limit?: number): Promise<readonly ConversationMessageRecord[]>;
  listConversations(userId: string): Promise<readonly ConversationListRecord[]>;
  updateConversationPreference(userId: string, characterKey: string, patch: ConversationPreferencePatch): Promise<Readonly<{ characterKey: string; isPinned: boolean; isMuted: boolean; sortRank: number | null }>>;
  reorderConversationPreferences(userId: string, characterKeys: readonly string[]): Promise<void>;
  markConversationRead(userId: string, characterKey: string, readAt?: Date): Promise<void>;
  searchMessages(userId: string, query: string, limit?: number): Promise<readonly ConversationSearchResultRecord[]>;
  /** Returns whether a user-owned user turn can be deleted, including historical turns from retired characters. */
  canDeleteMessage?(userId: string, characterKey: string, messageId: string): Promise<boolean>;
  deleteMessage(userId: string, characterKey: string, messageId: string): Promise<boolean>;
  withdrawMessage(userId: string, characterKey: string, messageId: string): Promise<boolean>;
  isMessageWithdrawn?(userId: string, messageId: string): Promise<boolean>;
}>;
