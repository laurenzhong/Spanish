"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ConversationNdjsonParser,
  createConversationState,
  findRetryableUserMessage,
  transitionConversationState,
  type ConversationState,
} from "@/src/modules/conversation";
import { VoiceComposer } from "./voice-composer";
import { ConversationSearch } from "./conversation-search";
import { ConversationContactRail } from "./conversation-contact-rail";
import {
  getCachedConversationHistory,
  loadConversationHistory,
  setCachedConversationHistory,
} from "./conversation-history-cache";

type ChatThreadProps = Readonly<{
  characterKey: "lucia" | "mateo" | "ines";
  characterName: string;
  roleLabel?: string;
  characterVersion: 1;
  avatarClassName?: string;
  initialMessageId?: string;
  initialMessages?: readonly ConversationState["messages"][number][];
}>;

type UserAvatarProfile = Readonly<{
  displayName: string | null;
  avatar: Readonly<{ url: string | null; initials: string; colorIndex: number }>;
}>;

type MessageTranslation =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "success"; text: string }>
  | Readonly<{ status: "error"; message: string }>;

function createId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function ChatThread({ characterKey, characterName, roleLabel = "主要好友", characterVersion, initialMessageId, initialMessages, avatarClassName = "avatar--lucia" }: ChatThreadProps) {
  const router = useRouter();
  const targetMessageId = initialMessageId ?? (typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("message") ?? undefined
    : undefined);
  const [state, setState] = useState<ConversationState>(() => initialMessages
    ? transitionConversationState(createConversationState(), { type: "hydrate", messages: initialMessages })
    : createConversationState());
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "available" | "unavailable">(initialMessages ? "available" : "loading");
  const [draft, setDraft] = useState("");
  const [quotedMessage, setQuotedMessage] = useState<ConversationState["messages"][number] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [translations, setTranslations] = useState<Record<string, MessageTranslation>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ConversationState["messages"][number] | null>(null);
  const [expandedTimestampId, setExpandedTimestampId] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewProactiveMessage, setHasNewProactiveMessage] = useState(false);
  const [showMobileConversations, setShowMobileConversations] = useState(false);
  const [userProfile, setUserProfile] = useState<UserAvatarProfile | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationRequestIdRef = useRef(0);
  const translationCharacterKeyRef = useRef(characterKey);
  const messagesRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
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
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
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
    abortRef.current?.abort();
    translationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    translationAbortRef.current?.abort();
    translationRequestIdRef.current += 1;
    translationCharacterKeyRef.current = characterKey;
  }, [characterKey]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKeyDown); };
  }, [contextMenu]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    abortRef.current?.abort();
    let cancelled = false;
    const cached = getCachedConversationHistory(characterKey);
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
        const result = await loadConversationHistory(characterKey);
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
        setCachedConversationHistory(characterKey, result.messages);
        setPersistenceStatus("available");
        serverHistoryLoadedRef.current = true;
      } catch {
        // A cached snapshot is still usable while the server is temporarily
        // unreachable; only show the unavailable state when there is no view
        // to fall back to.
        if (!cancelled && initialLoad && !cached?.length) setPersistenceStatus("unavailable");
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
  }, [characterKey, initialMessages]);

  useEffect(() => {
    if (state.messages.length === 0) return;
    setCachedConversationHistory(characterKey, state.messages);
  }, [characterKey, state.messages]);

  useEffect(() => {
    const forwarded = sessionStorage.getItem("conversation-forward-draft");
    if (!forwarded) return;
    sessionStorage.removeItem("conversation-forward-draft");
    const timer = window.setTimeout(() => setDraft(forwarded), 0);
    return () => window.clearTimeout(timer);
  }, [characterKey]);

  function apply(action: Parameters<typeof transitionConversationState>[1]) {
    setState((current) => transitionConversationState(current, action));
  }

  async function consume(text: string, clientMessageId: string, generationId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/v1/conversations/${characterKey}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ characterVersion, text, clientMessageId, generationId }),
        signal: controller.signal,
      });
      setPersistenceStatus(response.headers.get("x-conversation-persistence") === "available" ? "available" : "unavailable");
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
      const decoder = new TextDecoder();
      const parser = new ConversationNdjsonParser();
      let receivedDone = false;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        for (const event of parser.push(decoder.decode(result.value, { stream: true }))) {
          const normalized = event.generationId === "unknown" ? { ...event, generationId } : event;
          const timestamped = normalized.type === "meta" && !normalized.createdAt
            ? { ...normalized, createdAt: new Date().toISOString() }
            : normalized;
          if (timestamped.type === "done") receivedDone = true;
          apply({ type: "stream-event", event: timestamped });
        }
      }
      for (const event of parser.push(decoder.decode())) {
        const normalized = event.generationId === "unknown" ? { ...event, generationId } : event;
        const timestamped = normalized.type === "meta" && !normalized.createdAt
          ? { ...normalized, createdAt: new Date().toISOString() }
          : normalized;
        if (timestamped.type === "done") receivedDone = true;
        apply({ type: "stream-event", event: timestamped });
      }
      for (const event of parser.finish()) {
        const normalized = event.generationId === "unknown" ? { ...event, generationId } : event;
        const timestamped = normalized.type === "meta" && !normalized.createdAt
          ? { ...normalized, createdAt: new Date().toISOString() }
          : normalized;
        apply({ type: "stream-event", event: timestamped });
      }
      if (!receivedDone && !controller.signal.aborted) {
        apply({
          type: "stream-event",
          event: { type: "error", generationId, messageId: null, code: "stream-failed", retryable: true },
        });
      }
    } catch {
      if (controller.signal.aborted) {
        apply({ type: "cancel", generationId });
      } else {
        apply({
          type: "stream-event",
          event: { type: "error", generationId, messageId: null, code: "stream-failed", retryable: true },
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text || state.status === "streaming") return;
    const clientMessageId = createId("client");
    const generationId = createId("generation");
    setDraft("");
    setQuotedMessage(null);
    apply({ type: "submit", text, clientMessageId, generationId, createdAt: new Date().toISOString() });
    void consume(text, clientMessageId, generationId);
  }

  function retry() {
    if (!retryMessage || state.status === "streaming") return;
    const generationId = createId("generation");
    apply({ type: "retry", userMessageId: retryMessage.id, generationId });
    void consume(retryMessage.text, retryMessage.clientMessageId ?? retryMessage.id, generationId);
  }

  function cancel() {
    const generationId = state.activeGenerationId;
    if (!generationId) return;
    abortRef.current?.abort();
    apply({ type: "cancel", generationId });
  }

  function openMessageMenu(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if (message.withdrawn || !message.text || !message.complete) return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 176;
    const menuHeight = message.role === "character" ? 140 : 230;
    setContextMenu({ messageId: message.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)) });
  }

  function openMessageMenuFromKeyboard(event: React.KeyboardEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && !message.withdrawn && message.text && message.complete) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const menuHeight = message.role === "character" ? 140 : 240;
      setContextMenu({ messageId: message.id, x: Math.max(8, Math.min(rect.left, window.innerWidth - 184)), y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menuHeight)) });
    }
  }

  function toggleMessageTimestamp(messageId: string) {
    setExpandedTimestampId((current) => current === messageId ? null : messageId);
  }

  function handleMessageClick(message: ConversationState["messages"][number]) {
    if (!message.createdAt) return;
    toggleMessageTimestamp(message.id);
  }

  function handleMessageContextMenu(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if (message.text && message.complete && !message.withdrawn) openMessageMenu(event, message);
    else if (message.createdAt) {
      event.preventDefault();
      toggleMessageTimestamp(message.id);
    }
  }

  function handleMessageDoubleClick(event: React.MouseEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if (!message.text || !message.complete || message.withdrawn) return;
    openMessageMenu(event, message);
  }

  function handleMessageKeyDown(event: React.KeyboardEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    openMessageMenuFromKeyboard(event, message);
    if ((event.key === "Enter" || event.key === " ") && message.createdAt) {
      event.preventDefault();
      toggleMessageTimestamp(message.id);
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
      const response = await fetch("/api/v1/read/word-explanation", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, application/x-ndjson" },
        body: JSON.stringify({ word: message.text, context: message.text, locale: "es-ES", selectionType: "sentence" }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("translation-failed");
      const contentType = response.headers.get("content-type") ?? "";
      let translated = "";
      if (contentType.includes("ndjson") && response.body) {
        const raw = await response.text();
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type?: string; explanation?: { contextualMeaning?: string; meaning?: string } };
          if (event.type === "done") translated = event.explanation?.contextualMeaning ?? event.explanation?.meaning ?? "";
        }
      } else {
        const payload = await response.json() as { data?: { contextualMeaning?: string; meaning?: string } };
        translated = payload.data?.contextualMeaning ?? payload.data?.meaning ?? "";
      }
      if (!translated.trim()) throw new Error("translation-empty");
      if (requestId === translationRequestIdRef.current) setTranslations((current) => ({ ...current, [message.id]: { status: "success", text: translated } }));
    } catch {
      if (controller.signal.aborted || requestId !== translationRequestIdRef.current) return;
      setTranslations((current) => ({ ...current, [message.id]: { status: "error", message: "翻译暂时不可用，请稍后重试。" } }));
    } finally {
      if (translationAbortRef.current === controller) translationAbortRef.current = null;
    }
  }

  function beginForward(message: ConversationState["messages"][number]) {
    setForwardingMessage(message);
    setContextMenu(null);
  }

  function forwardTo(target: "lucia" | "mateo" | "ines") {
    if (!forwardingMessage) return;
    const quote = `引用自 ${characterName}：\n> ${forwardingMessage.text.split("\n").join("\n> ")}`;
    sessionStorage.setItem("conversation-forward-draft", quote);
    setForwardingMessage(null);
    router.push(`/chat/${target}`);
  }

  async function deleteMessage(message: ConversationState["messages"][number]) {
    if (!window.confirm("删除后将从你的聊天记录中移除，是否继续？")) return;
    setContextMenu(null);
    try {
      const response = await fetch(`/api/v1/conversations/${characterKey}/messages/${message.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete-failed");
      apply({ type: "remove-message", messageId: message.id });
      setNotice("消息已删除");
    } catch {
      setNotice("消息删除失败，请重试");
    }
  }

  async function withdrawMessage(message: ConversationState["messages"][number]) {
    if (!window.confirm("撤回后对话中只会显示撤回提示，是否继续？")) return;
    setContextMenu(null);
    try {
      const response = await fetch(`/api/v1/conversations/${characterKey}/messages/${message.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "withdraw" }) });
      if (!response.ok) {
        setNotice(response.status === 409 ? "这条消息已超过可撤回时间" : "消息撤回失败，请重试");
        return;
      }
      apply({ type: "withdraw-message", messageId: message.id });
      setNotice("消息已撤回，且不会用于记忆或学习数据");
    } catch {
      setNotice("消息撤回失败，请重试");
    }
  }

  return (
    <section className="conversation-thread" aria-labelledby="conversation-title" data-testid="conversation-thread">
      <header className="conversation-thread__header">
        <div className="conversation-thread__identity">
          <div className={`avatar ${avatarClassName}`} aria-hidden="true">{characterName.slice(0, 1)}</div>
          <div>
            <h1 id="conversation-title">{characterName}</h1>
            <p>{roleLabel}</p>
          </div>
        </div>
        <ConversationSearch compact />
        <button className="conversation-thread__mobile-list" type="button" onClick={() => setShowMobileConversations(true)}>会话列表</button>
        <span className="conversation-thread__status" data-status={state.status} role="status">
          {state.status === "streaming" ? "正在回复" : state.status === "completed" ? "已完成" : state.status === "failed" ? "需要重试" : state.status === "cancelled" ? "已停止" : ""}
        </span>
      </header>

      {showMobileConversations ? <div className="conversation-mobile-list" role="dialog" aria-modal="true" aria-label="会话列表">
        <div className="conversation-mobile-list__header"><strong>会话列表</strong><button type="button" aria-label="关闭会话列表" onClick={() => setShowMobileConversations(false)}>×</button></div>
        <ConversationContactRail activeCharacterKey={characterKey} />
      </div> : null}

      <div ref={messagesRef} className="conversation-thread__messages" onScroll={handleMessagesScroll}>
        {persistenceStatus === "unavailable" ? (
          <p className="conversation-thread__persistence-notice" aria-live="polite" data-testid="conversation-persistence-status">
            聊天记录暂未保存：当前环境未连接消息数据库。配置 DATABASE_URL 后，切换页面仍可恢复记录。
          </p>
        ) : null}
        {persistenceStatus === "loading" && state.messages.length === 0 ? (
          <div className="conversation-thread__loading" role="status" aria-live="polite"><span /><span /><span />正在加载聊天记录……</div>
        ) : null}
        {persistenceStatus !== "loading" && state.messages.length === 0 ? (
          <div className="conversation-thread__welcome">
            <p className="eyebrow eyebrow--accent">{characterName} 的消息</p>
            <p>¡Hola! Cuéntame algo de tu día. Yo te sigo la conversación.</p>
          </div>
        ) : null}
        {state.messages.map((message, index) => {
          if (message.role === "character" && !message.complete && !message.text && state.status !== "streaming") return null;
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
            onClick={() => handleMessageClick(message)}
            onContextMenu={(event) => handleMessageContextMenu(event, message)}
            onDoubleClick={(event) => handleMessageDoubleClick(event, message)}
            onKeyDown={(event) => handleMessageKeyDown(event, message)}
            tabIndex={message.createdAt ? 0 : undefined}
          >
            <div
              className={`avatar conversation-message__avatar ${message.role === "user" ? "conversation-message__avatar--user" : avatarClassName}`}
              aria-hidden="true"
              style={message.role === "user" && userProfile?.avatar.url ? { backgroundImage: `url(${userProfile.avatar.url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            >
              {message.role === "user" ? (userProfile?.avatar.url ? null : userProfile?.avatar.initials ?? "你") : characterName.slice(0, 1)}
            </div>
            <div className="conversation-message__content">
              <div className="conversation-message__bubble">
                <div className="conversation-message__text">{message.withdrawn ? "你撤回了一条消息" : message.text || "…"}</div>
                {message.role === "user" && !message.withdrawn ? <button className="conversation-message__more" type="button" aria-label="消息操作" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ messageId: message.id, x: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)), y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 240)) }); }}>•••</button> : null}
              </div>
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

      {contextMenu && selectedMessage() ? (
        <div className="conversation-message-menu" role="menu" aria-label={selectedMessage()?.role === "character" ? `${characterName} 的消息操作` : "你的消息操作"} style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => void copyMessage(selectedMessage()!)}>复制</button>
          {selectedMessage()?.role === "character" ? <button type="button" role="menuitem" onClick={() => void translateMessage(selectedMessage()!)}>翻译</button> : null}
          <button type="button" role="menuitem" onClick={() => quoteMessage(selectedMessage()!)}>引用回复</button>
          {selectedMessage()?.role === "user" ? <>
            <button type="button" role="menuitem" onClick={() => beginForward(selectedMessage()!)}>转发</button>
            <button type="button" role="menuitem" onClick={() => void withdrawMessage(selectedMessage()!)}>撤回</button>
            <button className="conversation-message-menu__danger" type="button" role="menuitem" onClick={() => void deleteMessage(selectedMessage()!)}>删除</button>
          </> : null}
        </div>
      ) : null}

      {forwardingMessage ? (
        <div className="conversation-forward-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-forward-title">
          <div className="conversation-forward-dialog__panel">
            <h2 id="conversation-forward-title">转发给</h2>
            <p>{forwardingMessage.text}</p>
            <div className="conversation-forward-dialog__targets">
              <button type="button" onClick={() => forwardTo("lucia")}>Lucía</button>
              <button type="button" onClick={() => forwardTo("mateo")}>Mateo</button>
              <button type="button" onClick={() => forwardTo("ines")}>Inés</button>
            </div>
            <button className="secondary-action" type="button" onClick={() => setForwardingMessage(null)}>取消</button>
          </div>
        </div>
      ) : null}
      {notice ? <p className="conversation-thread__action-notice" role="status">{notice}</p> : null}

      {state.status === "failed" || state.status === "cancelled" ? (
        <div className="conversation-thread__recovery" role="alert">
          <p>{state.status === "cancelled" ? "回复已停止，已保留目前收到的内容。" : "这次回复没有完整送达，未产生任何学习评分。"}</p>
          {retryMessage ? <button className="secondary-action" onClick={retry} type="button">重新发送</button> : null}
        </div>
      ) : null}
      <VoiceComposer characterName={characterName} disabled={state.status === "streaming"} onCancel={cancel} onChange={setDraft} onSubmit={submit} quotedText={quotedMessage?.text ?? null} onClearQuote={() => setQuotedMessage(null)} value={draft} />
    </section>
  );
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
