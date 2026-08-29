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
}>;

export type ConversationPreferencePatch = Readonly<{
  isPinned?: boolean;
  isMuted?: boolean;
  sortRank?: number | null;
}>;

export type ConversationRepository = Readonly<{
  getOrCreateConversation(userId: string, characterKey: string, characterVersion: number): Promise<string>;
  appendUserMessage(input: Readonly<{
    userId: string;
    conversationId: string;
    characterKey: string;
    clientMessageId: string;
    generationId: string;
    content: string;
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
  searchMessages(userId: string, query: string, limit?: number): Promise<readonly ConversationSearchResultRecord[]>;
  deleteMessage(userId: string, characterKey: string, messageId: string): Promise<boolean>;
  withdrawMessage(userId: string, characterKey: string, messageId: string): Promise<boolean>;
  isMessageWithdrawn?(userId: string, messageId: string): Promise<boolean>;
}>;
