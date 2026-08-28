"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConversationSearch } from "./conversation-search";
import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { prefetchConversationHistory } from "./conversation-history-cache";

type ConversationContactRailProps = Readonly<{
  activeCharacterKey?: string;
}>;

let cachedConversations: readonly ConversationPreview[] | null = null;
let cachedStatus: "loading" | "available" | "unavailable" = "loading";
let listRequest: Promise<void> | null = null;
let cachedLuciaContact: LuciaContactPreview | null = null;
let luciaContactRequest: Promise<void> | null = null;

function loadConversationList(force = false): Promise<void> {
  if (listRequest) return listRequest;
  if (!force && (cachedConversations !== null || cachedStatus === "unavailable")) return Promise.resolve();
  cachedStatus = "loading";
  listRequest = fetch("/api/v1/conversations", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("CONVERSATION_LIST_UNAVAILABLE");
      return response.json() as Promise<{ data?: { conversations?: ConversationPreview[] } }>;
    })
    .then((payload) => {
      cachedConversations = payload.data?.conversations ?? [];
      cachedStatus = "available";
    })
    .catch(() => {
      cachedStatus = "unavailable";
    })
    .finally(() => { listRequest = null; });
  return listRequest;
}

function loadLuciaContact(): Promise<void> {
  if (luciaContactRequest) return luciaContactRequest;
  if (cachedLuciaContact !== null) return Promise.resolve();
  luciaContactRequest = fetch("/api/v1/character-network/lucia-contact", { cache: "no-store" })
    .then((response) => { if (!response.ok) throw new Error("CONTACT_UNAVAILABLE"); return response.json() as Promise<{ data?: LuciaContactPreview }>; })
    .then((payload) => { cachedLuciaContact = payload.data ?? null; })
    .catch(() => { cachedLuciaContact = null; })
    .finally(() => { luciaContactRequest = null; });
  return luciaContactRequest;
}

export function ConversationContactRail({ activeCharacterKey }: ConversationContactRailProps) {
  const [conversations, setConversations] = useState<readonly ConversationPreview[]>(cachedConversations ?? []);
  const [status, setStatus] = useState(cachedStatus);
  const [luciaContact, setLuciaContact] = useState<LuciaContactPreview | null>(cachedLuciaContact);
  const [showIntroductions, setShowIntroductions] = useState(false);

  useEffect(() => {
    let active = true;
    void loadConversationList().then(() => {
      if (!active) return;
      setConversations(cachedConversations ?? []);
      setStatus(cachedStatus);
    });
    void loadLuciaContact().then(() => setLuciaContact(cachedLuciaContact));
    return () => { active = false; };
  }, []);

  const visibleConversations = conversations;

  return (
    <aside className="conversation-contact-rail" aria-label="联系人">
      <div className="conversation-contact-rail__heading">
        <div>
          <h2>好友</h2>
        </div>
        <span className="conversation-contact-rail__count">{visibleConversations.length} 位好友</span>
      </div>

      <ConversationSearch />

      <p className="conversation-contact-rail__label">最近</p>
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        {status === "loading" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">正在加载会话……</p> : null}
        {status === "unavailable" ? <div className="conversation-contact-rail__state" role="alert"><p>暂时无法加载会话列表。</p><button type="button" onClick={() => { setStatus("loading"); void loadConversationList(true).then(() => { setConversations(cachedConversations ?? []); setStatus(cachedStatus); }); }}>重试</button></div> : null}
        {status === "available" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">还没有联系人。你可以先查看新的好友申请。</p> : null}
        {visibleConversations.map((conversation) => (
          <Link
            className={`conversation-contact-row ${activeCharacterKey === conversation.characterKey ? "conversation-contact-row--active" : ""}`}
            href={`/chat/${conversation.characterKey}`}
            onMouseEnter={() => prefetchConversationHistory(conversation.characterKey)}
            onFocus={() => prefetchConversationHistory(conversation.characterKey)}
            aria-current={activeCharacterKey === conversation.characterKey ? "page" : undefined}
            key={conversation.conversationId}
          >
            <span className={`avatar ${conversation.avatarClass}`} aria-hidden="true">{conversation.characterName.slice(0, 1)}</span>
            <span className="conversation-contact-row__body">
              <strong>{conversation.characterName}</strong>
              <small>{conversation.roleLabel}</small>
              {conversation.lastMessage ? <span className="conversation-contact-row__preview">{conversation.lastMessage.snippet}</span> : null}
            </span>
            {conversation.characterKey === "lucia" ? <span className="conversation-contact-row__marker" aria-label="已置顶">置顶</span> : null}
            {conversation.lastMessageAt ? <time className="conversation-contact-row__time" dateTime={conversation.lastMessageAt}>{formatConversationTime(conversation.lastMessageAt)}</time> : <span className="conversation-contact-row__new">开始对话</span>}
          </Link>
        ))}
      </nav>

      <div className="conversation-contact-rail__footer">
        <button type="button" className="conversation-contact-rail__request" onClick={() => setShowIntroductions(true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 8v6M14 11h6" /></svg>
          <span>查看好友申请和介绍</span>
          {luciaContact?.status === "pending" ? <span className="conversation-contact-rail__request-dot" aria-label="有新的好友申请" /> : null}
        </button>
        <p>会话记录会在发送第一条消息后保存。</p>
      </div>
      {showIntroductions ? <div className="conversation-introductions-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-introductions-dialog-title">
        <div className="conversation-introductions-dialog__panel">
          <div className="conversation-introductions-dialog__heading"><h2 id="conversation-introductions-dialog-title">介绍请求</h2><button type="button" aria-label="关闭介绍请求" onClick={() => setShowIntroductions(false)}>×</button></div>
          <IntroductionInbox alwaysVisible />
        </div>
      </div> : null}
    </aside>
  );
}

type ConversationPreview = Readonly<{
  conversationId: string;
  characterKey: string;
  characterName: string;
  avatarClass: string;
  roleLabel: string;
  homeLocation?: string;
  lastMessageAt: string | null;
  lastMessage: { snippet: string } | null;
}>;

type LuciaContactPreview = Readonly<{
  characterKey: "lucia";
  status: "pending" | "active" | "declined";
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  conversationId: string | null;
  source: Readonly<{ kind: "cultural-event"; city: "Madrid"; topic: "urban-photography" }>;
}>;

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
