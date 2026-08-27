"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConversationSearch } from "./conversation-search";

type ConversationContactRailProps = Readonly<{
  activeCharacterKey?: string;
}>;

export function ConversationContactRail({ activeCharacterKey }: ConversationContactRailProps) {
  const [conversations, setConversations] = useState<readonly ConversationPreview[]>([]);
  const [status, setStatus] = useState<"loading" | "available" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/conversations", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("CONVERSATION_LIST_UNAVAILABLE");
        return response.json() as Promise<{ data?: { conversations?: ConversationPreview[] } }>;
      })
      .then((payload) => {
        setConversations(payload.data?.conversations ?? []);
        setStatus("available");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  return (
    <aside className="conversation-contact-rail" aria-label="联系人">
      <div className="conversation-contact-rail__heading">
        <div>
          <p className="eyebrow eyebrow--accent">私信</p>
          <h2>对话</h2>
        </div>
        <span className="conversation-contact-rail__count">{status === "available" ? `${conversations.length} 个会话` : "真实会话"}</span>
      </div>

      <ConversationSearch />

      <p className="conversation-contact-rail__label">最近</p>
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        {status === "loading" ? <p className="conversation-contact-rail__state">正在加载会话……</p> : null}
        {status === "unavailable" ? <p className="conversation-contact-rail__state" role="alert">暂时无法加载会话列表，请稍后重试。</p> : null}
        {status === "available" && conversations.length === 0 ? <p className="conversation-contact-rail__state">还没有已保存的会话。打开一个角色开始聊天。</p> : null}
        {conversations.map((conversation) => (
          <Link
            className={`conversation-contact-row ${activeCharacterKey === conversation.characterKey ? "conversation-contact-row--active" : ""}`}
            href={`/chat/${conversation.characterKey}`}
            aria-current={activeCharacterKey === conversation.characterKey ? "page" : undefined}
            key={conversation.conversationId}
          >
            <span className={`avatar ${conversation.avatarClass}`} aria-hidden="true">{conversation.characterName.slice(0, 1)}</span>
            <span className="conversation-contact-row__body">
              <strong>{conversation.characterName}</strong>
              <small>{conversation.roleLabel}</small>
              {conversation.lastMessage ? <span className="conversation-contact-row__preview">{conversation.lastMessage.snippet}</span> : null}
            </span>
            {conversation.lastMessageAt ? <time className="conversation-contact-row__time" dateTime={conversation.lastMessageAt}>{formatConversationTime(conversation.lastMessageAt)}</time> : null}
          </Link>
        ))}
      </nav>

      <div className="conversation-contact-rail__footer">
        <Link href="/chat#introductions" className="conversation-contact-rail__request">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 8v6M14 11h6" /></svg>
          <span>查看介绍请求</span>
        </Link>
        <p>新的角色会在真实介绍发生后出现在这里。</p>
      </div>
    </aside>
  );
}

type ConversationPreview = Readonly<{
  conversationId: string;
  characterKey: string;
  characterName: string;
  avatarClass: string;
  roleLabel: string;
  lastMessageAt: string | null;
  lastMessage: { snippet: string } | null;
}>;

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
