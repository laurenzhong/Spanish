import type { Metadata } from "next";
import Link from "next/link";

import { SurfaceState } from "@/src/shared/ui/surface-state";

export const metadata: Metadata = {
  title: "对话",
};

export default function ChatPage() {
  return (
    <div className="page-stack chat-page">
      <header className="page-header page-header--simple chat-page__header">
        <div>
          <p className="eyebrow">长期陪伴</p>
          <h1>你的西语好友</h1>
          <p>聊天首先是自然交流，学习目标只在后台创造合适的话题机会。</p>
        </div>
      </header>

      <section className="conversation-hero" aria-labelledby="lucia-name">
        <div className="avatar avatar--lucia" aria-hidden="true">
          L
        </div>
        <div className="conversation-hero__body">
          <div className="conversation-hero__heading">
            <h2 id="lucia-name">Lucía Martín</h2>
            <span className="presence-dot">马德里</span>
          </div>
          <p className="conversation-hero__message">今天想聊聊你到西班牙后最期待的事。</p>
          <div className="conversation-hero__meta">
            <span>主要好友</span>
            <span>文字和语音都可以</span>
          </div>
        </div>
        <Link className="conversation-hero__action" href="/chat/lucia">
          打开对话
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </Link>
        <Link className="conversation-hero__action conversation-hero__action--secondary" href="/learn/practice">
          先练一句
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </Link>
      </section>

      <section className="chat-preview" aria-labelledby="chat-preview-title">
        <div className="chat-preview__topline">
          <p className="eyebrow eyebrow--accent">最近的话题</p>
          <span>还没有消息</span>
        </div>
        <h2 id="chat-preview-title">等你说第一句</h2>
        <p>Lucía 会先回应你真正想聊的事，再自然把话题往前带。</p>
        <SurfaceState
          description="完成第一次学习后，这里会出现与你有关的共同经历。"
          state="empty"
        />
      </section>
    </div>
  );
}
