"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ConversationTypingIndicator } from "@/src/shared/ui/conversation-typing-indicator";
import { preferredScrollBehavior } from "@/src/shared/ui/motion";
import { ConfirmActionDialog } from "@/src/shared/ui/confirm-action-dialog";
import { createReadAloud } from "@/src/modules/providers/tts";
import { speechCapabilityErrorCode } from "@/src/modules/providers/speech";

import {
  createConversationState,
  findRetryableUserMessage,
  transitionConversationState,
  type ConversationState,
} from "@/src/modules/conversation/domain/conversation-state";
import { ConversationNdjsonParser } from "@/src/modules/conversation/domain/stream-protocol";
import { VoiceComposer } from "./voice-composer";
import { ConversationSearch } from "./conversation-search";
import { ConversationAssistant } from "./conversation-assistant";
import { CONVERSATION_LIST_UPDATED_EVENT, ConversationContactRail, markConversationRead } from "./conversation-contact-rail";
import {
  getCachedConversationAccess,
  getCachedConversationHistory,
  loadConversationHistory,
  setCachedConversationHistory,
  type ConversationHistoryAccess,
} from "./conversation-history-cache";
import { getConversationCacheScope } from "./conversation-cache-scope";
import { maxPendingUserMessages, pendingReplyDebounceMs, recoverPendingReply, replyBubbles, visibleReplyPrefix, type PendingUserMessage } from "./pending-reply";

type ChatThreadProps = Readonly<{
  characterKey: "lucia" | "mateo" | "ines";
  characterName: string;
  roleLabel?: string;
  /** Current released revision from the catalog; the server refuses any other. */
  characterVersion: number;
  avatarClassName?: string;
  initialMessageId?: string;
  initialMessages?: readonly ConversationState["messages"][number][];
  initialAccess?: ConversationHistoryAccess;
  cacheScope?: string;
}>;

type UserAvatarProfile = Readonly<{
  displayName: string | null;
  avatar: Readonly<{ url: string | null; initials: string; colorIndex: number }>;
}>;

type MessageTranslation =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "success"; text: string }>
  | Readonly<{ status: "error"; message: string }>;

type MessageMenuState = Readonly<{
  messageId: string;
  anchorX: number;
  anchorTop: number;
  anchorBottom: number;
  align: "start" | "end";
  x?: number;
  y?: number;
}>;

function createId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function ChatThread({ characterKey, characterName, roleLabel = "主要好友", characterVersion, initialMessageId, initialMessages, initialAccess, avatarClassName = "avatar--lucia", cacheScope = getConversationCacheScope() }: ChatThreadProps) {
  const targetMessageId = initialMessageId ?? (typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("message") ?? undefined
    : undefined);
  const [state, setState] = useState<ConversationState>(() => initialMessages
    ? transitionConversationState(createConversationState(), { type: "hydrate", messages: initialMessages })
    : createConversationState());
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "available" | "unavailable">(initialMessages ? "available" : "loading");
  const [historyAccess, setHistoryAccess] = useState<ConversationHistoryAccess>(() => getCachedConversationAccess(characterKey, cacheScope) ?? initialAccess ?? {
    // A server-rendered/fixture history is already an explicit view of the
    // conversation. The authoritative route metadata will still replace this
    // optimistic default as soon as the client revalidates.
    readOnly: false,
    canSend: Boolean(initialMessages),
    contactStatus: null,
  });
  const [draft, setDraft] = useState("");
  const [assistEpoch, setAssistEpoch] = useState(0);
  const assistedRef = useRef(false);
  const [quotedMessage, setQuotedMessage] = useState<ConversationState["messages"][number] | null>(null);
  const [contextMenu, setContextMenu] = useState<MessageMenuState | null>(null);
  const [translations, setTranslations] = useState<Record<string, MessageTranslation>>({});
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedTimestampId, setExpandedTimestampId] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewProactiveMessage, setHasNewProactiveMessage] = useState(false);
  const [showMobileConversations, setShowMobileConversations] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const [userProfile, setUserProfile] = useState<UserAvatarProfile | null>(null);
  const stateRef = useRef(state);
  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;
  const pendingMessagesRef = useRef<PendingUserMessage[]>([]);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supersedesRef = useRef<ReturnType<typeof visibleReplyPrefix> | null>(null);
  const transportRef = useRef<{ generationId: string; controller: AbortController; reader: ReadableStreamDefaultReader<Uint8Array> | null } | null>(null);
  const threadScopeRef = useRef(`${cacheScope}:${characterKey}:${characterVersion}`);
  const mutationRevisionRef = useRef(0);
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationRequestIdRef = useRef(0);
  const translationCharacterKeyRef = useRef(characterKey);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const headerMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const assistantPanelRef = useRef<HTMLElement | null>(null);
  const messageMenuRef = useRef<HTMLDivElement | null>(null);
  const messageMenuTriggerRef = useRef<HTMLElement | null>(null);
  const shouldFollowRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const currentMessagesRef = useRef(state.messages);
  const knownMessageKeysRef = useRef(new Set(
    (initialMessages ?? []).map((message) => message.clientMessageId ?? message.id),
  ));
  const serverMessageKeysRef = useRef(new Set(
    (initialMessages ?? []).map((message) => message.clientMessageId ?? message.id),
  ));
  const serverHistoryLoadedRef = useRef(Boolean(initialMessages));
  const retryMessage = useMemo(() => findRetryableUserMessage(state), [state]);
  const textToSpeech = useMemo(() => createReadAloud(), []);
  const speechGenerationRef = useRef(0);
  const contextMenuMessageId = contextMenu?.messageId;

  useEffect(() => {
    const isTyping = state.status === "streaming";
    window.dispatchEvent(new CustomEvent("conversation-typing", { detail: { characterKey, isTyping } }));
    if (!isTyping) return;
    return () => {
      window.dispatchEvent(new CustomEvent("conversation-typing", { detail: { characterKey, isTyping: false } }));
    };
  }, [characterKey, state.status]);

  useEffect(() => {
    currentMessagesRef.current = state.messages;
  }, [state.messages]);

  useEffect(() => {
    const load = () => {
      void fetch("/api/v1/me", { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } })
        .then(async (response) => {
          if (!response.ok) throw new Error("unavailable");
          const payload = await response.json() as { data?: UserAvatarProfile };
          if (payload.data) setUserProfile(payload.data);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("account-profile-updated", load);
    return () => window.removeEventListener("account-profile-updated", load);
  }, []);

  // Apply the initial bottom anchor before the hydrated history is painted.
  // Using a passive effect leaves one visible frame at scrollTop=0, which
  // looks like the conversation is pushed down and then snaps into place.
  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    if (shouldFollowRef.current) container.scrollTop = container.scrollHeight;
  }, [state.messages]);

  function handleMessagesScroll() {
    const container = messagesRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
    shouldFollowRef.current = nearBottom;
    isNearBottomRef.current = nearBottom;
    setIsNearBottom(nearBottom);
    if (nearBottom) setHasNewProactiveMessage(false);
  }

  function scrollToBottom() {
    const container = messagesRef.current;
    if (!container) return;
    shouldFollowRef.current = true;
    isNearBottomRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: preferredScrollBehavior() });
    setIsNearBottom(true);
    setHasNewProactiveMessage(false);
  }

  useEffect(() => {
    if (!targetMessageId || state.messages.length === 0) return;
    const container = messagesRef.current;
    if (!container) return;
    let cancelled = false;
    let highlightTimeout: number | undefined;
    const locate = (attempt: number) => {
      if (cancelled) return;
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).find(
        (element) => element.dataset.messageId === targetMessageId,
      );
      if (!target) {
        if (attempt < 4) window.setTimeout(() => locate(attempt + 1), 80);
        return;
      }
      container.scrollTop = Math.max(0, target.offsetTop - container.clientHeight / 2 + target.offsetHeight / 2);
      target.dataset.highlighted = "true";
      highlightTimeout = window.setTimeout(() => { delete target.dataset.highlighted; }, 2_400);
    };
    locate(0);
    return () => {
      cancelled = true;
      if (highlightTimeout !== undefined) window.clearTimeout(highlightTimeout);
    };
  }, [targetMessageId, state.messages.length]);

  useEffect(() => () => {
    disposeTransport();
    pendingMessagesRef.current = [];
    translationAbortRef.current?.abort();
    speechGenerationRef.current += 1;
    textToSpeech.stop();
  }, [textToSpeech]);

  useLayoutEffect(() => {
    const scope = `${cacheScope}:${characterKey}:${characterVersion}`;
    if (threadScopeRef.current !== scope) {
      threadScopeRef.current = scope;
      apply({ type: "reset" });
      if (initialMessagesRef.current) apply({ type: "hydrate", messages: initialMessagesRef.current });
    }
    return () => {
      mutationRevisionRef.current += 1;
      disposeTransport();
      pendingMessagesRef.current = [];
      supersedesRef.current = null;
    };
  }, [cacheScope, characterKey, characterVersion]);

  useEffect(() => {
    translationAbortRef.current?.abort();
    translationRequestIdRef.current += 1;
    translationCharacterKeyRef.current = characterKey;
  }, [characterKey]);

  useLayoutEffect(() => {
    if (!contextMenu || contextMenu.x !== undefined || contextMenu.y !== undefined || !messageMenuRef.current) return;
    const menuRect = messageMenuRef.current.getBoundingClientRect();
    const viewportMargin = 8;
    const menuGap = 6;
    const maxX = Math.max(viewportMargin, window.innerWidth - menuRect.width - viewportMargin);
    const maxY = Math.max(viewportMargin, window.innerHeight - menuRect.height - viewportMargin);
    const preferredX = contextMenu.align === "end"
      ? contextMenu.anchorX - menuRect.width
      : contextMenu.anchorX;
    const preferredY = contextMenu.anchorBottom + menuGap + menuRect.height <= window.innerHeight - viewportMargin
      ? contextMenu.anchorBottom + menuGap
      : contextMenu.anchorTop - menuRect.height - menuGap;
    const x = Math.max(viewportMargin, Math.min(preferredX, maxX));
    const y = Math.max(viewportMargin, Math.min(preferredY, maxY));
    setContextMenu((current) => current?.messageId === contextMenu.messageId && current.x === undefined
      ? { ...current, x, y }
      : current);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenuMessageId) return;
    // The menu still takes focus when it opens, but it must never pull focus
    // back out of something that opened from one of its items: the shared
    // confirm dialog is rendered inside this menu and owns focus while it is
    // open, so the deferred focus only runs when focus is still outside.
    const focusTimer = window.setTimeout(() => {
      const menu = messageMenuRef.current;
      if (!menu || menu.contains(document.activeElement)) return;
      menu.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    }, 0);
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      // An overlay opened from this menu (for example the confirm dialog)
      // consumes Escape first and keeps the menu underneath it.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      close();
      messageMenuTriggerRef.current?.focus();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener("click", close); window.removeEventListener("keydown", onKeyDown); };
  }, [contextMenuMessageId]);

  useEffect(() => {
    if (!showHeaderMenu) return;
    const focusTimer = window.setTimeout(() => headerMenuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus(), 0);
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && (headerMenuRef.current?.contains(event.target) || headerMenuTriggerRef.current?.contains(event.target))) return;
      setShowHeaderMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowHeaderMenu(false);
      headerMenuTriggerRef.current?.focus();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener("click", close); document.removeEventListener("keydown", onKeyDown); };
  }, [showHeaderMenu]);

  const closeAssistant = useCallback((restoreFocus = true) => {
    setShowAssistant(false);
    if (restoreFocus) headerMenuTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showAssistant) return;
    const close = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || assistantPanelRef.current?.contains(target)) return;
      // Clicking another control (the composer, a message action) is a
      // deliberate move: closing must not drag focus back to the menu trigger.
      const movedToControl = target instanceof HTMLElement
        && target.closest("input, textarea, select, button, a, [contenteditable='true'], [tabindex]") !== null;
      closeAssistant(!movedToControl);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeAssistant();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", onKeyDown); };
  }, [showAssistant, closeAssistant]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedConversationHistory(characterKey, cacheScope);
    const cachedAccess = getCachedConversationAccess(characterKey, cacheScope);
    if (cachedAccess) {
      queueMicrotask(() => {
        if (!cancelled) setHistoryAccess(cachedAccess);
      });
    }
    knownMessageKeysRef.current = new Set((initialMessages ?? []).map((message) => message.clientMessageId ?? message.id));
    serverMessageKeysRef.current = new Set((initialMessages ?? []).map((message) => message.clientMessageId ?? message.id));
    if (cached && cached.length > 0) {
      queueMicrotask(() => {
        if (cancelled) return;
        knownMessageKeysRef.current = new Set(cached.map((message) => message.clientMessageId ?? message.id));
        apply({ type: "hydrate", messages: cached });
        setPersistenceStatus("available");
      });
    }

    const refresh = async (initialLoad = false) => {
      try {
        const result = await loadConversationHistory(characterKey, cacheScope);
        if (cancelled) return;
        const knownKeys = knownMessageKeysRef.current;
        const newlyArrivedProactive = result.messages.some((message) => {
          const key = message.clientMessageId ?? message.id;
          return !knownKeys.has(key) && message.role === "character" && message.sourceType === "proactive" && message.complete;
        });
        if (newlyArrivedProactive && !isNearBottomRef.current) setHasNewProactiveMessage(true);
        for (const message of result.messages) knownKeys.add(message.clientMessageId ?? message.id);

        // Keep the loading state until the body has been parsed and applied.
        // Hydration preserves optimistic messages and an active stream.
        const serverKeys = new Set(result.messages.map((message) => message.clientMessageId ?? message.id));
        const confirmedCurrentKeys = currentMessagesRef.current
          .map((message) => message.clientMessageId ?? message.id)
          .filter((key) => serverKeys.has(key));
        const staleMessageKeys = Array.from(new Set([
          ...serverMessageKeysRef.current,
          ...confirmedCurrentKeys,
        ]));
        if (staleMessageKeys.length > 0) {
          apply({
            type: "replace-hydrate",
            messages: result.messages,
            staleMessageKeys,
          });
        } else {
          apply({ type: "hydrate", messages: result.messages });
        }
        serverMessageKeysRef.current = new Set(result.messages.map((message) => message.clientMessageId ?? message.id));
        setHistoryAccess(result.access);
        setCachedConversationHistory(characterKey, result.messages, result.access, cacheScope);
        setPersistenceStatus("available");
        serverHistoryLoadedRef.current = true;
        // Reading the conversation is what makes its messages read. Without
        // this the unread badge keeps counting messages the user is already
        // looking at, and a message that lands while the thread is open never
        // clears because only the contact row advanced `lastReadAt`.
        void markConversationRead(characterKey);
      } catch {
        // A cached snapshot or a server-rendered view is still usable while the
        // server is temporarily unreachable; only show the unavailable state
        // when there is no view to fall back to. An empty server-rendered
        // history is still an open conversation, so test for the presence of
        // the view rather than for its length.
        if (!cancelled && initialLoad && !cached?.length && initialMessages === undefined) setPersistenceStatus("unavailable");
      }
    };

    void refresh(true);
    const onFocus = () => { if (serverHistoryLoadedRef.current) void refresh(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && serverHistoryLoadedRef.current) void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && serverHistoryLoadedRef.current) void refresh();
    }, 45_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [cacheScope, characterKey, historyReloadToken, initialMessages]);

  useEffect(() => {
    if (state.messages.length === 0) return;
    setCachedConversationHistory(characterKey, state.messages, undefined, cacheScope);
  }, [cacheScope, characterKey, state.messages]);

  useEffect(() => {
    if (historyAccess.canSend && !historyAccess.readOnly) return;
    // A revalidation can revoke the contact while an older render still has
    // an optimistic composer. Do not let queued work survive that revocation.
    const generationId = stateRef.current.activeGenerationId;
    disposeTransport();
    if (generationId && stateRef.current.status === "streaming") apply({ type: "cancel", generationId });
    pendingMessagesRef.current = [];
    supersedesRef.current = null;
  }, [historyAccess.canSend, historyAccess.readOnly]);

  function apply(action: Parameters<typeof transitionConversationState>[1]) {
    let next = transitionConversationState(stateRef.current, action);
    if ((action.type === "hydrate" || action.type === "replace-hydrate") && next.status === "idle") {
      const recovered = recoverPendingReply(next);
      if (recovered.messages.length > 0) next = transitionConversationState(next, { type: "recover-pending",
        generationId: recovered.prefix?.generationId ?? null, messageId: recovered.prefix?.id ?? null });
    }
    stateRef.current = next;
    currentMessagesRef.current = next.messages;
    setState(next);
  }

  function disposeTransport() {
    if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    const transport = transportRef.current;
    transportRef.current = null;
    transport?.controller.abort();
    if (transport?.reader) void transport.reader.cancel().catch(() => undefined);
  }

  function cancel() {
    const transport = transportRef.current;
    if (transport && stateRef.current.status !== "completed") supersedesRef.current = visibleReplyPrefix(stateRef.current, transport.generationId);
    const generationId = stateRef.current.activeGenerationId;
    disposeTransport();
    if (generationId && stateRef.current.status === "streaming") apply({ type: "cancel", generationId });
  }

  async function consume(batch: readonly PendingUserMessage[], generationId: string, supersedes: ReturnType<typeof visibleReplyPrefix> | null) {
    const latest = batch.at(-1);
    if (!latest) return;
    const transport = { generationId, controller: new AbortController(), reader: null as ReadableStreamDefaultReader<Uint8Array> | null };
    const { controller } = transport;
    transportRef.current = transport;
    const isCurrent = () => transportRef.current === transport && !controller.signal.aborted && stateRef.current.activeGenerationId === generationId;
    let receivedDone = false;
    try {
      const response = await fetch(`/api/v1/conversations/${characterKey}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ characterVersion, ...latest, generationId,
          ...(batch.length > 1 ? { pendingMessages: batch.slice(0, -1) } : {}),
          ...(supersedes ? { supersedes } : {}),
        }),
        signal: controller.signal,
      });
      if (!isCurrent()) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      // Only an explicit persistence report may change this state. Error
      // responses (validation, contact gate, provider outage) omit the header
      // because they describe a failed send, not a failed history read.
      // Treating a missing header as "unavailable" rendered "cannot open this
      // conversation" for an open conversation and locked the composer.
      const persistence = response.headers.get("x-conversation-persistence");
      if (persistence) setPersistenceStatus(persistence === "available" ? "available" : "unavailable");
      if (!response.ok || !response.body) {
        apply({
          type: "stream-event",
          event: {
            type: "error",
            generationId,
            messageId: null,
            code: response.status === 404 ? "character-unavailable" : "stream-failed",
            retryable: response.status >= 500 || response.status === 404,
          },
        });
        return;
      }
      const reader = response.body.getReader();
      transport.reader = reader;
      const decoder = new TextDecoder();
      const parser = new ConversationNdjsonParser();
      const receive = (event: ReturnType<typeof parser.push>[number]) => {
        if (!isCurrent() || receivedDone) return;
        const normalized = event.generationId === "unknown" ? { ...event, generationId } : event;
        if (normalized.generationId !== generationId) return;
        const timestamped = normalized.type === "meta" && !normalized.createdAt
          ? { ...normalized, createdAt: new Date().toISOString() } : normalized;
        apply({ type: "stream-event", event: timestamped });
        if (timestamped.type === "done" && stateRef.current.status === "completed") {
          receivedDone = true;
          const completedIds = new Set(batch.map((message) => message.clientMessageId));
          pendingMessagesRef.current = pendingMessagesRef.current.filter((message) => !completedIds.has(message.clientMessageId));
          supersedesRef.current = null;
          window.dispatchEvent(new Event(CONVERSATION_LIST_UPDATED_EVENT));
        }
      };
      while (true) {
        const result = await reader.read();
        if (!isCurrent()) return;
        if (result.done) break;
        for (const event of parser.push(decoder.decode(result.value, { stream: true }))) receive(event);
      }
      for (const event of parser.push(decoder.decode())) receive(event);
      for (const event of parser.finish()) receive(event);
      if (!receivedDone && isCurrent()) {
        apply({
          type: "stream-event",
          event: { type: "error", generationId, messageId: null, code: "stream-failed", retryable: true },
        });
      }
    } catch {
      if (isCurrent()) {
        apply({
          type: "stream-event",
          event: { type: "error", generationId, messageId: null, code: "stream-failed", retryable: true },
        });
      }
    } finally {
      if (isCurrent()) {
        if (!receivedDone) supersedesRef.current = visibleReplyPrefix(stateRef.current, generationId);
        transportRef.current = null;
      }
      if (transport.reader) {
        await transport.reader.cancel().catch(() => undefined);
        transport.reader.releaseLock();
      }
    }
  }

  function schedulePending(generationId: string) {
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      if (stateRef.current.activeGenerationId !== generationId || stateRef.current.status !== "streaming") return;
      void consume([...pendingMessagesRef.current], generationId, supersedesRef.current);
    }, pendingReplyDebounceMs);
  }

  function submit() {
    if (!historyAccess.canSend || historyAccess.readOnly || persistenceStatus !== "available") {
      if (persistenceStatus === "available") setNotice(historyAccess.contactStatus === "declined" ? "你已拒绝这个好友申请，无法发送新消息。" : "这段对话目前只能查看，无法发送新消息。");
      return;
    }
    const text = draft.trim();
    if (!text) return;
    restorePendingBatch();
    if (pendingMessagesRef.current.length >= maxPendingUserMessages) {
      setNotice("待回复的消息较多，请等这一轮完成后再发送。草稿已保留。");
      return;
    }
    if (text.length > 2_000) {
      setNotice("这条消息较长，请分成几条发送。草稿已保留。");
      return;
    }
    const clientMessageId = createId("client");
    const generationId = createId("generation");
    const sourceType = assistedRef.current ? "translation_assisted" as const : undefined;
    assistedRef.current = false;
    setAssistEpoch((epoch) => epoch + 1);
    setDraft("");
    setQuotedMessage(null);
    const createdAt = new Date().toISOString();
    cancel();
    pendingMessagesRef.current.push({ text, clientMessageId, ...(sourceType ? { assistance: "translation" } : {}) });
    apply({ type: "submit", text, clientMessageId, generationId, createdAt, sourceType });
    schedulePending(generationId);
  }

  function retry() {
    if (!retryMessage || state.status === "streaming" || !historyAccess.canSend || historyAccess.readOnly) return;
    restorePendingBatch();
    if (pendingMessagesRef.current.length > maxPendingUserMessages) {
      setNotice("待回复的消息较多，暂时无法一起重发。所有消息已保留。");
      return;
    }
    const generationId = createId("generation");
    cancel();
    if (pendingMessagesRef.current.length === 0) pendingMessagesRef.current = [{ text: retryMessage.text, clientMessageId: retryMessage.clientMessageId ?? retryMessage.id, ...(retryMessage.sourceType === "translation_assisted" ? { assistance: "translation" } : {}) }];
    apply({ type: "retry", userMessageId: retryMessage.id, generationId });
    schedulePending(generationId);
  }

  function restorePendingBatch() {
    if (pendingMessagesRef.current.length > 0) return;
    const recovered = recoverPendingReply(stateRef.current);
    pendingMessagesRef.current = recovered.messages;
    if (!supersedesRef.current) supersedesRef.current = recovered.supersedes;
  }

  function retryHistory() {
    setPersistenceStatus("loading");
    setHistoryReloadToken((value) => value + 1);
  }

  /**
   * The composer owns its textarea internally, so handing the assistant's
   * applied draft back to it uses the one composer textarea in this thread.
   * The deferred focus runs after the panel has unmounted and React has
   * painted the draft into the field.
   */
  function focusComposerInput() {
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>(".conversation-composer textarea")?.focus({ preventScroll: true });
    }, 0);
  }

  function openMessageMenu(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    // A streamed reply may still be marked incomplete while its first text
    // has already arrived. Its actions are still safe to expose immediately.
    if (message.withdrawn || !message.text) return;
    event.preventDefault();
    event.stopPropagation();
    messageMenuTriggerRef.current = event.currentTarget;
    const bubble = (event.target instanceof Element ? event.target.closest<HTMLElement>(".conversation-message__bubble") : null)
      ?? event.currentTarget.querySelector<HTMLElement>(".conversation-message__bubble");
    const rect = bubble?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    setContextMenu({
      messageId: message.id,
      anchorX: message.role === "user" ? rect.right : rect.left,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      align: message.role === "user" ? "end" : "start",
    });
  }

  function openMessageMenuFromKeyboard(event: React.KeyboardEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && !message.withdrawn && message.text && message.complete) {
      event.preventDefault();
      messageMenuTriggerRef.current = event.currentTarget;
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({
        messageId: message.id,
        anchorX: message.role === "user" ? rect.right : rect.left,
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        align: message.role === "user" ? "end" : "start",
      });
    }
  }

  function toggleMessageTimestamp(messageId: string) {
    setExpandedTimestampId((current) => current === messageId ? null : messageId);
  }

  function handleMessageClick(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if (window.getSelection()?.toString()) return;
    if (message.createdAt) setExpandedTimestampId(message.id);
  }

  function handleMessageContextMenu(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if (message.text && !message.withdrawn) openMessageMenu(event, message);
    else if (message.createdAt) {
      event.preventDefault();
      toggleMessageTimestamp(message.id);
    }
  }

  function handleMessageDoubleClick(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if (!message.text || message.withdrawn) return;
    openMessageMenu(event, message);
  }

  function handleMessageKeyDown(event: React.KeyboardEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    openMessageMenuFromKeyboard(event, message);
    if ((event.key === "Enter" || event.key === " ") && message.text && !message.withdrawn) {
      event.preventDefault();
      messageMenuTriggerRef.current = event.currentTarget;
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({
        messageId: message.id,
        anchorX: message.role === "user" ? rect.right : rect.left,
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
        align: message.role === "user" ? "end" : "start",
      });
      if (message.createdAt) setExpandedTimestampId(message.id);
    }
  }

  function selectedMessage() {
    return contextMenu ? state.messages.find((message) => message.id === contextMenu.messageId) ?? null : null;
  }

  async function copyMessage(message: ConversationState["messages"][number]) {
    try {
      await navigator.clipboard.writeText(message.text);
      setNotice("已复制消息");
    } catch {
      setNotice("复制失败，请重试");
    }
    setContextMenu(null);
  }

  function quoteMessage(message: ConversationState["messages"][number]) {
    setQuotedMessage(message);
    setContextMenu(null);
  }

  async function translateMessage(message: ConversationState["messages"][number]) {
    setContextMenu(null);
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    const requestId = ++translationRequestIdRef.current;
    translationCharacterKeyRef.current = characterKey;
    setTranslations((current) => ({ ...current, [message.id]: { status: "loading" } }));
    try {
      const response = await fetch("/api/v1/conversations/translation", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text: message.text, sourceLocale: "es-ES", targetLocale: "zh-CN" }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("translation-failed");
      const payload = await response.json() as { data?: { text?: string } };
      const translated = payload.data?.text ?? "";
      if (!translated.trim()) throw new Error("translation-empty");
      if (requestId === translationRequestIdRef.current) setTranslations((current) => ({ ...current, [message.id]: { status: "success", text: translated } }));
    } catch {
      if (controller.signal.aborted || requestId !== translationRequestIdRef.current) return;
      setTranslations((current) => ({ ...current, [message.id]: { status: "error", message: "翻译暂时不可用，请稍后重试。" } }));
    } finally {
      if (translationAbortRef.current === controller) translationAbortRef.current = null;
    }
  }

  function clearTranslation(messageId: string) {
    translationRequestIdRef.current += 1;
    translationAbortRef.current?.abort();
    setTranslations((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    // Close after clearing the item so the menu cannot render one more frame
    // with the stale “取消翻译” action.
    setContextMenu(null);
  }

  async function speakMessage(message: ConversationState["messages"][number]) {
    setContextMenu(null);
    const generation = ++speechGenerationRef.current;
    if (speakingMessageId === message.id) {
      textToSpeech.stop();
      setSpeakingMessageId(null);
      return;
    }
    if (!textToSpeech.isSupported) {
      setNotice("当前浏览器不支持音频播放，请直接阅读这条消息");
      return;
    }
    setSpeakingMessageId(message.id);
    try {
      await textToSpeech.speak(message.text, { languageTag: "es-ES", rate: 1 });
    } catch (error) {
      if (speechGenerationRef.current === generation && speechCapabilityErrorCode(error, "tts-failed") !== "tts-cancelled") {
        setNotice("暂时无法朗读，请稍后重试");
      }
    } finally {
      if (speechGenerationRef.current === generation) setSpeakingMessageId(null);
    }
  }

  /**
   * The confirm dialog is rendered inside the message-menu portal so that the
   * menu item can stay its trigger, which in turn means the menu stays mounted
   * (behind the blocking overlay) until the server-backed action settles. Once
   * it succeeds the menu is closed and focus is handed back on the next task,
   * after the dialog has unmounted and can no longer claim it: to the message
   * row when a withdraw keeps the row, and to the message list when a delete
   * removed the row that focused the menu.
   */
  function releaseMessageMenuAfterAction(rowSurvives: boolean) {
    const row = messageMenuTriggerRef.current;
    setContextMenu(null);
    window.setTimeout(() => {
      if (rowSurvives && row && document.contains(row)) {
        row.focus();
        return;
      }
      messagesRef.current?.focus();
    }, 0);
  }

  async function syncAfterMessageMutation(message: ConversationState["messages"][number], action: "remove-message" | "withdraw-message", revision: number): Promise<boolean> {
    const key = message.clientMessageId ?? message.id;
    const batch = pendingMessagesRef.current.length ? pendingMessagesRef.current : recoverPendingReply(stateRef.current).messages;
    const affected = batch.some((pending) => pending.clientMessageId === key);
    if (affected && stateRef.current.status === "streaming") cancel();
    pendingMessagesRef.current = batch.filter((pending) => pending.clientMessageId !== key);
    if (affected) supersedesRef.current = null;
    apply({ type: action, messageId: message.id });
    try {
      // A pre-mutation read must not win the race or resurrect a removed source.
      const result = await loadConversationHistory(characterKey, cacheScope, { refresh: true });
      if (revision !== mutationRevisionRef.current) return true;
      const tombstones = new Set(result.messages.filter((saved) => saved.role === "character" && saved.status === "cancelled" && !saved.text.trim())
        .map((saved) => saved.generationId));
      if (transportRef.current && tombstones.has(transportRef.current.generationId)) {
        cancel();
        supersedesRef.current = null;
      }
      if (supersedesRef.current && !result.messages.some((saved) => saved.generationId === supersedesRef.current?.generationId && Boolean(saved.text.trim()))) supersedesRef.current = null;
      const pendingKeys = new Set(pendingMessagesRef.current.map((pending) => pending.clientMessageId));
      const activeGeneration = stateRef.current.status === "streaming" ? stateRef.current.activeGenerationId : null;
      const staleMessageKeys = stateRef.current.messages.filter((current) =>
        !(current.role === "user" && pendingKeys.has(current.clientMessageId ?? current.id))
        && !(current.role === "character" && activeGeneration && current.generationId === activeGeneration))
        .map((current) => current.clientMessageId ?? current.id);
      apply({ type: "replace-hydrate", messages: result.messages, staleMessageKeys });
      // The successful mutation remains authoritative even if a replica or test
      // fixture has not yet reflected the changed user row in the history read.
      apply({ type: action, messageId: message.id });
      if (stateRef.current.status === "cancelled" && pendingMessagesRef.current.length === 0 && recoverPendingReply(stateRef.current).messages.length === 0) {
        const messages = stateRef.current.messages;
        apply({ type: "reset" });
        apply({ type: "hydrate", messages });
      }
      serverMessageKeysRef.current = new Set(result.messages.map((saved) => saved.clientMessageId ?? saved.id));
      knownMessageKeysRef.current = new Set(stateRef.current.messages.map((saved) => saved.clientMessageId ?? saved.id));
      setHistoryAccess(result.access);
      setCachedConversationHistory(characterKey, stateRef.current.messages, result.access, cacheScope);
      window.dispatchEvent(new Event(CONVERSATION_LIST_UPDATED_EVENT));
      return true;
    } catch {
      return false;
    }
  }

  async function deleteMessage(message: ConversationState["messages"][number]): Promise<boolean> {
    const revision = ++mutationRevisionRef.current;
    try {
      const response = await fetch(`/api/v1/conversations/${characterKey}/messages/${message.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete-failed");
      if (revision !== mutationRevisionRef.current) return true;
      const synchronized = await syncAfterMessageMutation(message, "remove-message", revision);
      if (revision !== mutationRevisionRef.current) return true;
      setNotice(synchronized ? "消息已删除" : "消息已删除，暂时无法刷新回复，请稍后刷新对话。");
      releaseMessageMenuAfterAction(false);
      return true;
    } catch {
      // The dialog owns the failure copy and stays open; the page never claims
      // a deletion the server did not confirm.
      return false;
    }
  }

  async function withdrawMessage(message: ConversationState["messages"][number]): Promise<boolean> {
    const revision = ++mutationRevisionRef.current;
    try {
      const response = await fetch(`/api/v1/conversations/${characterKey}/messages/${message.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "withdraw" }) });
      if (revision !== mutationRevisionRef.current) return true;
      if (!response.ok) {
        // A 409 carries a reason the generic dialog copy cannot express, so the
        // page still explains it while the dialog keeps the failure state.
        if (response.status === 409) setNotice("这条消息已超过可撤回时间");
        return false;
      }
      if (revision !== mutationRevisionRef.current) return true;
      const synchronized = await syncAfterMessageMutation(message, "withdraw-message", revision);
      if (revision !== mutationRevisionRef.current) return true;
      setNotice(synchronized ? "消息已撤回，且不会用于记忆或学习数据" : "消息已撤回，暂时无法刷新回复，请稍后刷新对话。");
      releaseMessageMenuAfterAction(true);
      return true;
    } catch {
      return false;
    }
  }

  const historyLocked = persistenceStatus === "available"
    && (historyAccess.readOnly || !historyAccess.canSend);
  const historyLockMessage = historyAccess.contactStatus === "pending"
    ? "接受好友申请后才能发送消息。"
    : historyAccess.contactStatus === "declined"
      ? "你已拒绝这个好友申请，无法发送新消息。"
      : historyAccess.contactStatus === "unavailable"
        ? "这段对话目前只能查看，联系人状态暂时不可用。"
        : "这段历史记录只能查看，不能发送新消息。";

  return (
    <section className="conversation-thread" aria-labelledby="conversation-title" data-status={state.status} data-testid="conversation-thread">
      <header className="conversation-thread__header">
        <div className="conversation-thread__identity">
          <div className={`avatar ${avatarClassName}`} aria-hidden="true">{characterName.slice(0, 1)}</div>
          <div>
            <h1 id="conversation-title">{characterName}</h1>
            {state.status === "streaming" ? (
              <>
                <ConversationTypingIndicator className="conversation-thread__typing" />
                <span className="sr-only" role="status" aria-live="polite">正在回复</span>
              </>
            ) : <p>{roleLabel}</p>}
          </div>
        </div>
        <div className="conversation-thread__header-actions">
          <button className="conversation-thread__mobile-list" type="button" aria-label="打开会话列表" onClick={() => setShowMobileConversations(true)}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
          </button>
          <button
            ref={headerMenuTriggerRef}
            aria-expanded={showHeaderMenu}
            aria-haspopup="menu"
            aria-label="更多对话操作"
            className="conversation-thread__more"
            type="button"
            onClick={() => setShowHeaderMenu((value) => !value)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
          </button>
        </div>
        {showHeaderMenu ? <div ref={headerMenuRef} className="conversation-thread__header-menu" role="menu" aria-label="对话操作">
          <button type="button" role="menuitem" onClick={() => { setShowHeaderMenu(false); setShowSearch(false); setShowAssistant(true); }}>AI 助手</button>
          <button type="button" role="menuitem" onClick={() => { setShowHeaderMenu(false); setShowAssistant(false); setShowSearch(true); }}>搜索消息</button>
          <Link role="menuitem" href="/me#profile-relationships" onClick={() => setShowHeaderMenu(false)}>关系资料与清理</Link>
        </div> : null}
        {showSearch ? <div className="conversation-thread__search-panel">
          <ConversationSearch compact autoFocus onDismiss={() => { setShowSearch(false); headerMenuTriggerRef.current?.focus(); }} />
          <button type="button" aria-label="关闭消息搜索" onClick={() => { setShowSearch(false); headerMenuTriggerRef.current?.focus(); }}>×</button>
        </div> : null}
      </header>

      {showMobileConversations ? <div className="conversation-mobile-list" role="dialog" aria-modal="true" aria-label="会话列表">
        <div className="conversation-mobile-list__header"><strong>会话列表</strong><button type="button" aria-label="关闭会话列表" onClick={() => setShowMobileConversations(false)}>×</button></div>
        <ConversationContactRail activeCharacterKey={characterKey} cacheScope={cacheScope} />
      </div> : null}

      {/* tabIndex -1 keeps the scrollable transcript programmatically focusable:
          after a delete removes the row that opened the menu, the list is the
          remaining element that can receive focus. */}
      <div ref={messagesRef} className="conversation-thread__messages" tabIndex={-1} onScroll={handleMessagesScroll}>
        {persistenceStatus === "unavailable" ? (
          <div className="conversation-thread__persistence-notice" role="alert" data-testid="conversation-persistence-status">
            <span>暂时无法打开这段对话，请检查网络后重试。</span>
            <button type="button" onClick={retryHistory}>重试</button>
          </div>
        ) : null}
        {persistenceStatus === "loading" && state.messages.length === 0 ? (
          <div className="conversation-thread__loading" role="status" aria-live="polite"><span /><span /><span />正在加载聊天记录……</div>
        ) : null}
        {persistenceStatus === "available" && state.messages.length === 0 ? (
          <div className="conversation-thread__welcome">
            <p>¡Hola! Cuéntame algo de tu día.</p>
          </div>
        ) : null}
        {state.messages.map((message, index) => {
          // The header already exposes the typing state while a reply is being
          // generated. Do not create an empty assistant bubble for the meta
          // event; the bubble should appear with the first actual delta.
          if (message.role === "character" && !message.text && !message.withdrawn) return null;
          const previous = state.messages[index - 1];
          const messageDate = message.createdAt ? new Date(message.createdAt) : null;
          const previousDate = previous?.createdAt ? new Date(previous.createdAt) : null;
          const validMessageDate = messageDate && !Number.isNaN(messageDate.getTime());
          const validPreviousDate = previousDate && !Number.isNaN(previousDate.getTime());
          const dayChanged = Boolean(validMessageDate && (!validPreviousDate || messageDate.toDateString() !== previousDate.toDateString()));
          const gapExceeded = Boolean(validMessageDate && validPreviousDate && messageDate.getTime() - previousDate.getTime() > 5 * 60 * 1000);
          const showTimestamp = Boolean(message.createdAt && (dayChanged || gapExceeded));
          const timestampExpanded = expandedTimestampId === message.id;
          const timestampValue = message.createdAt;
          const translation = message.role === "character" && translationCharacterKeyRef.current === characterKey ? translations[message.id] : undefined;
          const bubbleText = message.withdrawn ? "你撤回了一条消息" : message.text;
          return <Fragment key={message.id}>
          {(showTimestamp || timestampExpanded) && timestampValue ? <time className={`conversation-thread__timestamp${timestampExpanded ? " conversation-thread__timestamp--exact" : ""}`} dateTime={timestampValue}>
            {timestampExpanded ? formatFullTimestamp(timestampValue) : formatConversationTimestamp(timestampValue, dayChanged)}
          </time> : null}
          <article
            aria-label={message.role === "user" ? "你的消息" : `${characterName} 的消息`}
            className={`conversation-message conversation-message--${message.role}`}
            data-message-id={message.id}
            data-highlighted={targetMessageId === message.id ? "true" : undefined}
            data-complete={message.complete}
            data-withdrawn={message.withdrawn ? "true" : undefined}
            aria-live={message.role === "character" && message.id === state.activeMessageId ? "polite" : undefined}
            onClick={(event) => handleMessageClick(event, message)}
            onContextMenu={(event) => handleMessageContextMenu(event, message)}
            onDoubleClick={(event) => handleMessageDoubleClick(event, message)}
            onKeyDown={(event) => handleMessageKeyDown(event, message)}
            tabIndex={message.text && message.complete && !message.withdrawn ? 0 : undefined}
            aria-expanded={contextMenu?.messageId === message.id ? true : undefined}
          >
            <div
              className={`avatar conversation-message__avatar ${message.role === "user" ? "conversation-message__avatar--user" : avatarClassName}`}
              aria-hidden="true"
              style={message.role === "user" && userProfile?.avatar.url ? { backgroundImage: `url(${userProfile.avatar.url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            >
              {message.role === "user" ? (userProfile?.avatar.url ? null : userProfile?.avatar.initials ?? "你") : characterName.slice(0, 1)}
            </div>
            <div className="conversation-message__content" style={message.role === "character" ? { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", maxWidth: "none" } : undefined}>
              {(message.role === "character" && !message.withdrawn ? replyBubbles(bubbleText) : [bubbleText]).map((text, bubbleIndex) => <ConversationMessageBubble key={bubbleIndex} text={text} />)}
              {translation ? <div className="conversation-message__translation" aria-live="polite">
                {translation.status === "loading" ? "正在翻译……" : translation.status === "error" ? <button type="button" onClick={() => void translateMessage(message)}>{translation.message}</button> : translation.text}
              </div> : null}
              {message.role === "character" && !message.complete && state.status !== "streaming" ? <span className="conversation-message__hint">这条回复没有完整送达</span> : null}
            </div>
          </article>
          </Fragment>;
        })}
      </div>
      {!isNearBottom && state.messages.length > 0 ? <button className="conversation-thread__jump-bottom" type="button" onClick={scrollToBottom}>回到底部 ↓</button> : null}
      {hasNewProactiveMessage && !isNearBottom ? <button className="conversation-thread__new-proactive" type="button" onClick={scrollToBottom}>有一条新消息</button> : null}

      {contextMenu && selectedMessage() && typeof document !== "undefined" ? createPortal(
        <div ref={messageMenuRef} className="conversation-message-menu" role="menu" aria-label={selectedMessage()?.role === "character" ? `${characterName} 的消息操作` : "你的消息操作"} style={{ left: contextMenu.x ?? contextMenu.anchorX, top: contextMenu.y ?? contextMenu.anchorBottom, visibility: contextMenu.x === undefined ? "hidden" : undefined }} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => void copyMessage(selectedMessage()!)}>复制</button>
          {/* Either side of the conversation can be heard: users re-listen to their
              own Spanish to check pronunciation, not only to Lucía's replies. */}
          <button type="button" role="menuitem" onClick={() => void speakMessage(selectedMessage()!)}>{speakingMessageId === selectedMessage()?.id ? "停止朗读" : "朗读"}</button>
          {selectedMessage()?.role === "character" ? (() => {
            const selected = selectedMessage()!;
            const translation = translations[selected.id];
            return <button type="button" role="menuitem" disabled={translation?.status === "loading"} onClick={(event) => { event.stopPropagation(); if (translation?.status === "success") clearTranslation(selected.id); else void translateMessage(selected); }}>{translation?.status === "success" ? "取消翻译" : translation?.status === "loading" ? "正在翻译……" : "翻译"}</button>;
          })() : null}
          <button type="button" role="menuitem" onClick={() => quoteMessage(selectedMessage()!)}>引用回复</button>
          {selectedMessage()?.role === "user" ? (() => {
            const selected = selectedMessage()!;
            // Both destructive actions ask for confirmation through the shared
            // dialog. Its trigger stays the menu item, so the dialog lives in
            // this portal and the menu stays mounted behind the blocking
            // overlay until the request settles (see releaseMessageMenuAfterAction).
            return <>
              <ConfirmActionDialog
                confirmLabel="确认撤回"
                description="撤回后对话中只会显示撤回提示，这条消息也不会再用于记忆或学习数据。"
                failureMessage="撤回没有完成，消息仍保留在对话中。"
                onConfirm={() => withdrawMessage(selected)}
                title="撤回这条消息？"
                trigger={<button type="button" role="menuitem">撤回</button>}
              />
              <ConfirmActionDialog
                confirmLabel="确认删除"
                description="删除后这条消息将从你的聊天记录中移除，且无法恢复。"
                failureMessage="删除没有完成，消息仍在聊天记录中。"
                onConfirm={() => deleteMessage(selected)}
                title="删除这条消息？"
                trigger={<button className="conversation-message-menu__danger" type="button" role="menuitem">删除</button>}
              />
            </>;
          })() : null}
        </div>,
        document.body,
      ) : null}

      {notice ? <p className="conversation-thread__action-notice" role="status">{notice}</p> : null}

      {state.status === "failed" || state.status === "cancelled" ? (
        <div className="conversation-thread__recovery" role="alert">
          <p>{state.status === "cancelled" ? "回复已停止，已保留目前收到的内容。" : "这次回复没有完整送达，未产生任何学习评分。"}</p>
          {retryMessage ? <button className="secondary-action" onClick={retry} type="button">重新发送</button> : null}
        </div>
      ) : null}
      {persistenceStatus === "loading" && state.messages.length === 0 ? (
        <div className="conversation-thread__composer-loading" role="status" aria-live="polite">正在准备对话……</div>
      ) : historyLocked ? (
        <div className="conversation-thread__composer-locked" role="status" data-testid="conversation-composer-locked">
          {historyLockMessage}
        </div>
      ) : (
        <VoiceComposer characterName={characterName} unavailable={persistenceStatus !== "available" && state.status !== "streaming"} onChange={setDraft} onSubmit={submit} quotedText={quotedMessage?.text ?? null} onClearQuote={() => setQuotedMessage(null)} value={draft}
          assistance={{ contextKey: `${characterKey}:${characterVersion}:${cacheScope}:${assistEpoch}`, characterKey, characterVersion,
            onAssisted: () => { assistedRef.current = true; } }} />
      )}

      {/* Kept mounted while closed so the transient transcript survives reopening;
          it paints nothing until the header menu opens it. The key drops the
          transcript and aborts any request when the character changes. */}
      <ConversationAssistant
        key={`${characterKey}:${characterVersion}`}
        characterKey={characterKey}
        characterVersion={characterVersion}
        characterName={characterName}
        draft={draft}
        onApply={(text) => { setDraft(text); setShowAssistant(false); }}
        onClose={() => closeAssistant()}
        onFocusInput={focusComposerInput}
        open={showAssistant}
        panelRef={assistantPanelRef}
      />
    </section>
  );
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRenderedLineWidths(fragments: DOMRect[], lineHeight: number): number[] {
  const lines: Array<{ centerY: number; left: number; right: number }> = [];
  const sameLineTolerance = Math.max(1, lineHeight / 3);

  for (const fragment of [...fragments].sort((left, right) => left.top - right.top || left.left - right.left)) {
    const centerY = fragment.top + fragment.height / 2;
    const line = lines.find((candidate) => Math.abs(candidate.centerY - centerY) <= sameLineTolerance);
    if (line) {
      line.left = Math.min(line.left, fragment.left);
      line.right = Math.max(line.right, fragment.right);
      continue;
    }
    lines.push({ centerY, left: fragment.left, right: fragment.right });
  }

  return lines.map((line) => line.right - line.left);
}

function fitBubbleToRenderedText(bubble: HTMLDivElement, text: HTMLDivElement): void {
  bubble.style.removeProperty("inline-size");
  bubble.removeAttribute("data-fitted");

  const range = document.createRange();
  range.selectNodeContents(text);
  if (typeof range.getClientRects !== "function") return;
  const fragments = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
  if (fragments.length === 0) return;

  const style = getComputedStyle(bubble);
  const textStyle = getComputedStyle(text);
  const renderedLineWidths = getRenderedLineWidths(fragments, cssPixels(textStyle.lineHeight));
  const widestLine = Math.max(...renderedLineWidths);
  const horizontalChrome = cssPixels(style.paddingLeft)
    + cssPixels(style.paddingRight)
    + cssPixels(style.borderLeftWidth)
    + cssPixels(style.borderRightWidth);
  const fittedWidth = Math.ceil(widestLine + (style.boxSizing === "border-box" ? horizontalChrome : 0) + 0.5);
  bubble.style.inlineSize = `${fittedWidth}px`;
  bubble.dataset.fitted = "true";
}

function ConversationMessageBubble({ text }: Readonly<{ text: string }>) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const textElement = textRef.current;
    if (!bubble || !textElement) return;

    let cancelled = false;
    let frameId: number | null = null;
    const fit = () => {
      if (!cancelled) fitBubbleToRenderedText(bubble, textElement);
    };
    const scheduleFit = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        fit();
      });
    };

    fit();
    const messageViewport = bubble.closest<HTMLElement>(".conversation-thread__messages");
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleFit);
    if (messageViewport) resizeObserver?.observe(messageViewport);
    window.addEventListener("resize", scheduleFit);
    if (document.fonts) void document.fonts.ready.then(scheduleFit);

    return () => {
      cancelled = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleFit);
      bubble.style.removeProperty("inline-size");
      bubble.removeAttribute("data-fitted");
    };
  }, [text]);

  return <div ref={bubbleRef} className="conversation-message__bubble">
    <div ref={textRef} className="conversation-message__text">{text}</div>
  </div>;
}

function formatClockTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatConversationTimestamp(value: string, includeDate: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = formatClockTime(value);
  if (!includeDate) return time;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (dayDifference > 1 && dayDifference < 7) {
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
    return `${weekday} ${time}`;
  }
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
  return `${dateLabel} ${time}`;
}

function formatFullTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
