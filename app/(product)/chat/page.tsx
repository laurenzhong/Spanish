import type { Metadata } from "next";

import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

export const metadata: Metadata = {
  title: "对话",
};

/**
 * The conversation workspace behaves like a chat client: the contact list owns
 * the left pane and the right pane stays empty until a conversation is chosen.
 * Opening the page performs no database read at all, so the contacts are the
 * first thing on screen; each contact row is an equal, real entry into its
 * conversation.
 */
export default function ChatPage() {
  return (
    <div className="page-stack chat-page conversation-page conversation-page--workspace">
      <div className="conversation-workspace">
        <ConversationContactRail />
      </div>
    </div>
  );
}
