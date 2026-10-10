import type { ConversationMessage } from "../domain/conversation-state";
import type { ConversationRepository } from "../repositories/conversation-repository";

export async function listConversationHistory(
  repository: ConversationRepository,
  userId: string,
  characterKey: string,
): Promise<readonly ConversationMessage[]> {
  const messages = await repository.listMessages(userId, characterKey);
  // A completed assistant reply is linked to the user turn it answers. Once
  // that user turn is withdrawn, do not resurrect the assistant content when
  // history is reloaded (the streaming route already suppresses context and
  // memory extraction for this case).
  const withdrawnMessageIds = new Set(
    messages
      .filter((message) => message.status === "withdrawn")
      .map((message) => message.id),
  );
  return messages
    .filter((message) => !(
      message.role === "character"
      && message.replyToMessageId
      && withdrawnMessageIds.has(message.replyToMessageId)
    ))
    .map((message) => ({
      id: message.id,
      clientMessageId: message.role === "user" ? message.clientMessageId : undefined,
      generationId: message.generationId ?? undefined,
      role: message.role,
      text: message.status === "withdrawn" ? "" : message.content,
      complete: message.status === "completed" || message.status === "withdrawn",
      status: message.status === "withdrawn" ? "withdrawn" : "completed",
      withdrawn: message.status === "withdrawn",
      createdAt: message.createdAt.toISOString(),
      sourceType: message.sourceType,
    }));
}
