import type { Metadata } from "next";
import Link from "next/link";

import { SurfaceState } from "@/src/shared/ui/surface-state";
import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

export const metadata: Metadata = {
  title: "对话",
};

export default function ChatPage() {
  return (
    <div className="page-stack chat-page conversation-page conversation-page--index">
      <div className="conversation-workspace conversation-workspace--index">
        <ConversationContactRail activeCharacterKey="lucia" />
        <main className="conversation-index" aria-labelledby="conversation-index-title">
          <header className="conversation-index__header">
            <p className="eyebrow eyebrow--accent">长期陪伴</p>
            <h1 id="conversation-index-title">你的西语好友</h1>
            <p>聊天首先是自然交流，学习目标只在后台创造合适的话题机会。</p>
          </header>

          <section className="conversation-index__feature" aria-labelledby="lucia-name">
            <div className="conversation-index__feature-head">
              <div className="avatar avatar--lucia" aria-hidden="true">L</div>
              <div>
                <h2 id="lucia-name">Lucía Martín</h2>
                <p>主要好友 · 文字和语音都可以</p>
              </div>
            </div>
            <p className="conversation-index__message">今天想聊聊你到西班牙后最期待的事。</p>
            <Link className="conversation-index__open" href="/chat/lucia">
              打开对话
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
            </Link>
            <Link className="conversation-index__practice" href="/learn/practice">先练一句</Link>
          </section>

          <section className="conversation-index__empty" aria-labelledby="chat-preview-title">
            <div className="conversation-index__empty-topline">
              <p className="eyebrow eyebrow--accent">最近的话题</p>
              <span>还没有消息</span>
            </div>
            <h2 id="chat-preview-title">等你说第一句</h2>
            <p>Lucía 会先回应你真正想聊的事，再自然把话题往前带。</p>
            <SurfaceState description="完成第一次学习后，这里会出现与你有关的共同经历。" state="empty" />
          </section>

          <div id="introductions"><IntroductionInbox /></div>
        </main>
      </div>
    </div>
  );
}
