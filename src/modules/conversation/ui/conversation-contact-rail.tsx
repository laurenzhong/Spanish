"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConversationSearch } from "./conversation-search";
import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { prefetchConversationHistory } from "./conversation-history-cache";
import { getConversationCacheScope } from "./conversation-cache-scope";
import { ConversationTypingIndicator } from "@/src/shared/ui/conversation-typing-indicator";
import type { ConversationPreview } from "../application/list-previews";

type ConversationContactRailProps = Readonly<{
  activeCharacterKey?: string;
  initialConversations?: readonly ConversationPreview[];
  cacheScope?: string;
}>;

let cachedConversations: readonly ConversationPreview[] | null = null;
let cachedStatus: "loading" | "available" | "unavailable" = "loading";
type PendingContactRequest = Readonly<{
  promise: Promise<void>;
  controller: AbortController;
  generation: number;
  scope: string;
}>;

let listRequest: PendingContactRequest | null = null;
let cachedLuciaContact: LuciaContactPreview | null = null;
let luciaContactRequest: PendingContactRequest | null = null;
let cachedIntroductionOfferCount: number | null = null;
let introductionOfferRequest: PendingContactRequest | null = null;
let cachedScope: string | null = null;
let contactCacheGeneration = 0;

const CONTACT_SEARCH_THRESHOLD = 8;
/**
 * The contact list is a read of a remote pooled database (character runtime,
 * conversation rows, preferences, last message), so its wall-clock time is
 * governed by round-trip latency rather than by query cost. Measured against
 * the running app the plain read answers in 0.9-4.9s, and the rail's own
 * concurrent readers (the navigation unread badge and the chat thread read the
 * same endpoint) push a single response to 7.6s while still answering 200.
 *
 * At 8s an ordinary slow read aborted client-side, and an aborted read was
 * indistinguishable from an unavailable list: the rail showed
 * "暂时无法加载会话列表。" with a retry button while the server was healthy.
 * This bound must stay comfortably above the measured latency; it matches the
 * 20s bound the conversation history read already uses for the same reason.
 */
const CONTACT_REQUEST_TIMEOUT_MS = 20_000;
export const CONVERSATION_LIST_UPDATED_EVENT = "conversation-list-updated";

/**
 * Marks one conversation as read and refetches the contact list so the navigation
 * unread badge reflects it. Callers use this from the chat thread itself: opening
 * or re-reading a conversation is what makes its messages read, not clicking the
 * contact row.
 *
 * A lost acknowledgement is not a cosmetic problem: the conversation keeps
 * being counted as unread, so the dot comes back for a message the reader has
 * already seen ("已读之后又出现未读 1，但没有新消息"). The request is
 * idempotent — the route only advances `lastReadAt` — so a failed attempt is
 * retried once, and only a confirmed acknowledgement refreshes the badge.
 */
export async function markConversationRead(characterKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/v1/conversations/preferences", {
        method: "PATCH",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterKey, markRead: true }),
      });
      if (response.ok) {
        window.dispatchEvent(new Event(CONVERSATION_LIST_UPDATED_EVENT));
        return true;
      }
      // A 4xx is a stable refusal (validation, authorization); retrying it only
      // adds noise. Anything else may be a transient outage.
      if (response.status < 500) return false;
    } catch {
      // Network failure: fall through and retry once.
    }
  }
  return false;
}

async function fetchContactJson<T>(url: string, controller: AbortController): Promise<T> {
  const timeout = window.setTimeout(() => controller.abort(), CONTACT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("CONTACT_REQUEST_FAILED");
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function clearConversationContactCache(): void {
  contactCacheGeneration += 1;
  listRequest?.controller.abort();
  luciaContactRequest?.controller.abort();
  introductionOfferRequest?.controller.abort();
  cachedConversations = null;
  cachedStatus = "loading";
  listRequest = null;
  cachedLuciaContact = null;
  luciaContactRequest = null;
  cachedIntroductionOfferCount = null;
  introductionOfferRequest = null;
  cachedScope = null;
}

function ensureCacheScope(scope = getConversationCacheScope()): string {
  // Client-only caches must never be shared by accounts. When the server
  // shell reports a different opaque scope, discard all prior contact state
  // before any render or request can consume it.
  if (typeof window === "undefined") return scope;
  if (cachedScope === scope) return scope;
  contactCacheGeneration += 1;
  listRequest?.controller.abort();
  luciaContactRequest?.controller.abort();
  introductionOfferRequest?.controller.abort();
  cachedConversations = null;
  cachedStatus = "loading";
  listRequest = null;
  cachedLuciaContact = null;
  luciaContactRequest = null;
  cachedIntroductionOfferCount = null;
  introductionOfferRequest = null;
  cachedScope = scope;
  return scope;
}

function isCurrentContactRequest(
  request: PendingContactRequest | null,
  generation: number,
  scope: string,
  promise: Promise<void>,
): boolean {
  return request?.promise === promise
    && request.generation === generation
    && request.scope === scope
    && contactCacheGeneration === generation
    && cachedScope === scope;
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

function loadConversationList(force = false, scope = getConversationCacheScope()): Promise<void> {
  ensureCacheScope(scope);
  if (listRequest) return listRequest.promise;
  if (!force && (cachedConversations !== null || cachedStatus === "unavailable")) return Promise.resolve();
  cachedStatus = "loading";
  const generation = contactCacheGeneration;
  const controller = new AbortController();
  const request = fetchContactJson<{ data?: { conversations?: ConversationPreview[] } }>("/api/v1/conversations", controller)
    .then((payload) => {
      if (!isCurrentContactRequest(listRequest, generation, scope, request)) return;
      cachedConversations = payload.data?.conversations ?? [];
      cachedStatus = "available";
    })
    .catch(() => {
      if (!isCurrentContactRequest(listRequest, generation, scope, request)) return;
      // A failed background refresh must not deny a list the rail already has:
      // the contacts the server handed down stay on screen and the next refresh
      // retries. Only a read that has nothing to fall back on reports the rail
      // as unavailable, which is the state the retry button belongs to.
      cachedStatus = cachedConversations === null ? "unavailable" : "available";
    })
    .finally(() => {
      if (listRequest?.promise === request) listRequest = null;
    });
  listRequest = { promise: request, controller, generation, scope };
  return request;
}

function loadLuciaContact(scope = getConversationCacheScope()): Promise<void> {
  ensureCacheScope(scope);
  if (luciaContactRequest) return luciaContactRequest.promise;
  if (cachedLuciaContact !== null) return Promise.resolve();
  const generation = contactCacheGeneration;
  const controller = new AbortController();
  const request = fetchContactJson<{ data?: LuciaContactPreview }>("/api/v1/character-network/lucia-contact", controller)
    .then((payload) => {
      if (!isCurrentContactRequest(luciaContactRequest, generation, scope, request)) return;
      cachedLuciaContact = payload.data ?? null;
    })
    .catch(() => {
      if (!isCurrentContactRequest(luciaContactRequest, generation, scope, request)) return;
      cachedLuciaContact = null;
    })
    .finally(() => {
      if (luciaContactRequest?.promise === request) luciaContactRequest = null;
    });
  luciaContactRequest = { promise: request, controller, generation, scope };
  return request;
}

function loadIntroductionOfferCount(force = false, scope = getConversationCacheScope()): Promise<void> {
  ensureCacheScope(scope);
  if (introductionOfferRequest) return introductionOfferRequest.promise;
  if (!force && cachedIntroductionOfferCount !== null) return Promise.resolve();
  const generation = contactCacheGeneration;
  const controller = new AbortController();
  const request = fetchContactJson<{ data?: { offers?: unknown[] } }>("/api/v1/character-network/introductions", controller)
    .then((payload) => {
      if (!isCurrentContactRequest(introductionOfferRequest, generation, scope, request)) return;
      cachedIntroductionOfferCount = payload.data?.offers?.length ?? 0;
    })
    .catch(() => {
      if (!isCurrentContactRequest(introductionOfferRequest, generation, scope, request)) return;
      cachedIntroductionOfferCount = null;
    })
    .finally(() => {
      if (introductionOfferRequest?.promise === request) introductionOfferRequest = null;
    });
  introductionOfferRequest = { promise: request, controller, generation, scope };
  return request;
}

function syncCachedConversationPreferences(
  updates: Readonly<Record<string, Partial<ConversationPreference>>>,
  scope = getConversationCacheScope(),
): void {
  ensureCacheScope(scope);
  if (!cachedConversations) return;
  cachedConversations = cachedConversations.map((conversation) => {
    const update = updates[conversation.characterKey];
    return update ? { ...conversation, ...update } : conversation;
  });
}

export function ConversationContactRail({ activeCharacterKey, initialConversations, cacheScope }: ConversationContactRailProps) {
  const resolvedCacheScope = ensureCacheScope(cacheScope ?? getConversationCacheScope());
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
  const acknowledgedUnreadRef = useRef<{ characterKey: string; unreadCount: number } | null>(null);
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
    void loadConversationList(false, resolvedCacheScope).then(() => {
      if (!active) return;
      const nextConversations = cachedConversations ?? [];
      setConversations(nextConversations);
      setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }])))
      setStatus(cachedStatus);
      window.dispatchEvent(new Event(CONVERSATION_LIST_UPDATED_EVENT));
    });
    void Promise.all([loadLuciaContact(resolvedCacheScope), loadIntroductionOfferCount(false, resolvedCacheScope)]).then(() => {
      if (!active) return;
      setPendingIntroductionCount((cachedIntroductionOfferCount ?? 0) + (cachedLuciaContact?.status === "pending" ? 1 : 0));
    });
    return () => { active = false; };
  }, [initialConversations, resolvedCacheScope]);

  useEffect(() => {
    const refresh = () => {
      void loadConversationList(true, resolvedCacheScope).then(() => {
        const nextConversations = cachedConversations ?? [];
        setConversations(nextConversations);
        setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }])));
        setStatus(cachedStatus);
      });
    };
    // Each row carries its own unread count, so the list has to converge on the
    // server the same way the navigation badge does. Without this, a
    // conversation read in another tab (or on the phone) kept its row badge
    // until the next page load, while the navigation dot had already cleared.
    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") return;
      refresh();
    };
    window.addEventListener(CONVERSATION_LIST_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener(CONVERSATION_LIST_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [resolvedCacheScope]);

  // Opening a conversation marks it read. The signature guard keeps the
  // patch → list-refresh → effect cycle bounded: each new unread count is
  // acknowledged once instead of re-patching on every refetched array identity.
  useEffect(() => {
    const conversation = conversations.find((item) => item.characterKey === activeCharacterKey);
    if (!conversation) {
      acknowledgedUnreadRef.current = null;
      return;
    }
    const unreadCount = conversation.unreadCount ?? 0;
    if (unreadCount < 1) return;
    const acknowledged = acknowledgedUnreadRef.current;
    if (acknowledged?.characterKey === conversation.characterKey && acknowledged.unreadCount === unreadCount) return;
    acknowledgedUnreadRef.current = { characterKey: conversation.characterKey, unreadCount };
    void markConversationRead(conversation.characterKey);
  }, [activeCharacterKey, conversations]);

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
    void loadIntroductionOfferCount(true, resolvedCacheScope).then(() => {
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
      syncCachedConversationPreferences({ [characterKey]: next }, resolvedCacheScope);
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
    void loadConversationList(true, resolvedCacheScope).then(() => {
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

  function cancelLongPress() {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
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
      syncCachedConversationPreferences(Object.fromEntries(order.map((characterKey, sortRank) => [characterKey, { ...(preferenceOverrides[characterKey] ?? {}), sortRank }])), resolvedCacheScope)
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
        {pendingIntroductionCount > 0 ? <button
          ref={introductionsTriggerRef}
          type="button"
          className="conversation-contact-rail__request"
          aria-expanded={showIntroductions}
          onClick={() => setShowIntroductions(true)}
        >
          <span>待处理</span>
          <span className="conversation-contact-rail__request-count" aria-label={`${pendingIntroductionCount} 项待处理`}>{pendingIntroductionCount}</span>
        </button> : null}
      </div>

      {visibleConversations.length >= CONTACT_SEARCH_THRESHOLD ? <ConversationSearch /> : null}
      {preferenceError ? <p className="conversation-contact-rail__preference-error" role="status">好友设置暂未保存，请稍后重试。</p> : preferenceNotice ? <p className="conversation-contact-rail__preference-notice" role="status">{preferenceNotice}</p> : null}
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        {status === "loading" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">正在加载会话……</p> : null}
         {status === "unavailable" ? <div className="conversation-contact-rail__state" role="alert"><p>暂时无法加载会话列表。</p><button type="button" onClick={() => { setStatus("loading"); void loadConversationList(true, resolvedCacheScope).then(() => { const nextConversations = cachedConversations ?? []; setConversations(nextConversations); setPreferences(Object.fromEntries(nextConversations.map((conversation) => [conversation.characterKey, { isPinned: conversation.isPinned ?? conversation.characterKey === "lucia", isMuted: conversation.isMuted ?? false, sortRank: conversation.sortRank ?? null }]))); setStatus(cachedStatus); }); }}>重试</button></div> : null}
        {status === "available" && visibleConversations.length === 0 ? <p className="conversation-contact-rail__state">还没有联系人。你可以先查看新的好友申请。</p> : null}
        {visibleConversations.map((conversation) => {
          const preference = preferenceFor(conversation);
          const isUnread = markedUnread.has(conversation.characterKey);
          const unreadCount = conversation.unreadCount ?? 0;
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
              onTouchMove={cancelLongPress}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
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
                  // The shared helper retries a failed acknowledgement and only
                  // refreshes the list once the server confirmed the read.
                  if (unreadCount > 0) void markConversationRead(conversation.characterKey);
                }}
                onMouseEnter={() => prefetchConversationHistory(conversation.characterKey, resolvedCacheScope)}
                onFocus={() => prefetchConversationHistory(conversation.characterKey, resolvedCacheScope)}
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
                <span className="conversation-contact-row__meta">
                  {conversation.lastMessageAt ? <time className="conversation-contact-row__time" dateTime={conversation.lastMessageAt}>{formatConversationTime(conversation.lastMessageAt)}</time> : null}
                  {unreadCount > 0 ? <span className="conversation-contact-row__unread-count" aria-label={`${unreadCount} 条未读消息`}>{unreadCount > 99 ? "99+" : unreadCount}</span> : isUnread ? <span className="conversation-contact-row__unread" aria-label="未读" /> : null}
                  {preference.isMuted ? <span className="conversation-contact-row__muted" aria-label="已静音">静音</span> : null}
                </span>
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

export function formatConversationTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsedMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (elapsedMinutes >= 0 && elapsedMinutes < 1) return "刚刚";
  if (elapsedMinutes >= 1 && elapsedMinutes < 60) return `${elapsedMinutes}分钟前`;

  const startOfDay = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const today = startOfDay(now);
  const messageDay = startOfDay(date);
  const dayDifference = Math.floor((today - messageDay) / 86_400_000);
  if (dayDifference === 0) return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  if (dayDifference === 1) return `昨天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;
  if (dayDifference === 2) return "前天";

  const mondayOffset = (now.getDay() + 6) % 7;
  const startOfWeek = today - mondayOffset * 86_400_000;
  if (messageDay >= startOfWeek && messageDay < today) return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(date);
}

if (typeof window !== "undefined") {
  window.addEventListener("account-signed-out", clearConversationContactCache);
}
