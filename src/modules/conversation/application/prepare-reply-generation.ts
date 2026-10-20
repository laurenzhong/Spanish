import type { ConversationRepository, ReplyGenerationClaim } from "../repositories/conversation-repository";
import type { ConversationStreamRequest } from "../schemas/conversation-stream-request";

/** Batch and claim commit before reading context; current user text appears only in userMessage. */
export async function prepareReplyGeneration(input: Readonly<{
  repository: ConversationRepository;
  userId: string;
  characterKey: string;
  characterVersion: number;
  messageId: string;
  request: ConversationStreamRequest;
}>) {
  const { repository, request } = input;
  if (!repository.claimReplyGeneration) throw new Error("CONVERSATION_UNAVAILABLE");
  const conversationId = await repository.getOrCreateConversation(input.userId, input.characterKey, input.characterVersion);
  const claim: ReplyGenerationClaim = await repository.claimReplyGeneration({
    userId: input.userId, conversationId, characterKey: input.characterKey, messageId: input.messageId,
    generationId: request.generationId, messages: [...(request.pendingMessages ?? []), { text: request.text, clientMessageId: request.clientMessageId, ...(request.assistance ? { assistance: request.assistance } : {}) }], supersedes: request.supersedes,
  });
  let history: Awaited<ReturnType<ConversationRepository["listMessages"]>> = [];
  if (claim.status === "claimed") {
    try { history = await repository.listMessages(input.userId, input.characterKey, 100); }
    catch (error) {
      await repository.cancelReplyGeneration?.({ userId: input.userId, conversationId, generationId: request.generationId });
      throw error;
    }
  }
  const withdrawn = new Set(history.filter((message) => message.status === "withdrawn").map((message) => message.id));
  const currentUser = claim.userMessages.at(-1);
  const recentMessages = history.filter((message) => message.id !== currentUser?.id && message.status !== "withdrawn"
    && !(message.role === "character" && message.replyToMessageId && withdrawn.has(message.replyToMessageId))
    && (message.role === "user" || (message.content.trim() && ["completed", "streaming", "cancelled"].includes(message.status))))
    .map((message) => ({ role: message.role, content: message.content, sentAt: message.createdAt.toISOString() }));
  return { conversationId, claim, userMessageId: currentUser?.id ?? null, recentMessages };
}
