"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConversationSearch } from "./conversation-search";
import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { prefetchConversationHistory } from "./conversation-history-cache";
import { ConversationTypingIndicator } from "@/src/shared/ui/conversation-typing-indicator";
import type { ConversationPreview } from "../application/list-previews";

type ConversationContactRailProps = Readonly<{
  activeCharacterKey?: string;
  initialConversations?: readonly ConversationPreview[];
}>;

let cachedConversations: readonly ConversationPreview[] | null = null;
let cachedStatus: "loading" | "available" | "unavailable" = "loading";
let listRequest: Promise<void> | null = null;
let cachedLuciaContact: LuciaContactPreview | null = null;
let luciaContactRequest: Promise<void> | null = null;
let cachedIntroductionOfferCount: number | null = null;
let introductionOfferRequest: Promise<void> | null = null;

const CONTACT_SEARCH_THRESHOLD = 8;

export function clearConversationContactCache(): void {
  cachedConversations = null;
  cachedStatus = "loading";
  listRequest = null;
  cachedLuciaContact = null;
  luciaContactRequest = null;
  cachedIntroductionOfferCount = null;
  introductionOfferRequest = null;
}

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

type DragState = Readonly<{
  characterKey: string;
  startY: number;
  active: boolean;
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

function loadLuciaContact(force = false): Promise<void> {
  if (luciaContactRequest) return luciaContactRequest;
  if (!force && cachedLuciaContact !== null) return Promise.resolve();
  luciaContactRequest = fetch("/api/v1/character-network/lucia-contact", { cache: "no-store" })
    .then((response) => { if (!response.ok) throw new Error("CONTACT_UNAVAILABLE"); return response.json() as Promise<{ data?: LuciaContactPreview }>; })
    .then((payload) => { cachedLuciaContact = payload.data ?? null; })
    .catch(() => { cachedLuciaContact = null; })
    .finally(() => { luciaContactRequest = null; });
  return luciaContactRequest;
}

function loadIntroductionOfferCount(force = false): Promise<void> {
  if (introductionOfferRequest) return introductionOfferRequest;
  if (!force && cachedIntroductionOfferCount !== null) return Promise.resolve();
  introductionOfferRequest = fetch("/api/v1/character-network/introductions", { cache: "no-store" })
    .then((response) => { if (!response.ok) throw new Error("INTRODUCTIONS_UNAVAILABLE"); return response.json() as Promise<{ data?: { offers?: unknown[] } }>; })
    .then((payload) => { cachedIntroductionOfferCount = payload.data?.offers?.length ?? 0; })
    .catch(() => { cachedIntroductionOfferCount = null; })
    .finally(() => { introductionOfferRequest = null; });
  return introductionOfferRequest;
}

function syncCachedConversationPreferences(updates: Readonly<Record<string, Partial<ConversationPreference>>>): void {
  if (!cachedConversations) return;
  cachedConversations = cachedConversations.map((conversation) => {
    const update = updates[conversation.characterKey];
    return update ? { ...conversation, ...update } : conversation;
  });
}

export function ConversationContactRail({ activeCharacterKey, initialConversations }: ConversationContactRailProps) {
  const [conversations, setConversations] = useState<readonly ConversationPreview[]>(initialConversations ?? cachedConversations ?? []);
  const [status, setStatus] = useState(initialConversations ? "available" : cachedStatus);
  const [showIntroductions, setShowIntroductions] = useState(false);
  const [pendingIntroductionCount, setPendingIntroductionCount] = useState(0);
  const [preferences, setPreferences] = useState<ConversationPreferences>({});
  const [markedUnread, setMarkedUnread] = useState<ReadonlySet<string>>(() => new Set());
  const [typingCharacters, setTypingCharacters] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const suppressClickFor = useRef<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const introductionsTriggerRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef<DragState | null>(null);
  const dragOverCharacterKeyRef = useRef<string | null>(null);
  const [preferenceError, setPreferenceError] = useState(false);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);
  const [draggedCharacterKey, setDraggedCharacterKey] = useState<string | null>(null);
  const [dragOverCharacterKey, setDragOverCharacterKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (initialConversations && cachedConversations === null) {
      cachedConversations = initialConversations;
      cachedStatus = "available";
    }
    void loadConversationList().then(() => {
      if (!active) return;
      const nextConversations = cachedConversations ?? [];
      setConversations(nextConversations);
      setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }])))
      setStatus(cachedStatus);
    });
    // Revalidate relationship requests on each mounted rail. These responses are
    // user-scoped and must not leak across navigation or test/session boundaries.
    void Promise.all([loadLuciaContact(true), loadIntroductionOfferCount(true)]).then(() => {
      if (!active) return;
      setPendingIntroductionCount((cachedIntroductionOfferCount ?? 0) + (cachedLuciaContact?.status === "pending" ? 1 : 0));
    });
    return () => { active = false; };
  }, [initialConversations]);

  useEffect(() => {
    if (!showIntroductions) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowIntroductions(false);
      introductionsTriggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showIntroductions]);

  function closeIntroductions() {
    setShowIntroductions(false);
    introductionsTriggerRef.current?.focus();
    void loadIntroductionOfferCount(true).then(() => {
      setPendingIntroductionCount((cachedIntroductionOfferCount ?? 0) + (cachedLuciaContact?.status === "pending" ? 1 : 0));
    });
  }

  useEffect(() => {
    const handleTyping = (event: Event) => {
      const detail = (event as CustomEvent<{ characterKey?: unknown; isTyping?: unknown }>).detail;
      if (typeof detail?.characterKey !== "string" || typeof detail.isTyping !== "boolean") return;
      const characterKey = detail.characterKey;
      setTypingCharacters((current) => {
        const next = new Set(current);
        if (detail.isTyping) next.add(characterKey);
        else next.delete(characterKey);
        return next;
      });
    };
    window.addEventListener("conversation-typing", handleTyping);
    return () => window.removeEventListener("conversation-typing", handleTyping);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const railRect = railRef.current?.getBoundingClientRect();
    const maxX = railRect ? railRect.width - rect.width - 8 : window.innerWidth - rect.width - 8;
    const maxY = railRect ? (railRef.current?.scrollHeight ?? railRect.height) - rect.height - 8 : window.innerHeight - rect.height - 8;
    const x = Math.max(8, Math.min(contextMenu.x, maxX));
    const y = Math.max(8, Math.min(contextMenu.y, maxY));
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ ...contextMenu, x, y });
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
    setPreferenceNotice(null);
    try {
      const response = await fetch("/api/v1/conversations/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterKey, ...patch }),
      });
      if (!response.ok) throw new Error("PREFERENCE_SAVE_FAILED");
      syncCachedConversationPreferences({ [characterKey]: next });
      setPreferenceNotice(patch.isPinned !== undefined ? (patch.isPinned ? "已置顶好友" : "已取消置顶") : patch.isMuted !== undefined ? (patch.isMuted ? "已静音通知" : "已开启通知") : "好友设置已保存");
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

  function refreshAfterLuciaContactAccepted(contact: LuciaContactPreview): void {
    cachedLuciaContact = contact;
    setPendingIntroductionCount((cachedIntroductionOfferCount ?? 0) + (contact.status === "pending" ? 1 : 0));
    void loadConversationList(true).then(() => {
      const nextConversations = cachedConversations ?? [];
      setConversations(nextConversations);
      setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, {
        isPinned: conversation.isPinned ?? conversation.characterKey === "lucia",
        isMuted: conversation.isMuted ?? false,
        sortRank: conversation.sortRank ?? null,
      }])));
      setStatus(cachedStatus);
    });
  }

  function openContextMenu(event: React.MouseEvent, characterKey: string) {
    event.preventDefault();
    event.stopPropagation();
    const railRect = railRef.current?.getBoundingClientRect();
    openContextMenuAt(characterKey, railRect ? event.clientX - railRect.left : event.clientX, railRect ? event.clientY - railRect.top + (railRef.current?.scrollTop ?? 0) : event.clientY);
  }

  function openContextMenuAt(characterKey: string, clientX: number, clientY: number) {
    setContextMenu({
      characterKey,
      x: Math.min(clientX, Math.max(8, window.innerWidth - 240)),
      y: Math.min(clientY, Math.max(8, window.innerHeight - 250)),
    });
  }

  async function applyOrder(nextConversations: readonly ConversationPreview[], preferenceOverrides: Readonly<Record<string, Partial<ConversationPreference>>> = {}) {
    const order = nextConversations.map((conversation) => conversation.characterKey);
    const previous = preferences;
    setPreferences((current) => Object.fromEntries(order.map((characterKey, sortRank) => [characterKey, { ...(current[characterKey] ?? { isPinned: characterKey === "lucia", isMuted: false, sortRank: null }), ...(preferenceOverrides[characterKey] ?? {}), sortRank }])))
    try {
      for (const [characterKey, patch] of Object.entries(preferenceOverrides)) {
        const response = await fetch("/api/v1/conversations/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterKey, ...patch }) });
        if (!response.ok) throw new Error("PREFERENCE_SAVE_FAILED");
      }
      const response = await fetch("/api/v1/conversations/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedCharacterKeys: order }) });
      if (!response.ok) throw new Error("ORDER_SAVE_FAILED");
      syncCachedConversationPreferences(Object.fromEntries(order.map((characterKey, sortRank) => [characterKey, { ...(preferenceOverrides[characterKey] ?? {}), sortRank }])))
      setPreferenceError(false);
      setPreferenceNotice(Object.values(preferenceOverrides).some((patch) => patch.isPinned !== undefined) ? "好友已移动，置顶状态已同步调整" : "好友顺序已保存");
    } catch {
      setPreferences(previous);
      setPreferenceError(true);
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>, characterKey: string) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    dragState.current = { characterKey, startY: event.clientY, active: false };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = dragState.current;
    if (!current || event.pointerType !== "mouse") return;
    if (!current.active && Math.abs(event.clientY - current.startY) < 6) return;
    if (!current.active) {
      dragState.current = { ...current, active: true };
      setDraggedCharacterKey(current.characterKey);
      suppressClickFor.current = current.characterKey;
      if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-character-key]")?.dataset.characterKey;
    const nextTarget = target && target !== current.characterKey ? target : null;
    dragOverCharacterKeyRef.current = nextTarget;
    setDragOverCharacterKey(nextTarget);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const current = dragState.current;
    if (!current) return;
    const dropTarget = dragOverCharacterKeyRef.current;
    if (current.active && dropTarget) {
      const from = visibleConversations.findIndex((item) => item.characterKey === current.characterKey);
      const to = visibleConversations.findIndex((item) => item.characterKey === dropTarget);
      if (from >= 0 && to >= 0) {
        const next = [...visibleConversations];
        const [moved] = next.splice(from, 1);
        if (moved) {
          next.splice(to, 0, moved);
          const sourcePinned = preferenceFor(visibleConversations[from]!).isPinned;
          const targetPinned = preferenceFor(visibleConversations[to]!).isPinned;
          void applyOrder(next, sourcePinned === targetPinned ? {} : { [moved.characterKey]: { isPinned: targetPinned } });
        }
      }
    }
    dragState.current = null;
    dragOverCharacterKeyRef.current = null;
    setDraggedCharacterKey(null);
    setDragOverCharacterKey(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    <aside ref={railRef} className="conversation-contact-rail" aria-label="联系人">
      <div className="conversation-contact-rail__heading">
        <h2>对话</h2>
        <button
          ref={introductionsTriggerRef}
          type="button"
          className="conversation-contact-rail__request"
          aria-expanded={showIntroductions}
          aria-label={pendingIntroductionCount > 0 ? `待处理，${pendingIntroductionCount} 项待处理` : "查看好友申请和介绍"}
          onClick={() => setShowIntroductions(true)}
        >
          <span>待处理</span>
          {pendingIntroductionCount > 0 ? <span className="conversation-contact-rail__request-count" aria-label={`${pendingIntroductionCount} 项待处理`}>{pendingIntroductionCount}</span> : null}
        </button>
      </div>

      {visibleConversations.length >= CONTACT_SEARCH_THRESHOLD ? <ConversationSearch /> : null}
      {preferenceError ? <p className="conversation-contact-rail__preference-error" role="status">好友设置暂未保存，请稍后重试。</p> : preferenceNotice ? <p className="conversation-contact-rail__preference-notice" role="status">{preferenceNotice}</p> : null}
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        {status === "loading" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">正在加载会话……</p> : null}
        {status === "unavailable" ? <div className="conversation-contact-rail__state" role="alert"><p>暂时无法加载会话列表。</p><button type="button" onClick={() => { setStatus("loading"); void loadConversationList(true).then(() => { const nextConversations = cachedConversations ?? []; setConversations(nextConversations); setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }]))); setStatus(cachedStatus); }); }}>重试</button></div> : null}
        {status === "available" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">还没有联系人。你可以先查看新的好友申请。</p> : null}
        {visibleConversations.map((conversation) => {
          const preference = preferenceFor(conversation);
          const isUnread = markedUnread.has(conversation.characterKey);
          const isTyping = typingCharacters.has(conversation.characterKey);
          return (
            <div
              className="conversation-contact-row-shell"
              key={conversation.conversationId}
              data-character-key={conversation.characterKey}
              data-dragging={draggedCharacterKey === conversation.characterKey ? "true" : undefined}
              data-drag-over={dragOverCharacterKey === conversation.characterKey ? "true" : undefined}
              onPointerDown={(event) => handlePointerDown(event, conversation.characterKey)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onContextMenu={(event) => openContextMenu(event, conversation.characterKey)}
              onTouchStart={(event) => {
                if (event.touches.length !== 1) return;
                const touch = event.touches[0];
                longPressTimer.current = window.setTimeout(() => {
                  suppressClickFor.current = conversation.characterKey;
                  const railRect = railRef.current?.getBoundingClientRect();
                  openContextMenuAt(conversation.characterKey, railRect ? touch.clientX - railRect.left : touch.clientX, railRect ? touch.clientY - railRect.top + (railRef.current?.scrollTop ?? 0) : touch.clientY);
                }, 450);
              }}
              onTouchEnd={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }}
              onTouchCancel={() => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }}
            >
              <Link
                className={`conversation-contact-row ${activeCharacterKey === conversation.characterKey ? "conversation-contact-row--active" : ""} ${isUnread ? "conversation-contact-row--unread" : ""}`}
                href={`/chat/${conversation.characterKey}`}
                draggable={false}
                onClick={(event) => {
                  if (suppressClickFor.current === conversation.characterKey) {
                    event.preventDefault();
                    suppressClickFor.current = null;
                    return;
                  }
                  setMarkedUnread((current) => { const next = new Set(current); next.delete(conversation.characterKey); return next; });
                }}
                onMouseEnter={() => prefetchConversationHistory(conversation.characterKey)}
                onFocus={() => prefetchConversationHistory(conversation.characterKey)}
                aria-current={activeCharacterKey === conversation.characterKey ? "page" : undefined}
                aria-label={`${conversation.characterName} ${isTyping ? "正在输入" : conversation.roleLabel}${isUnread ? "，未读" : ""}${preference.isMuted ? "，已静音" : ""}`}
              >
                <span className={`avatar ${conversation.avatarClass}`} aria-hidden="true">{conversation.characterName.slice(0, 1)}</span>
                <span className="conversation-contact-row__body">
                  <strong>{conversation.characterName}</strong>
                  {isTyping ? (
                    <ConversationTypingIndicator className="conversation-contact-row__typing" />
                  ) : <small>{conversation.roleLabel}</small>}
                  {conversation.lastMessage ? <span className="conversation-contact-row__preview">{conversation.lastMessage.snippet}</span> : null}
                </span>
                {isUnread ? <span className="conversation-contact-row__unread" aria-label="未读" /> : null}
                {preference.isMuted ? <span className="conversation-contact-row__muted" aria-label="已静音">静音</span> : null}
                {conversation.lastMessageAt ? <time className="conversation-contact-row__time" dateTime={conversation.lastMessageAt}>{formatConversationTime(conversation.lastMessageAt)}</time> : null}
              </Link>
            </div>
          );
        })}
      </nav>

      {contextMenu && contextConversation && contextPreference ? (
        <div ref={contextMenuRef} className="conversation-contact-context-menu" role="menu" aria-label={`${contextConversation.characterName} 的好友操作`} style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { void updatePreference(contextConversation.characterKey, { isPinned: !contextPreference.isPinned }); setContextMenu(null); }}>
            {contextPreference.isPinned ? "取消置顶" : "置顶此好友"}
          </button>
          <button type="button" role="menuitem" onClick={() => { const markingUnread = !markedUnread.has(contextConversation.characterKey); setMarkedUnread((current) => { const next = new Set(current); if (markingUnread) next.add(contextConversation.characterKey); else next.delete(contextConversation.characterKey); return next; }); setPreferenceNotice(markingUnread ? "已标记为未读" : "已标记为已读"); setContextMenu(null); }}>
            {markedUnread.has(contextConversation.characterKey) ? "标记为已读" : "标记为未读"}
          </button>
          <button type="button" role="menuitem" onClick={() => { void updatePreference(contextConversation.characterKey, { isMuted: !contextPreference.isMuted }); setContextMenu(null); }}>
            {contextPreference.isMuted ? "开启通知" : "静音通知"}
          </button>
          <div className="conversation-contact-context-menu__separator" role="separator" />
          <Link role="menuitem" href={`/chat/${contextConversation.characterKey}`} onClick={() => setContextMenu(null)}>打开好友对话</Link>
        </div>
      ) : null}

      {showIntroductions ? <div className="conversation-introductions-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-introductions-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeIntroductions(); }}>
        <div className="conversation-introductions-dialog__panel">
          <div className="conversation-introductions-dialog__heading"><h2 id="conversation-introductions-dialog-title">好友申请与介绍</h2><button type="button" aria-label="关闭好友申请与介绍" onClick={closeIntroductions}>×</button></div>
          <IntroductionInbox alwaysVisible onLuciaContactAccepted={refreshAfterLuciaContactAccepted} />
        </div>
      </div> : null}
    </aside>
  );
}

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

if (typeof window !== "undefined") {
  window.addEventListener("account-signed-out", clearConversationContactCache);
}
