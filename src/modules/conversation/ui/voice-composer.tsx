"use client";

import { useEffect, useRef, useState } from "react";

import {
  createBrowserAudioRecorder,
  speechCapabilityErrorCode,
  type BrowserAudioRecorder,
} from "@/src/modules/providers/speech";

type VoiceComposerProps = Readonly<{
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}>;

export function VoiceComposer({
  disabled = false,
  value,
  onChange,
  onSubmit,
  onCancel,
}: VoiceComposerProps) {
  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    recorderRef.current = createBrowserAudioRecorder();
    return () => {
      void recorderRef.current?.cancel();
    };
  }, []);

  async function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder || disabled) return;
    if (recording) {
      try {
        await recorder.stop();
      } catch {
        // A failed stop still returns the composer to a safe typing state.
      }
      setRecording(false);
      setNotice("暂时没有可验证的语音转写，请改用文字发送。录音不会上传或保存。");
      return;
    }
    try {
      await recorder.start();
      setNotice("正在录音；停止后会回到文字输入，不会伪造转写。 ");
      setRecording(true);
    } catch (error) {
      setRecording(false);
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
      <div className="conversation-composer__status" role="status" aria-live="polite">
        <span className="conversation-composer__status-dot" aria-hidden="true" />
        <span>{recording ? "正在录音" : disabled ? "Lucía 正在回复" : "语音优先，也可以打字"}</span>
        {notice ? <span className="conversation-composer__notice">{notice}</span> : null}
      </div>
      <div className="conversation-composer__row">
        <button
          aria-label={recording ? "停止录音" : "使用语音输入"}
          className={`icon-action ${recording ? "icon-action--active" : ""}`}
          disabled={disabled}
          onClick={() => void toggleRecording()}
          title={recording ? "停止录音" : "使用语音输入"}
          type="button"
        >
          {recording ? <span aria-hidden="true">■</span> : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3m-4 0h8" /></svg>}
        </button>
        <textarea
          aria-label="写下你想对 Lucía 说的话"
          disabled={disabled || recording}
          maxLength={2_000}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (!disabled && !recording && value.trim()) onSubmit();
          }}
          placeholder="写下你想说的话…"
          rows={2}
          value={value}
        />
        {disabled ? (
          <button aria-label="停止回复" className="icon-action icon-action--stop" onClick={onCancel} title="停止回复" type="button">
            <span aria-hidden="true">■</span>
          </button>
        ) : (
          <button aria-label="发送消息" className="icon-action" disabled={!value.trim()} title="发送消息" type="submit">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 14-7-4 14-3-6-7-1Z" /></svg>
          </button>
        )}
      </div>
    </form>
  );
}
