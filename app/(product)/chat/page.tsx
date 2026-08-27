import type { Metadata } from "next";

import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { getConversationCharacter } from "@/src/modules/conversation";

export const metadata: Metadata = {
  title: "对话",
};

export default function ChatPage() {
  const lucia = getConversationCharacter("lucia");
  return (
    <div className="page-stack chat-page conversation-page conversation-page--workspace">
      <div className="conversation-workspace">
        <ConversationContactRail activeCharacterKey="lucia" />
        <ChatThread characterKey={lucia.key} characterName={lucia.displayName} roleLabel={lucia.roleLabel} characterVersion={lucia.version} avatarClassName={lucia.avatarClass} />
      </div>
      <div id="introductions" className="conversation-introductions-anchor"><IntroductionInbox alwaysVisible /></div>
    </div>
  );
}
