import type { Metadata } from "next";
import Link from "next/link";

import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

export const metadata: Metadata = {
  title: "对话",
};

export default async function ChatPage() {
  return (
    <div className="page-stack chat-page conversation-page conversation-page--workspace">
      <div className="conversation-workspace">
        <ConversationContactRail />
        <section className="conversation-empty-state" aria-labelledby="conversation-empty-state-title">
          <h1 id="conversation-empty-state-title">选择一个对话</h1>
          <p>从左侧联系人列表打开消息。</p>
          <Link className="button button--primary" href="/chat/lucia">打开 Lucía 对话</Link>
        </section>
      </div>
    </div>
  );
}
