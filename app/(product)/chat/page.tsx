import type { Metadata } from "next";

import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { createDrizzleConversationRepository, getConversationCharacter, listConversationHistory, toConversationPreviews, type ConversationPreview } from "@/src/modules/conversation";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = {
  title: "对话",
};

export default async function ChatPage() {
  const lucia = getConversationCharacter("lucia");
  let initialMessages;
  let initialConversations: readonly ConversationPreview[] | undefined;
  if (process.env.DATABASE_URL) {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("unauthenticated");
      const repository = createDrizzleConversationRepository(getDatabase());
      const [messages, conversations] = await Promise.all([
        listConversationHistory(repository, user.id, lucia.key),
        repository.listConversations(user.id),
      ]);
      initialMessages = messages;
      initialConversations = toConversationPreviews(conversations);
    } catch {
      initialMessages = undefined;
      initialConversations = undefined;
    }
  }
  return (
    <div className="page-stack chat-page conversation-page conversation-page--workspace">
      <div className="conversation-workspace">
        <ConversationContactRail activeCharacterKey="lucia" {...(initialConversations ? { initialConversations } : {})} />
        <ChatThread characterKey={lucia.key} characterName={lucia.displayName} roleLabel={lucia.roleLabel} characterVersion={lucia.version} avatarClassName={lucia.avatarClass} {...(initialMessages ? { initialMessages } : {})} />
      </div>
    </div>
  );
}
