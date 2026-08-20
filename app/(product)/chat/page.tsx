import type { Metadata } from "next";

import { SurfaceState } from "@/src/shared/ui/surface-state";

export const metadata: Metadata = {
  title: "对话",
};

export default function ChatPage() {
  return (
    <div className="page-stack">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">长期陪伴</p>
          <h1>你的西语好友</h1>
          <p>聊天首先是自然交流，学习目标只在后台创造合适的话题机会。</p>
        </div>
      </header>

      <section className="contact-card" aria-labelledby="lucia-name">
        <div className="avatar avatar--lucia" aria-hidden="true">
          L
        </div>
        <div className="contact-card__body">
          <div className="contact-card__heading">
            <h2 id="lucia-name">Lucía Martín</h2>
            <span>马德里</span>
          </div>
          <p>今天想聊聊你到西班牙后最期待的事。</p>
          <small>主要好友 · 原型预览</small>
        </div>
      </section>

      <SurfaceState
        description="Lucía 了解你的兴趣后，会以介绍朋友的方式自然扩展联系人。"
        state="empty"
      />
    </div>
  );
}
