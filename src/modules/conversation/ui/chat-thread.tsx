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

type ChatThreadProps = Readonly<{
  characterKey: "lucia" | "mateo" | "ines";
  characterName: string;
  roleLabel?: string;
  characterVersion: 1;
  avatarClassName?: string;
  initialMessageId?: string;
}>;

function createId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function ChatThread({ characterKey, characterName, roleLabel = "主要好友", characterVersion, initialMessageId, avatarClassName = "avatar--lucia" }: ChatThreadProps) {
  const router = useRouter();
  const targetMessageId = initialMessageId ?? (typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("message") ?? undefined
    : undefined);
  const [state, setState] = useState<ConversationState>(() => createConversationState());
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "available" | "unavailable">("loading");
  const [draft, setDraft] = useState("");
  const [quotedMessage, setQuotedMessage] = useState<ConversationState["messages"][number] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ConversationState["messages"][number] | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showMobileConversations, setShowMobileConversations] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const retryMessage = useMemo(() => findRetryableUserMessage(state), [state]);

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
    setIsNearBottom(nearBottom);
  }

  function scrollToBottom() {
    const container = messagesRef.current;
    if (!container) return;
    shouldFollowRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setIsNearBottom(true);
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

  useEffect(() => () => abortRef.current?.abort(), []);

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
    let cancelled = false;
    void fetch(`/api/v1/conversations/${characterKey}`)
      .then((response) => {
        if (!response.ok) {
          setPersistenceStatus("unavailable");
          return null;
        }
        setPersistenceStatus("available");
        return response.json() as Promise<{ data?: { messages?: ConversationState["messages"] } }>;
      })
      .then((payload) => {
        if (!cancelled && payload?.data?.messages) apply({ type: "hydrate", messages: payload.data.messages });
      })
      .catch(() => {
        if (!cancelled) setPersistenceStatus("unavailable");
      });
    return () => { cancelled = true; };
  }, [characterKey]);

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
          if (normalized.type === "done") receivedDone = true;
          apply({ type: "stream-event", event: normalized });
        }
      }
      for (const event of parser.push(decoder.decode())) {
        const normalized = event.generationId === "unknown" ? { ...event, generationId } : event;
        if (normalized.type === "done") receivedDone = true;
        apply({ type: "stream-event", event: normalized });
      }
      for (const event of parser.finish()) {
        const normalized = event.generationId === "unknown" ? { ...event, generationId } : event;
        apply({ type: "stream-event", event: normalized });
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
    apply({ type: "submit", text, clientMessageId, generationId });
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
    if (message.role !== "user" || message.withdrawn) return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 176;
    const menuHeight = 230;
    setContextMenu({ messageId: message.id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)) });
  }

  function openMessageMenuFromKeyboard(event: React.KeyboardEvent<HTMLElement>, message: ConversationState["messages"][number]) {
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && message.role === "user" && !message.withdrawn) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({ messageId: message.id, x: Math.max(8, Math.min(rect.left, window.innerWidth - 184)), y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 240)) });
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
            <p>{roleLabel} · 文字和语音都可以</p>
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
          const previous = state.messages[index - 1];
          const showDate = message.createdAt && (!previous?.createdAt || new Date(message.createdAt).toDateString() !== new Date(previous.createdAt).toDateString());
          return <Fragment key={message.id}>
          {showDate ? <time className="conversation-thread__date" dateTime={message.createdAt}>{formatDateLabel(message.createdAt)}</time> : null}
          <article
            aria-label={message.role === "user" ? "你的消息" : `${characterName} 的消息`}
            className={`conversation-message conversation-message--${message.role}`}
            data-message-id={message.id}
            data-highlighted={targetMessageId === message.id ? "true" : undefined}
            data-complete={message.complete}
            data-withdrawn={message.withdrawn ? "true" : undefined}
            aria-live={message.role === "character" && message.id === state.activeMessageId ? "polite" : undefined}
            onContextMenu={(event) => openMessageMenu(event, message)}
            onKeyDown={(event) => openMessageMenuFromKeyboard(event, message)}
            tabIndex={message.role === "user" && !message.withdrawn ? 0 : undefined}
          >
            <span className="conversation-message__author">{message.role === "user" ? "你" : characterName}</span>
            <div className="conversation-message__text">{message.withdrawn ? "你撤回了一条消息" : message.text || "…"}</div>
            {message.role === "user" && !message.withdrawn ? <button className="conversation-message__more" type="button" aria-label="消息操作" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ messageId: message.id, x: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)), y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 240)) }); }}>•••</button> : null}
            {message.role === "character" && !message.complete && state.status !== "streaming" ? <span className="conversation-message__hint">这条回复没有完整送达</span> : null}
          </article>
          </Fragment>;
        })}
      </div>
      {!isNearBottom && state.messages.length > 0 ? <button className="conversation-thread__jump-bottom" type="button" onClick={scrollToBottom}>回到底部 ↓</button> : null}

      {contextMenu && selectedMessage() ? (
        <div className="conversation-message-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => void copyMessage(selectedMessage()!)}>复制</button>
          <button type="button" role="menuitem" onClick={() => quoteMessage(selectedMessage()!)}>引用回复</button>
          <button type="button" role="menuitem" onClick={() => beginForward(selectedMessage()!)}>转发</button>
          <button type="button" role="menuitem" onClick={() => void withdrawMessage(selectedMessage()!)}>撤回</button>
          <button className="conversation-message-menu__danger" type="button" role="menuitem" onClick={() => void deleteMessage(selectedMessage()!)}>删除</button>
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

function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
}
