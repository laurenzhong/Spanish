"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

type ConversationPreference = Readonly<{
  isPinned: boolean;
  isMuted: boolean;
  sortRank: number | null;
}>;

type ConversationPreferences = Readonly<Record<string, ConversationPreference>>;

type ContextMenuState = Readonly<{
  characterKey: string;
  x: number;
  y: number;
}>;

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
  const [preferences, setPreferences] = useState<ConversationPreferences>({});
  const [markedUnread, setMarkedUnread] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [preferenceError, setPreferenceError] = useState(false);
  const [isManagingOrder, setIsManagingOrder] = useState(false);
  const [draggedCharacterKey, setDraggedCharacterKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadConversationList().then(() => {
      if (!active) return;
      const nextConversations = cachedConversations ?? [];
      setConversations(nextConversations);
      setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }])))
      setStatus(cachedStatus);
    });
    void loadLuciaContact().then(() => setLuciaContact(cachedLuciaContact));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  function preferenceFor(conversation: ConversationPreview): ConversationPreference {
    return preferences[conversation.characterKey] ?? {
      isPinned: conversation.isPinned ?? conversation.characterKey === "lucia",
      isMuted: false,
      sortRank: conversation.sortRank ?? null,
    };
  }

  async function updatePreference(characterKey: string, patch: Partial<ConversationPreference>) {
    const previous = preferences[characterKey] ?? { isPinned: characterKey === "lucia", isMuted: false, sortRank: null };
    const next = { ...previous, ...patch };
    setPreferences((current) => ({
      ...current,
      [characterKey]: next,
    }));
    setPreferenceError(false);
    try {
      const response = await fetch("/api/v1/conversations/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterKey, ...patch }),
      });
      if (!response.ok) throw new Error("PREFERENCE_SAVE_FAILED");
    } catch {
      setPreferences((current) => ({ ...current, [characterKey]: previous }));
      setPreferenceError(true);
    }
  }

  const visibleConversations = [...conversations].sort((left, right) => {
    const leftPinned = preferenceFor(left).isPinned ? 1 : 0;
    const rightPinned = preferenceFor(right).isPinned ? 1 : 0;
    if (rightPinned !== leftPinned) return rightPinned - leftPinned;
    const leftRank = preferenceFor(left).sortRank;
    const rightRank = preferenceFor(right).sortRank;
    if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return leftRank - rightRank;
    if (leftRank !== null && rightRank === null) return -1;
    if (leftRank === null && rightRank !== null) return 1;
    return 0;
  });
  const contextConversation = contextMenu
    ? visibleConversations.find((conversation) => conversation.characterKey === contextMenu.characterKey) ?? null
    : null;
  const contextPreference = contextConversation ? preferenceFor(contextConversation) : null;

  function openContextMenu(event: React.MouseEvent, characterKey: string) {
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(characterKey, event.clientX, event.clientY);
  }

  function openContextMenuAt(characterKey: string, clientX: number, clientY: number) {
    setContextMenu({
      characterKey,
      x: Math.min(clientX, Math.max(8, window.innerWidth - 240)),
      y: Math.min(clientY, Math.max(8, window.innerHeight - 250)),
    });
  }

  function openContextMenuFromButton(event: React.MouseEvent<HTMLButtonElement>, characterKey: string) {
    event.stopPropagation();
    openContextMenu(event, characterKey);
  }

  async function applyOrder(nextConversations: readonly ConversationPreview[]) {
    const order = nextConversations.map((conversation) => conversation.characterKey);
    const previous = preferences;
    setPreferences((current) => Object.fromEntries(order.map((characterKey, sortRank) => [characterKey, { ...(current[characterKey] ?? { isPinned: characterKey === "lucia", isMuted: false, sortRank: null }), sortRank }])))
    try {
      const response = await fetch("/api/v1/conversations/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedCharacterKeys: order }) });
      if (!response.ok) throw new Error("ORDER_SAVE_FAILED");
      setPreferenceError(false);
    } catch {
      setPreferences(previous);
      setPreferenceError(true);
    }
  }

  function moveCharacter(characterKey: string, direction: -1 | 1) {
    const index = visibleConversations.findIndex((conversation) => conversation.characterKey === characterKey);
    if (index < 0) return;
    const currentPinned = preferenceFor(visibleConversations[index]!).isPinned;
    let target = index + direction;
    while (target >= 0 && target < visibleConversations.length && preferenceFor(visibleConversations[target]!).isPinned !== currentPinned) target += direction;
    if (target < 0 || target >= visibleConversations.length) return;
    const next = [...visibleConversations];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    void applyOrder(next);
  }

  return (
    <aside className="conversation-contact-rail" aria-label="联系人">
      <div className="conversation-contact-rail__heading">
        <div>
          <h2>好友</h2>
        </div>
        <span className="conversation-contact-rail__count">{visibleConversations.length} 位好友</span>
      </div>

      <ConversationSearch />
      {preferenceError ? <p className="conversation-contact-rail__preference-error" role="status">好友设置暂未保存，请稍后重试。</p> : null}
      {isManagingOrder ? <div className="conversation-contact-rail__manage-bar" role="status"><span>正在调整顺序</span><button type="button" onClick={() => { setIsManagingOrder(false); setDraggedCharacterKey(null); }}>完成</button></div> : <button type="button" className="conversation-contact-rail__manage-trigger" onClick={() => setIsManagingOrder(true)}>管理好友顺序</button>}

      <p className="conversation-contact-rail__label">最近</p>
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        {status === "loading" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">正在加载会话……</p> : null}
        {status === "unavailable" ? <div className="conversation-contact-rail__state" role="alert"><p>暂时无法加载会话列表。</p><button type="button" onClick={() => { setStatus("loading"); void loadConversationList(true).then(() => { const nextConversations = cachedConversations ?? []; setConversations(nextConversations); setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }]))); setStatus(cachedStatus); }); }}>重试</button></div> : null}
        {status === "available" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">还没有联系人。你可以先查看新的好友申请。</p> : null}
        {visibleConversations.map((conversation) => {
          const preference = preferenceFor(conversation);
          const isUnread = markedUnread.has(conversation.characterKey);
          return (
            <div
              className="conversation-contact-row-shell"
              key={conversation.conversationId}
              onDragOver={(event) => { if (isManagingOrder) event.preventDefault(); }}
              onDrop={(event) => {
                event.preventDefault();
                if (!isManagingOrder || !draggedCharacterKey || draggedCharacterKey === conversation.characterKey) return;
                const from = visibleConversations.findIndex((item) => item.characterKey === draggedCharacterKey);
                const to = visibleConversations.findIndex((item) => item.characterKey === conversation.characterKey);
                if (from < 0 || to < 0 || preferenceFor(visibleConversations[from]!).isPinned !== preferenceFor(visibleConversations[to]!).isPinned) return;
                const next = [...visibleConversations];
                const [moved] = next.splice(from, 1);
                if (moved) next.splice(to, 0, moved);
                setDraggedCharacterKey(null);
                void applyOrder(next);
              }}
              onContextMenu={(event) => openContextMenu(event, conversation.characterKey)}
              onTouchStart={(event) => {
                if (event.touches.length !== 1) return;
                const touch = event.touches[0];
                longPressTimer.current = window.setTimeout(() => { suppressClick.current = true; openContextMenuAt(conversation.characterKey, touch.clientX, touch.clientY); }, 450);
              }}
              onTouchEnd={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }}
              onTouchCancel={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }}
            >
              <Link
                className={`conversation-contact-row ${activeCharacterKey === conversation.characterKey ? "conversation-contact-row--active" : ""} ${isUnread ? "conversation-contact-row--unread" : ""}`}
                href={`/chat/${conversation.characterKey}`}
                onClick={(event) => {
                  if (suppressClick.current) {
                    event.preventDefault();
                    suppressClick.current = false;
                    return;
                  }
                  setMarkedUnread((current) => { const next = new Set(current); next.delete(conversation.characterKey); return next; });
                }}
                onMouseEnter={() => prefetchConversationHistory(conversation.characterKey)}
                onFocus={() => prefetchConversationHistory(conversation.characterKey)}
                aria-current={activeCharacterKey === conversation.characterKey ? "page" : undefined}
                aria-label={`${conversation.characterName} ${conversation.roleLabel}${isUnread ? "，未读" : ""}${preference.isMuted ? "，已静音" : ""}`}
              >
                <span className={`avatar ${conversation.avatarClass}`} aria-hidden="true">{conversation.characterName.slice(0, 1)}</span>
                <span className="conversation-contact-row__body">
                  <strong>{conversation.characterName}</strong>
                  <small>{conversation.roleLabel}</small>
                  {conversation.lastMessage ? <span className="conversation-contact-row__preview">{conversation.lastMessage.snippet}</span> : null}
                </span>
                {preference.isPinned ? <span className="conversation-contact-row__marker" aria-label="已置顶">置顶</span> : null}
                {isUnread ? <span className="conversation-contact-row__unread" aria-label="未读" /> : null}
                {preference.isMuted ? <span className="conversation-contact-row__muted" aria-label="已静音">静音</span> : null}
                {conversation.lastMessageAt ? <time className="conversation-contact-row__time" dateTime={conversation.lastMessageAt}>{formatConversationTime(conversation.lastMessageAt)}</time> : <span className="conversation-contact-row__new">开始对话</span>}
              </Link>
              {isManagingOrder ? <div className="conversation-contact-row__reorder-controls">
                <button type="button" draggable aria-label={`拖动 ${conversation.characterName}`} onDragStart={() => setDraggedCharacterKey(conversation.characterKey)} onDragEnd={() => setDraggedCharacterKey(null)}>⋮⋮</button>
                <button type="button" aria-label={`上移 ${conversation.characterName}`} onClick={() => moveCharacter(conversation.characterKey, -1)}>↑</button>
                <button type="button" aria-label={`下移 ${conversation.characterName}`} onClick={() => moveCharacter(conversation.characterKey, 1)}>↓</button>
              </div> : null}
              {!isManagingOrder ? <button
                className="conversation-contact-row__menu-button"
                type="button"
                aria-label={`管理 ${conversation.characterName}`}
                onClick={(event) => openContextMenuFromButton(event, conversation.characterKey)}
              >
                <span aria-hidden="true">•••</span>
              </button> : null}
            </div>
          );
        })}
      </nav>

      {contextMenu && contextConversation && contextPreference ? (
        <div className="conversation-contact-context-menu" role="menu" aria-label={`${contextConversation.characterName} 的好友操作`} style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { updatePreference(contextConversation.characterKey, { isPinned: !contextPreference.isPinned }); setContextMenu(null); }}>
            {contextPreference.isPinned ? "取消置顶" : "置顶此好友"}
          </button>
          <button type="button" role="menuitem" onClick={() => { setMarkedUnread((current) => { const next = new Set(current); if (next.has(contextConversation.characterKey)) next.delete(contextConversation.characterKey); else next.add(contextConversation.characterKey); return next; }); setContextMenu(null); }}>
            {markedUnread.has(contextConversation.characterKey) ? "标记为已读" : "标记为未读"}
          </button>
          <button type="button" role="menuitem" onClick={() => { updatePreference(contextConversation.characterKey, { isMuted: !contextPreference.isMuted }); setContextMenu(null); }}>
            {contextPreference.isMuted ? "开启通知" : "静音通知"}
          </button>
          <div className="conversation-contact-context-menu__separator" role="separator" />
          <Link role="menuitem" href={`/chat/${contextConversation.characterKey}`} onClick={() => setContextMenu(null)}>打开好友对话</Link>
          <button type="button" role="menuitem" onClick={() => { setIsManagingOrder(true); setContextMenu(null); }}>管理好友顺序</button>
        </div>
      ) : null}

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
  isPinned?: boolean;
  isMuted?: boolean;
  sortRank?: number | null;
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
