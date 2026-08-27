"use client";

import { useEffect, useRef, useState } from "react";

import {
  createBrowserAudioRecorder,
  speechCapabilityErrorCode,
  type BrowserAudioRecorder,
} from "@/src/modules/providers/speech";

type VoiceComposerProps = Readonly<{
  disabled?: boolean;
  characterName?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}>;

export function VoiceComposer({
  disabled = false,
  characterName = "Lucía Martín",
  value,
  onChange,
  onSubmit,
  onCancel,
}: VoiceComposerProps) {
  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  useEffect(() => {
    recorderRef.current = createBrowserAudioRecorder();
    return () => {
      void recorderRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!recording || recordingStartedAt === null) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording, recordingStartedAt]);

  function resetRecordingState() {
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

  async function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder || disabled) return;
    if (recording) {
      try {
        await recorder.stop();
      } catch {
        // A failed stop still returns the composer to a safe typing state.
      }
      resetRecordingState();
      setNotice("暂时没有可验证的语音转写，请改用文字发送。录音不会上传或保存。");
      return;
    }
    try {
      await recorder.start();
      setNotice(null);
      setRecordingStartedAt(Date.now());
      setRecordingSeconds(0);
      setRecording(true);
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
      data-state={recording ? "recording" : disabled ? "streaming" : "idle"}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim()) onSubmit();
      }}
    >
      <div className="conversation-composer__shell">
        <button
          aria-label={recording ? "取消录音" : "使用语音输入"}
          className="conversation-composer__control conversation-composer__control--leading"
          disabled={disabled}
          onClick={() => void (recording ? cancelRecording() : toggleRecording())}
          title={recording ? "取消录音" : "使用语音输入"}
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
            <span className="conversation-composer__recording-time">{String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:{String(recordingSeconds % 60).padStart(2, "0")}</span>
            <span className="conversation-composer__waveform" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
            <span className="conversation-composer__recording-label">正在录音</span>
          </div>
        ) : (
          <textarea
            aria-label={`写下你想对 ${characterName === "Lucía Martín" ? "Lucía" : characterName} 说的话`}
            disabled={disabled}
            maxLength={2_000}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (!disabled && value.trim()) onSubmit();
            }}
            placeholder={disabled ? "Lucía 正在回复…" : "写下你想说的话…"}
            rows={1}
            value={value}
          />
        )}

        {disabled ? (
          <button aria-label="停止回复" className="conversation-composer__control conversation-composer__control--trailing conversation-composer__control--stop" onClick={onCancel} title="停止回复" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1" /></svg>
          </button>
        ) : recording ? (
          <button aria-label="结束录音" className="conversation-composer__control conversation-composer__control--trailing conversation-composer__control--stop" onClick={() => void toggleRecording()} title="结束录音" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" rx="1" /></svg>
          </button>
        ) : (
          <button aria-label="发送消息" className="conversation-composer__control conversation-composer__control--trailing" disabled={!value.trim()} title="发送消息" type="submit">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
          </button>
        )}
      </div>
      <div className="conversation-composer__meta">
        <span className="conversation-composer__notice" role={notice ? "status" : undefined} aria-live="polite">{notice ?? (disabled ? "回复完成后可以继续发送" : "")}</span>
        <span className="conversation-composer__help">Enter 发送 · Shift + Enter 换行</span>
      </div>
    </form>
  );
}
