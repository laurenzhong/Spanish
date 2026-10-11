"use client";

import { useEffect, useState } from "react";

import { ConfirmActionDialog } from "@/src/shared/ui/confirm-action-dialog";

type SavedAudio = Readonly<{
  createdAt: string;
  durationMs: number | null;
  id: string;
  mimeType: string;
  purpose: string;
  retentionPolicy: string;
  sizeBytes: number;
}>;

type SavedTranscript = Readonly<{
  attemptId: string;
  createdAt: string;
  text: string;
}>;

type VoiceData = Readonly<{
  audio: readonly SavedAudio[];
  transcripts: readonly SavedTranscript[];
}>;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "时长未知";
  return `${Math.max(1, Math.round(durationMs / 1000))} 秒`;
}

type VoiceDataControlsProps = Readonly<{
  onError?: () => void;
  retryToken?: number;
  showError?: boolean;
}>;

export function VoiceDataControls({ onError, retryToken = 0, showError = true }: VoiceDataControlsProps = {}) {
  const [data, setData] = useState<VoiceData>({ audio: [], transcripts: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/profile/media", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("VOICE_DATA_UNAVAILABLE");
        const payload = (await response.json()) as { data?: VoiceData };
        if (active) {
          setData({
            audio: payload.data?.audio ?? [],
            transcripts: payload.data?.transcripts ?? [],
          });
          setLoadError(false);
          setMessage(null);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          setMessage(showError ? "暂时无法读取已保存的语音资料。" : null);
          onError?.();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [onError, reloadToken, retryToken, showError]);

  async function remove(kind: "audio" | "transcript", id: string): Promise<boolean> {
    const label = kind === "audio" ? "这段录音" : "这条转写";
    const key = `${kind}:${id}`;
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/profile/media?kind=${kind}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("VOICE_DATA_DELETE_FAILED");
      const payload = (await response.json()) as { data?: { deleted?: boolean } };
      if (!payload.data?.deleted) throw new Error("VOICE_DATA_NOT_FOUND");
      setData((current) => kind === "audio"
        ? { ...current, audio: current.audio.filter((item) => item.id !== id) }
        : { ...current, transcripts: current.transcripts.filter((item) => item.attemptId !== id) });
      setMessage(`已删除${label}。`);
      return true;
    } catch {
      // The dialog owns the failure copy; no partial success is shown on the page.
      return false;
    } finally {
      setBusy(null);
    }
  }

  const hasData = data.audio.length > 0 || data.transcripts.length > 0;

  return (
    <section className="privacy-permissions" aria-labelledby="voice-data-controls-title" data-testid="voice-data-controls">
      <header>
        <p className="eyebrow eyebrow--accent">语音隐私</p>
        <h2 id="voice-data-controls-title">已保存的录音与转写</h2>
        <p>普通练习录音不会出现在这里；这里的删除只影响原始语音资料，不删除能力证据。</p>
      </header>
      {loading ? <p className="surface-state__message">正在读取语音资料……</p> : null}
      {!loading && loadError && showError ? <div className="profile-data-warning" role="alert"><span>已保存的语音资料暂时不可用。</span><button type="button" onClick={() => { setLoading(true); setReloadToken((token) => token + 1); }}>重试</button></div> : null}
      {!loading && !hasData ? <p className="surface-state__message">目前没有已保存的录音或转写。</p> : null}
      {data.audio.map((audio) => (
        <article className="privacy-permission-card" key={`audio:${audio.id}`}>
          <div>
            <h3>录音 · {formatDate(audio.createdAt)}</h3>
            <p>{audio.mimeType} · {formatDuration(audio.durationMs)} · {audio.retentionPolicy}</p>
          </div>
          <ConfirmActionDialog
            confirmLabel="确认删除录音"
            description="删除后这段录音无法恢复；能力证据不会被删除。"
            failureMessage="暂时无法删除这段录音，请稍后再试。"
            onConfirm={() => remove("audio", audio.id)}
            title="删除这段录音？"
            trigger={<button type="button" className="button--quiet" disabled={busy !== null}>删除录音</button>}
          />
        </article>
      ))}
      {data.transcripts.map((transcript) => (
        <article className="privacy-permission-card" key={`transcript:${transcript.attemptId}`}>
          <div>
            <h3>{transcript.text}</h3>
            <p>语音转写 · {formatDate(transcript.createdAt)}</p>
          </div>
          <ConfirmActionDialog
            confirmLabel="确认删除转写"
            description="删除后这条转写无法恢复；能力证据不会被删除。"
            failureMessage="暂时无法删除这条转写，请稍后再试。"
            onConfirm={() => remove("transcript", transcript.attemptId)}
            title="删除这条转写？"
            trigger={<button type="button" className="button--quiet" disabled={busy !== null}>删除转写</button>}
          />
        </article>
      ))}
      {message ? <p className="surface-state__message" role="status">{message}</p> : null}
    </section>
  );
}
