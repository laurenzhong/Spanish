export type ConversationRole = "user" | "character";
export type ConversationMessageStatus = "streaming" | "completed" | "failed" | "cancelled";

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
}>;

export type ConversationSearchResultRecord = Readonly<ConversationMessageRecord & {
  characterKey: string;
  characterName: string;
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
  searchMessages(userId: string, query: string, limit?: number): Promise<readonly ConversationSearchResultRecord[]>;
}>;
