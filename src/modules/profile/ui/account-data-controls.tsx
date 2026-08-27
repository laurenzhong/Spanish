"use client";

import { useEffect, useState } from "react";

type AccountDataSummary = Readonly<{
  conversations: number;
  evidenceEvents: number;
  practiceAttempts: number;
  relationshipMemories: number;
  savedAudio: number;
  savedTranscripts: number;
  sessions: number;
}>;

export function AccountDataControls() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<AccountDataSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/me/data", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("ACCOUNT_DATA_SUMMARY_UNAVAILABLE");
        const payload = (await response.json()) as { data?: AccountDataSummary };
        if (active && payload.data) {
          setSummary(payload.data);
          setSummaryError(false);
        }
      })
      .catch(() => {
        if (active) setSummaryError(true);
      })
      .finally(() => {
        if (active) setSummaryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  async function deleteData() {
    if (!window.confirm("这会删除你的训练、画像、对话、关系记忆和保存的语音资料，且无法恢复。确定继续吗？")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/me/data", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ confirmation: "DELETE_MY_DATA" }),
      });
      if (!response.ok) throw new Error("ACCOUNT_DATA_DELETE_FAILED");
      const payload = (await response.json()) as { data?: { cleanupDeferred?: number } };
      const deferred = payload.data?.cleanupDeferred ?? 0;
      setMessage(
        deferred > 0
          ? "账号数据已删除，部分语音对象将在清理服务恢复后重试。"
          : "账号数据已删除。",
      );
    } catch {
      setMessage("暂时无法删除账号数据，请稍后再试。没有确认成功前不会删除数据。 ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="privacy-permissions" aria-labelledby="account-data-controls-title" data-testid="account-data-controls">
      <header>
        <p className="eyebrow eyebrow--accent">账号数据</p>
        <h2 id="account-data-controls-title">删除我的账号数据</h2>
        <p>删除训练、画像、对话、关系记忆和保存的语音资料；共享内容和人物设定不受影响。</p>
        {summaryLoading ? <p className="surface-state__message">正在读取账号数据概览……</p> : null}
        {!summaryLoading && summaryError ? <div className="profile-data-warning" role="alert"><span>账号数据概览暂时不可用。</span><button type="button" onClick={() => { setSummaryLoading(true); setReloadToken((token) => token + 1); }}>重试</button></div> : null}
        {summary ? <p>当前包含 {summary.sessions} 次训练、{summary.conversations} 个对话、{summary.relationshipMemories} 条关系记忆和 {summary.savedAudio + summary.savedTranscripts} 条保存的语音资料。</p> : null}
      </header>
      <button type="button" className="button--quiet" onClick={() => void deleteData()} disabled={busy}>
        {busy ? "删除中…" : "删除账号数据"}
      </button>
      {message ? <p className="surface-state__message" role="status">{message}</p> : null}
    </section>
  );
}
