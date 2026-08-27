import type { Metadata } from "next";

import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";

export const metadata: Metadata = {
  title: "对话",
};

export default function ChatPage() {
  return (
    <div className="page-stack chat-page conversation-page conversation-page--workspace">
      <div className="conversation-workspace">
        <ConversationContactRail activeCharacterKey="lucia" />
        <ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />
      </div>
      <div id="introductions" className="conversation-introductions-anchor"><IntroductionInbox alwaysVisible /></div>
    </div>
  );
}
