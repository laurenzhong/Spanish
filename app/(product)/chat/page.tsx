import type { Metadata } from "next";

import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { createDrizzleConversationRepository, getConversationCharacter, listConversationHistory } from "@/src/modules/conversation";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = {
  title: "对话",
};

export default async function ChatPage() {
  const lucia = getConversationCharacter("lucia");
  const user = await getCurrentUser();
  let initialMessages;
  if (user && process.env.DATABASE_URL) {
    try {
      initialMessages = await listConversationHistory(createDrizzleConversationRepository(getDatabase()), user.id, lucia.key);
    } catch {
      initialMessages = undefined;
    }
  }
  return (
    <div className="page-stack chat-page conversation-page conversation-page--workspace">
      <div className="conversation-workspace">
        <ConversationContactRail activeCharacterKey="lucia" />
        <ChatThread characterKey={lucia.key} characterName={lucia.displayName} roleLabel={lucia.roleLabel} characterVersion={lucia.version} avatarClassName={lucia.avatarClass} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
