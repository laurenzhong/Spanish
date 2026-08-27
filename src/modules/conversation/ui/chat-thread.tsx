"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  ConversationNdjsonParser,
  createConversationState,
  findRetryableUserMessage,
  transitionConversationState,
  type ConversationState,
} from "@/src/modules/conversation";
import { VoiceComposer } from "./voice-composer";

type ChatThreadProps = Readonly<{
  characterKey: "lucia";
  characterName: string;
  characterVersion: 1;
}>;

function createId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function ChatThread({ characterKey, characterName, characterVersion }: ChatThreadProps) {
  const [state, setState] = useState<ConversationState>(() => createConversationState());
  const [persistenceStatus, setPersistenceStatus] = useState<"loading" | "available" | "unavailable">("loading");
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const retryMessage = useMemo(() => findRetryableUserMessage(state), [state]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  return (
    <section className="conversation-thread" aria-labelledby="conversation-title" data-testid="conversation-thread">
      <header className="conversation-thread__header">
        <Link className="conversation-thread__back" href="/chat">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
          <span>返回对话列表</span>
        </Link>
        <div className="conversation-thread__identity">
          <div className="avatar avatar--lucia" aria-hidden="true">L</div>
          <div>
            <h1 id="conversation-title">{characterName}</h1>
            <p>主要好友 · 文字和语音都可以</p>
          </div>
        </div>
        <span className="conversation-thread__status" data-status={state.status} role="status">
          {state.status === "streaming" ? "正在回复" : state.status === "completed" ? "已完成" : state.status === "failed" ? "需要重试" : state.status === "cancelled" ? "已停止" : ""}
        </span>
      </header>

      <div className="conversation-thread__messages" aria-live="polite">
        {persistenceStatus === "unavailable" ? (
          <p className="conversation-thread__persistence-notice" role="status" data-testid="conversation-persistence-status">
            聊天记录暂未保存：当前环境未连接消息数据库。配置 DATABASE_URL 后，切换页面仍可恢复记录。
          </p>
        ) : null}
        {state.messages.length === 0 ? (
          <div className="conversation-thread__welcome">
            <p className="eyebrow eyebrow--accent">Lucía 的消息</p>
            <p>¡Hola! Cuéntame algo de tu día. Yo te sigo la conversación.</p>
          </div>
        ) : null}
        {state.messages.map((message) => (
          <article
            aria-label={message.role === "user" ? "你的消息" : `${characterName} 的消息`}
            className={`conversation-message conversation-message--${message.role}`}
            key={message.id}
            data-complete={message.complete}
          >
            <span className="conversation-message__author">{message.role === "user" ? "你" : characterName}</span>
            <div className="conversation-message__text">{message.text || "…"}</div>
            {message.role === "character" && !message.complete && state.status !== "streaming" ? <span className="conversation-message__hint">这条回复没有完整送达</span> : null}
          </article>
        ))}
        <div ref={endRef} />
      </div>

      {state.status === "failed" || state.status === "cancelled" ? (
        <div className="conversation-thread__recovery" role="alert">
          <p>{state.status === "cancelled" ? "回复已停止，已保留目前收到的内容。" : "这次回复没有完整送达，未产生任何学习评分。"}</p>
          {retryMessage ? <button className="secondary-action" onClick={retry} type="button">重新发送</button> : null}
        </div>
      ) : null}
      <VoiceComposer disabled={state.status === "streaming"} onCancel={cancel} onChange={setDraft} onSubmit={submit} value={draft} />
    </section>
  );
}
