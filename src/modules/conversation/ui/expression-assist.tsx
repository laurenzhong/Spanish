"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useReadAloud } from "@/src/modules/providers/tts";
import { createSupabaseBrowserClient } from "@/src/shared/auth/browser";
import { requestExpressionAssist } from "./request-expression-assist";
import "./expression-assist.css";

type Props = Readonly<{
  characterKey: string;
  characterVersion: number;
  text: string;
  disabled?: boolean;
  onApply: (text: string) => void;
  onAssisted: () => void;
  onFocusInput: () => void;
}>;

export function ExpressionAssist({ characterKey, characterVersion, text, disabled = false, onApply, onAssisted, onFocusInput }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { speak, stop, clearError, speakingId, errorMessage } = useReadAloud();

  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    stop();
  }, [stop]);
  const close = useCallback(() => {
    cancel();
    setOpen(false);
    setPending(false);
    setSource("");
    setResult("");
    setError("");
    setUnsupported("");
    clearError();
  }, [cancel, clearError]);

  // Discard the previous draft before an old response or audio callback can run.
  useLayoutEffect(() => () => close(), [text, disabled, characterKey, characterVersion, close]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") close(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", close);
    window.addEventListener("account-signed-out", close);
    const auth = createSupabaseBrowserClient()?.auth.onAuthStateChange((event) => {
      if (event !== "INITIAL_SESSION") close();
    });
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("account-signed-out", close);
      auth?.data.subscription.unsubscribe();
    };
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const container = trigger.current?.closest("form") ?? trigger.current?.parentElement;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); close(); onFocusInput();
    };
    container?.addEventListener("keydown", escape);
    return () => container?.removeEventListener("keydown", escape);
  }, [open, close, onFocusInput]);

  async function generate() {
    if (disabled || pending || !text.trim()) return;
    cancel();
    clearError();
    setUnsupported("");
    setResult("");
    setError("");
    setSource(text);
    setOpen(true);
    const controller = new AbortController();
    request.current = controller;
    const attempt = generation.current;
    setPending(true);
    try {
      const translated = await requestExpressionAssist({
        characterKey, characterVersion, text: text.trim(), attemptId: crypto.randomUUID(), signal: controller.signal,
      });
      if (generation.current !== attempt || controller.signal.aborted) return;
      setResult(translated);
      onAssisted();
    } catch (reason) {
      if (generation.current !== attempt || controller.signal.aborted) return;
      setError(reason instanceof Error && reason.message === "timeout"
        ? "生成超时，保留了你的输入，请重试。"
        : "暂时无法生成西语表达，保留了你的输入，请重试。");
    } finally {
      if (generation.current === attempt) setPending(false);
      if (request.current === controller) request.current = null;
    }
  }

  const active = open && source === text && !disabled;
  const showPreview = active && Boolean(result || error);
  return <div className="expression-assist">
    <button ref={trigger} type="button" className="conversation-composer__control expression-assist__trigger"
      disabled={disabled} aria-label={active && pending ? "取消翻译" : "译成西语"}
      title={active && pending ? "取消翻译" : "译成西语"} aria-expanded={showPreview} aria-controls={panelId}
      onClick={() => {
        if (active && (pending || result)) { close(); onFocusInput(); }
        else if (!text.trim()) onFocusInput();
        else void generate();
      }}>
      {active && pending ? <svg aria-hidden="true" className="expression-assist__spinner" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-8-8" /></svg> : "译"}
    </button>
    {active && pending ? <span className="expression-assist__status" role="status">正在翻译，可再次点击取消</span> : null}
    {showPreview ? <section id={panelId} className="expression-assist__panel" aria-label="翻译预览">
      <button className="expression-assist__close" type="button" aria-label="关闭翻译预览" onClick={() => { close(); onFocusInput(); }}>×</button>
      {error ? <>
        <p className="expression-assist__error" role="alert">{error}</p>
        <button type="button" className="expression-assist__retry" aria-label="重试翻译" onClick={() => void generate()}>重试</button>
      </> : null}
      {result ? <>
        <p className="expression-assist__text" lang="es" aria-live="polite">{result}</p>
        <div className="expression-assist__actions">
          <button type="button" className="expression-assist__listen" onClick={() => {
            if (speakingId) stop();
            else speak("expression", result, () => setUnsupported("当前浏览器无法播放音频，可以直接阅读译文。"));
          }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14" /></svg>{speakingId ? "停止朗读" : "听一遍"}</button>
          <button type="button" className="expression-assist__primary" aria-label="使用译文" onClick={() => { close(); onApply(result); onFocusInput(); }}>使用</button>
        </div>
      </> : null}
      {errorMessage || unsupported ? <p className="expression-assist__error" role="alert">{errorMessage || unsupported}</p> : null}
    </section> : null}
  </div>;
}
