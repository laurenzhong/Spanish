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
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim()) onSubmit();
      }}
    >
      {notice ? <p className="conversation-composer__notice" role="status">{notice}</p> : null}
      <div className="conversation-composer__row">
        <button
          aria-label={recording ? "停止录音" : "使用语音输入"}
          className={`icon-action ${recording ? "icon-action--active" : ""}`}
          disabled={disabled}
          onClick={() => void toggleRecording()}
          title={recording ? "停止录音" : "使用语音输入"}
          type="button"
        >
          <span aria-hidden="true">{recording ? "■" : "♩"}</span>
        </button>
        <textarea
          aria-label="写下你想对 Lucía 说的话"
          disabled={disabled || recording}
          maxLength={2_000}
          onChange={(event) => onChange(event.target.value)}
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
            <span aria-hidden="true">↑</span>
          </button>
        )}
      </div>
    </form>
  );
}
