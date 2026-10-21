"use client";

import { useEffect, useRef, useState } from "react";
import { ExpressionAssist } from "./expression-assist";

import {
  createBrowserAudioRecorder,
  speechCapabilityErrorCode,
  type BrowserAudioRecorder,
} from "@/src/modules/providers/speech";

type VoiceComposerProps = Readonly<{
  disabled?: boolean;
  unavailable?: boolean;
  characterName?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  quotedText?: string | null;
  onClearQuote?: () => void;
  assistance?: Readonly<{
    contextKey: string;
    characterKey: string;
    characterVersion: number;
    onAssisted: () => void;
  }>;
}>;

/** Per-bar multipliers so the live level reads as a wave rather than a solid block. */
const composerBarWeights = [0.5, 0.85, 1, 0.68, 0.92, 0.58, 0.74] as const;

export function VoiceComposer({
  disabled = false,
  unavailable = false,
  characterName = "Lucía Martín",
  value,
  onChange,
  onSubmit,
  onCancel,
  quotedText = null,
  onClearQuote,
  assistance,
}: VoiceComposerProps) {
  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const transcriptionAttemptRef = useRef(0);
  // `null` means "no live measurement available": the bars keep their decorative
  // fallback animation instead of pretending to show real input.
  const [inputLevel, setInputLevel] = useState<number | null>(null);
  const levelUnsubscribeRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Streaming only blocks submitting another turn and recording. The text
  // field remains a normal composer so the user can prepare their next reply
  // while the character is responding.
  const blocked = unavailable;

  useEffect(() => {
    recorderRef.current = createBrowserAudioRecorder();
    return () => {
      levelUnsubscribeRef.current?.();
      levelUnsubscribeRef.current = null;
      void recorderRef.current?.cancel();
      transcriptionAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!recording || recordingStartedAt === null) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording, recordingStartedAt]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    let width: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value, recording, transcribing]);

  function stopLevelMeter() {
    levelUnsubscribeRef.current?.();
    levelUnsubscribeRef.current = null;
    setInputLevel(null);
  }

  function resetRecordingState() {
    stopLevelMeter();
    setRecording(false);
    setRecordingStartedAt(null);
    setRecordingSeconds(0);
  }

  async function cancelRecording() {
    try {
      await recorderRef.current?.cancel();
    } finally {
      resetRecordingState();
      setNotice(null);
    }
  }

  async function transcribeAudio(audio: Awaited<ReturnType<BrowserAudioRecorder["stop"]>>): Promise<void> {
    const attempt = ++transcriptionAttemptRef.current;
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    setTranscribing(true);
    setNotice("正在整理语音……");
    try {
      const form = new FormData();
      form.append("audio", audio.blob, "conversation.webm");
      form.append("languageTag", "es-ES");
      const response = await fetch("/api/v1/transcriptions", { method: "POST", body: form, signal: controller.signal });
      const payload = await response.json().catch(() => null) as { data?: { text?: string }; error?: { code?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.code ?? "TRANSCRIPTION_UNAVAILABLE");
      const text = payload?.data?.text?.trim() ?? "";
      if (!text) throw new Error("TRANSCRIPTION_EMPTY");
      if (attempt !== transcriptionAttemptRef.current) return;
      onChange(text);
      setNotice("已整理语音，请确认后发送。音频不会保存。");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (attempt !== transcriptionAttemptRef.current) return;
      setNotice(error instanceof Error && error.message === "TRANSCRIPTION_EMPTY" ? "没有听清内容，请重试。" : "语音整理失败，请重试或改用文字。");
    } finally {
      if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
      if (attempt === transcriptionAttemptRef.current) setTranscribing(false);
    }
  }

  async function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder || blocked) return;
    if (transcribing) {
      transcriptionAttemptRef.current += 1;
      transcriptionAbortRef.current?.abort();
      setTranscribing(false);
      setNotice(null);
      return;
    }
    if (recording) {
      let audio: Awaited<ReturnType<BrowserAudioRecorder["stop"]>> | null = null;
      try {
        audio = await recorder.stop();
      } catch {
        setNotice("录音结束失败，请重试或改用文字。");
      }
      resetRecordingState();
      if (audio) void transcribeAudio(audio);
      return;
    }
    try {
      await recorder.start();
      setNotice(null);
      setRecordingStartedAt(Date.now());
      setRecordingSeconds(0);
      setRecording(true);
      // Real input level replaces the decorative loop as soon as the browser can
      // measure it; otherwise `inputLevel` stays null and the fallback runs.
      levelUnsubscribeRef.current = recorder.isLevelMeterSupported
        ? recorder.subscribeLevel((level) => setInputLevel(level))
        : null;
    } catch (error) {
      resetRecordingState();
      const code = speechCapabilityErrorCode(error, "microphone-not-supported");
      setNotice(
        code === "microphone-permission-denied"
          ? "麦克风权限未开启，请改用文字输入。"
          : "当前设备暂不支持录音，请改用文字输入。",
      );
    }
  }

  return (
    <form
      className="conversation-composer"
      data-state={recording ? "recording" : transcribing ? "transcribing" : unavailable ? "unavailable" : "idle"}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && !transcribing && value.trim()) onSubmit();
      }}
    >
      {quotedText ? (
        <div className="conversation-composer__quote" data-testid="conversation-composer-quote">
          <span><strong>引用回复</strong><br />{quotedText}</span>
          <button aria-label="取消引用" type="button" onClick={onClearQuote}>×</button>
        </div>
      ) : null}
      <div className="conversation-composer__input">
      <div className="conversation-composer__shell">
        <button
          aria-label={recording ? "取消录音" : transcribing ? "取消语音整理" : "使用语音输入"}
          className="conversation-composer__control conversation-composer__control--leading"
          disabled={blocked}
          onClick={() => void (recording ? cancelRecording() : toggleRecording())}
          title={recording ? "取消录音" : transcribing ? "取消语音整理" : "使用语音输入"}
          type="button"
        >
          {recording ? (
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3m-4 0h8" /></svg>
          )}
        </button>

        {recording ? (
          <div className="conversation-composer__recording" role="status" aria-live="polite">
            <span aria-hidden="true" className="conversation-composer__recording-time">{String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:{String(recordingSeconds % 60).padStart(2, "0")}</span>
            <span className="conversation-composer__waveform" aria-hidden="true" data-live={inputLevel === null ? "false" : "true"}>
              {composerBarWeights.map((weight, index) => (
                <i
                  key={index}
                  style={inputLevel === null ? undefined : { animation: "none", transform: `scaleY(${Math.max(0.05, Math.min(1, weight * inputLevel)).toFixed(3)})` }}
                />
              ))}
            </span>
            <span className="conversation-composer__recording-label">正在录音</span>
          </div>
        ) : transcribing ? (
          <div className="conversation-composer__recording" role="status" aria-live="polite"><span className="conversation-composer__recording-label">正在整理语音……</span></div>
        ) : (
          <textarea
            aria-label={`写下你想对 ${characterName === "Lucía Martín" ? "Lucía" : characterName} 说的话`}
            disabled={unavailable || transcribing}
            lang="es"
            maxLength={2_000}
            ref={textareaRef}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (!blocked && !transcribing && value.trim()) onSubmit();
            }}
            placeholder={unavailable ? "对话暂时不可用" : "写下你想说的话…"}
            rows={1}
            value={value}
          />
        )}

        <div className="conversation-composer__actions">
        {assistance ? <ExpressionAssist key={`${assistance.contextKey}:${recording || transcribing}:${unavailable}`}
          characterKey={assistance.characterKey} characterVersion={assistance.characterVersion}
          text={value} disabled={blocked || recording || transcribing}
          onAssisted={assistance.onAssisted} onApply={onChange}
          onFocusInput={() => textareaRef.current?.focus({ preventScroll: true })} /> : null}
        {recording ? (
          <button aria-label="结束录音" className="conversation-composer__control conversation-composer__control--trailing conversation-composer__control--stop" onClick={() => void toggleRecording()} title="结束录音" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1" /></svg>
          </button>
        ) : transcribing ? (
          <button aria-label="取消语音整理" className="conversation-composer__control conversation-composer__control--trailing conversation-composer__control--stop" onClick={() => void toggleRecording()} title="取消语音整理" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>
          </button>
        ) : disabled ? (
          // While a reply streams the trailing slot stops it instead of sending:
          // both controls must never be on screen at once.
          <button aria-label="停止回复" className="conversation-composer__control conversation-composer__control--trailing conversation-composer__control--stop" onClick={onCancel} title="停止回复" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1" /></svg>
          </button>
        ) : (
          <button aria-label="发送消息" className="conversation-composer__control conversation-composer__control--trailing" disabled={unavailable || !value.trim()} title="发送消息" type="submit">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
          </button>
        )}
        </div>
      </div>
      </div>
      {notice ? <div className="conversation-composer__meta">
        <span className="conversation-composer__notice" role="status" aria-live="polite">{notice}</span>
      </div> : null}
    </form>
  );
}
