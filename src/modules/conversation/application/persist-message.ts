import type { ConversationRepository, ConversationMessageRecord } from "../repositories";

export function persistUserMessage(repository: ConversationRepository, input: Parameters<ConversationRepository["appendUserMessage"]>[0]): Promise<ConversationMessageRecord> {
  return repository.appendUserMessage(input);
}

export function persistCompletedAssistantMessage(repository: ConversationRepository, input: Parameters<ConversationRepository["completeAssistantMessage"]>[0]): Promise<ConversationMessageRecord> {
  return repository.completeAssistantMessage(input);
}

