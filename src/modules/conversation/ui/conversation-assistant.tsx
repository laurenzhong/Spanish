"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useReadAloud } from "@/src/modules/providers/tts";
import { Button, Textarea } from "@/src/shared/ui/primitives";
import type {
  ConversationAssistantData,
  ConversationAssistantIntent,
} from "../schemas/conversation-assistant";
import { requestConversationAssistant } from "./request-conversation-assistant";
import "./conversation-assistant.css";

export type ConversationAssistantProps = Readonly<{
  characterKey: string;
  characterVersion: number;
  /** Used only for the dialog's accessible name; the server owns character facts. */
  characterName: string;
  open: boolean;
  /** Current composer draft, the grammar fallback when the panel note is empty. */
  draft: string;
  /** Lets the chat thread own outside-click and Escape closing without a portal. */
  panelRef?: Ref<HTMLElement>;
  onClose: () => void;
  /** Writes the chosen sentence into the composer draft; never sends it. */
  onApply: (text: string) => void;
  onFocusInput: () => void;
}>;

type AssistantRequestPayload = Readonly<{
  intent: ConversationAssistantIntent;
  question?: string;
  targetText?: string;
}>;

type TranscriptEntry = Readonly<{
  key: string;
  label: string;
  detail: string | null;
  request: AssistantRequestPayload;
  status: "pending" | "success" | "error";
  data?: ConversationAssistantData;
  errorMessage?: string;
}>;

const MAX_QUESTION_LENGTH = 800;
const MAX_NOTE_LENGTH = 2_000;
const GRAMMAR_REQUIRED_NOTICE = "先在输入框写下要检查的句子。";
const QUESTION_REQUIRED_NOTICE = "请先写下你想问的问题。";
const CANCELLED_NOTICE = "本次请求已取消。";
const ACTION_LABELS: Record<ConversationAssistantIntent, string> = {
  reply: "帮我回复",
  grammar: "检查语法",
  structure: "分析句子成分",
  question: "提问",
};

/** Local copy for the four transport outcomes; cancelled never renders an error. */
function assistantErrorMessage(reason: unknown): string | null {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "cancelled") return null;
  if (code === "timeout") return "请求超时，请重试。";
  if (code === "invalid") return "AI 助手的回答无法解析，请重试。";
  return "AI 助手暂时不可用，请稍后再试。";
}

function summarize(text: string, maximum: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum)}…` : normalized;
}

function detailFor(payload: AssistantRequestPayload): string | null {
  if (payload.targetText) return payload.targetText;
  if (payload.question) return payload.question;
  return payload.intent === "structure" ? "对方最后一句" : null;
}

function payloadLabel(payload: AssistantRequestPayload): string {
  return ACTION_LABELS[payload.intent];
}

/**
 * The private in-chat learning assistant.
 *
 * It is mounted for the lifetime of the chat thread (so its transient
 * transcript survives closing and reopening) but only paints a dialog while
 * `open` is true. Nothing is persisted and nothing is sent to the conversation:
 * applying a suggestion writes the composer draft and the learner chooses
 * whether to send it.
 */
export function ConversationAssistant({
  characterKey,
  characterVersion,
  characterName,
  open,
  draft,
  panelRef,
  onClose,
  onApply,
  onFocusInput,
}: ConversationAssistantProps) {
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<readonly TranscriptEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const speakingRef = useRef<string | null>(null);
  const generation = useRef(0);
  const entrySequence = useRef(0);
  const { speak, stop, clearError, speakingId, errorMessage } = useReadAloud();
  useEffect(() => { speakingRef.current = speakingId; }, [speakingId]);

  const cancelInFlight = useCallback(() => {
    // Only touch the shared read-aloud adapter when this panel actually owns a
    // request or playback; calling stop() for an idle closed panel would be a
    // surprising side effect for the rest of the chat workspace.
    const ownedWork = requestRef.current !== null || speakingRef.current !== null;
    generation.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    if (ownedWork) stop();
    setPending(false);
    setEntries((current) => current.some((entry) => entry.status === "pending")
      ? current.map((entry) => entry.status === "pending"
        ? { ...entry, status: "error", data: undefined, errorMessage: CANCELLED_NOTICE }
        : entry)
      : current);
  }, [stop]);

  // Closing is owned by the parent (close button, Escape, outside click). A
  // click handler cannot be relied on because the parent may close the panel
  // itself, so aborting follows the `open` prop. The state change is deferred
  // to a task: it marks the pending transcript entry as cancelled, and
  // setState must not run synchronously in an effect body. Parent-driven
  // remounting (a `key` on character switch) clears the transcript.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => cancelInFlight(), 0);
    return () => window.clearTimeout(timer);
  }, [open, cancelInFlight]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => noteRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // The composer is one rounded field like the chat composer: a single line at
  // rest, growing with Shift+Enter line breaks up to the CSS max-height.
  useEffect(() => {
    const textarea = noteRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [note, open]);

  useEffect(() => () => {
    generation.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  function requestClose() {
    cancelInFlight();
    onClose();
  }

  function focusNote() {
    noteRef.current?.focus({ preventScroll: true });
  }

  function showNotice(message: string) {
    setNotice(message);
    focusNote();
  }

  async function run(payload: AssistantRequestPayload) {
    if (pending) return;
    // The transcript entry is the single source of the loading state, so the
    // note can stay readable while a new answer is being generated.
    setPending(true);
    clearError();
    setNotice("");
    const controller = new AbortController();
    generation.current += 1;
    const attempt = generation.current;
    requestRef.current?.abort();
    requestRef.current = controller;
    const key = `assistant-entry-${entrySequence.current += 1}`;
    const entry: TranscriptEntry = {
      key,
      label: payloadLabel(payload),
      detail: detailFor(payload),
      request: payload,
      status: "pending",
    };
    setEntries((current) => [...current, entry]);
    setPending(true);
    try {
      const data = await requestConversationAssistant({
        characterKey,
        characterVersion,
        ...payload,
        attemptId: crypto.randomUUID(),
        signal: controller.signal,
      });
      if (generation.current !== attempt || controller.signal.aborted) return;
      setEntries((current) => current.map((item) => item.key === key
        ? { ...item, status: "success", data, errorMessage: undefined }
        : item));
    } catch (reason) {
      if (generation.current !== attempt || controller.signal.aborted) return;
      const message = assistantErrorMessage(reason);
      if (!message) return;
      setEntries((current) => current.map((item) => item.key === key
        ? { ...item, status: "error", data: undefined, errorMessage: message }
        : item));
    } finally {
      if (generation.current === attempt) setPending(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function askReply() {
    const question = note.trim();
    // The DTO caps `question` at 800 characters for every intent; reject it
    // locally instead of asking the server for a validation failure.
    if (question.length > MAX_QUESTION_LENGTH) {
      showNotice(`问题请控制在 ${MAX_QUESTION_LENGTH} 字以内。`);
      return;
    }
    void run({ intent: "reply", ...(question ? { question } : {}) });
  }

  function askGrammar() {
    const fromNote = note.trim();
    const targetText = fromNote || draft.trim();
    if (!targetText) {
      showNotice(GRAMMAR_REQUIRED_NOTICE);
      return;
    }
    void run({ intent: "grammar", targetText });
  }

  function askStructure() {
    const targetText = note.trim();
    void run({ intent: "structure", ...(targetText ? { targetText } : {}) });
  }

  function askQuestion() {
    // Enter stays available while a request is pending; it must not dispatch a
    // second question or wipe the text the learner is preparing.
    if (pending) return;
    const question = note.trim();
    if (!question) {
      showNotice(QUESTION_REQUIRED_NOTICE);
      return;
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      showNotice(`问题请控制在 ${MAX_QUESTION_LENGTH} 字以内。`);
      return;
    }
    // Clear the composer as soon as the question is sent. The transcript entry
    // keeps the question, so nothing is lost and the panel no longer reads as
    // an unsent message.
    setNote("");
    void run({ intent: "question", question });
  }

  function handleNoteKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Enter also confirms Chinese IME candidates; that Enter belongs to the
    // input method, not to the question form. Safari may report the composing
    // Enter with isComposing already cleared but keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    askQuestion();
  }

  function retry(entry: TranscriptEntry) {
    if (pending) return;
    setEntries((current) => current.filter((item) => item.key !== entry.key));
    void run(entry.request);
  }

  function applyText(text: string) {
    clearError();
    stop();
    onApply(text);
    onFocusInput();
  }

  function toggleReadAloud(id: string, text: string) {
    clearError();
    if (speakingId === id) {
      stop();
      return;
    }
    speak(id, text, () => setNotice("当前浏览器无法播放音频，可以直接阅读西语句子。"));
  }

  if (!open) return null;

  return (
    <>
      <div className="conversation-assistant__backdrop" aria-hidden="true" />
      <section
        aria-label={`${characterName} 的 AI 助手`}
        className="conversation-assistant"
        ref={panelRef}
        role="dialog"
      >
        <header className="conversation-assistant__header">
          <h2 className="conversation-assistant__title">AI 助手</h2>
          <button aria-label="关闭 AI 助手" className="conversation-assistant__close" onClick={requestClose} type="button">×</button>
        </header>

        <div className="conversation-assistant__body">
          <div aria-label="快捷操作" className="conversation-assistant__actions" role="group">
            <Button size="sm" className="conversation-assistant__action" disabled={pending} onClick={askReply} type="button">帮我回复</Button>
            <Button size="sm" className="conversation-assistant__action" disabled={pending} onClick={askGrammar} type="button">检查语法</Button>
            <Button size="sm" className="conversation-assistant__action conversation-assistant__action--structure" disabled={pending} onClick={askStructure} type="button">分析句子成分</Button>
          </div>
          <p className="conversation-assistant__hint">分析句子成分时不填写内容，会分析对方最后一句；检查语法会优先使用这里的文字，没有时使用聊天输入框的草稿；提问框按 Enter 发送，Shift + Enter 换行。</p>
          {notice ? <p className="conversation-assistant__notice" role="status">{notice}</p> : null}
          {errorMessage ? <p className="conversation-assistant__notice conversation-assistant__notice--error" role="alert">{errorMessage}</p> : null}

          <div aria-live="polite" className="conversation-assistant__transcript">
            {entries.length === 0
              ? <p className="conversation-assistant__empty">不知道怎么回复、想检查一句西语，或想拆解句子成分？点上面的快捷操作，或在下面直接提问。</p>
              : entries.map((entry) => <section
                aria-busy={entry.status === "pending" || undefined}
                className="conversation-assistant__entry"
                data-status={entry.status}
                key={entry.key}
              >
                <p className="conversation-assistant__request">
                  <strong>{entry.label}</strong>
                  {entry.detail ? <span> · {summarize(entry.detail, 64)}</span> : null}
                </p>
                {entry.status === "pending" ? <p className="conversation-assistant__pending" role="status">
                  <span aria-hidden="true" className="conversation-assistant__spinner" />正在思考…
                </p> : null}
                {entry.status === "error" ? <>
                  <p className="conversation-assistant__error" role="alert">{entry.errorMessage}</p>
                  <Button size="sm" variant="secondary" className="conversation-assistant__retry" onClick={() => retry(entry)} type="button">重试</Button>
                </> : null}
                {entry.status === "success" && entry.data ? <AssistantResult data={entry.data} entryKey={entry.key} onApply={applyText} speakingId={speakingId} onToggleReadAloud={toggleReadAloud} /> : null}
              </section>)}
          </div>
        </div>

        <form
          aria-label="向 AI 助手提问"
          className="conversation-assistant__composer"
          onSubmit={(event) => { event.preventDefault(); askQuestion(); }}
        >
          <div className="conversation-assistant__field">
            <Textarea
              aria-label="向 AI 助手提问"
              className="conversation-assistant__note"
              maxLength={MAX_NOTE_LENGTH}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={handleNoteKeyDown}
              placeholder="向 AI 助手提问…"
              ref={noteRef}
              rows={1}
              value={note}
            />
            <Button size="sm" aria-label="问一下" className="conversation-assistant__ask" disabled={pending} title="问一下" type="submit">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}

type AssistantResultProps = Readonly<{
  data: ConversationAssistantData;
  entryKey: string;
  speakingId: string | null;
  onApply: (text: string) => void;
  onToggleReadAloud: (id: string, text: string) => void;
}>;

function AssistantResult({ data, entryKey, speakingId, onApply, onToggleReadAloud }: AssistantResultProps) {
  return <>
    <p className="conversation-assistant__answer">{data.answer}</p>

    {data.suggestions.length > 0 ? <ul aria-label="回复建议" className="conversation-assistant__suggestions">
      {data.suggestions.map((suggestion, index) => {
        const readAloudId = `${entryKey}:suggestion:${index}`;
        const speaking = speakingId === readAloudId;
        return <li className="conversation-assistant__suggestion" key={`${entryKey}-suggestion-${index}`}>
          <p className="conversation-assistant__spanish" lang="es">{suggestion.spanish}</p>
          <p className="conversation-assistant__chinese">{suggestion.chinese}</p>
          <div className="conversation-assistant__suggestion-actions">
            <Button className="conversation-assistant__apply" onClick={() => onApply(suggestion.spanish)} type="button">填入输入框</Button>
            <Button variant="secondary" aria-label={speaking ? "停止朗读这条建议" : "朗读这条建议"} onClick={() => onToggleReadAloud(readAloudId, suggestion.spanish)} type="button">{speaking ? "停止朗读" : "听一遍"}</Button>
          </div>
        </li>;
      })}
    </ul> : null}

    {data.correctedSentence ? <div className="conversation-assistant__corrected">
      <p className="conversation-assistant__label">修正后的句子</p>
      <p className="conversation-assistant__corrected-text" lang="es">{data.correctedSentence}</p>
      <Button className="conversation-assistant__apply" onClick={() => onApply(data.correctedSentence!)} type="button">使用修正句</Button>
    </div> : null}

    {data.corrections.length > 0 ? <ul aria-label="语法修正" className="conversation-assistant__corrections">
      {data.corrections.map((correction, index) => <li className="conversation-assistant__correction" key={`${entryKey}-correction-${index}`}>
        <p className="conversation-assistant__correction-line"><del lang="es">{correction.original}</del> → <ins lang="es">{correction.corrected}</ins></p>
        <p className="conversation-assistant__correction-explanation">{correction.explanation}</p>
      </li>)}
    </ul> : null}

    {data.structure.length > 0 ? <ul aria-label="句子成分" className="conversation-assistant__structure">
      {data.structure.map((part, index) => <li className="conversation-assistant__part" key={`${entryKey}-part-${index}`}>
        <span className="conversation-assistant__fragment" lang="es">{part.fragment}</span>
        <span className="conversation-assistant__role">{part.role}</span>
        <p className="conversation-assistant__part-explanation">{part.explanation}</p>
      </li>)}
    </ul> : null}
  </>;
}
