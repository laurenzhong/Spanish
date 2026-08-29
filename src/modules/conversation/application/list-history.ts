import type { ConversationMessage } from "../domain/conversation-state";
import type { ConversationRepository } from "../repositories/conversation-repository";

export async function listConversationHistory(
  repository: ConversationRepository,
  userId: string,
  characterKey: string,
): Promise<readonly ConversationMessage[]> {
  const messages = await repository.listMessages(userId, characterKey);
  return messages.map((message) => ({
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
