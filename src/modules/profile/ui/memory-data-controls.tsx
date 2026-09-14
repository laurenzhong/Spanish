"use client";

import { useEffect, useState } from "react";

type MemoryRecord = Readonly<{
  category: string;
  characterKey: string;
  content: string;
  createdAt: string;
  id: string;
  sensitivity: "normal" | "sensitive";
  shareScope: "private" | "explicit";
  status: "candidate" | "confirmed" | "rejected" | "conflict";
}>;

const characterNames: Record<string, string> = {
  ines: "Inés García",
  lucia: "Lucía",
  mateo: "Mateo Ruiz",
};

type MemoryDataControlsProps = Readonly<{
  onError?: () => void;
  retryToken?: number;
  showError?: boolean;
}>;

export function MemoryDataControls({ onError, retryToken = 0, showError = true }: MemoryDataControlsProps = {}) {
  const [memories, setMemories] = useState<readonly MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/profile/memories", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("MEMORIES_UNAVAILABLE");
        const payload = (await response.json()) as { data?: { memories?: MemoryRecord[] } };
        if (active) {
          setMemories(payload.data?.memories ?? []);
          setLoadError(false);
          setMessage(null);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          setMessage(showError ? "暂时无法读取你的关系记忆。" : null);
          onError?.();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reloadToken, retryToken]);

  async function remove(memory: MemoryRecord) {
    if (!window.confirm("删除后这条关系记忆和相关共享授权都无法恢复，确定删除吗？")) return;
    setBusy(memory.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/profile/memories?memoryId=${encodeURIComponent(memory.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("MEMORY_DELETE_FAILED");
      const payload = (await response.json()) as { data?: { deleted?: boolean } };
      if (!payload.data?.deleted) throw new Error("MEMORY_NOT_FOUND");
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setMessage("已删除这条关系记忆及其共享授权。");
    } catch {
      setMessage("暂时无法删除这条关系记忆，请稍后再试。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="privacy-permissions" aria-labelledby="memory-data-controls-title" data-testid="memory-data-controls">
      <header>
        <p className="eyebrow eyebrow--accent">隐私与数据</p>
        <h2 id="memory-data-controls-title">我的关系记忆</h2>
        <p>这些资料只用于你授权的角色关系。删除后会同时撤销相关共享，能力证据不会被删除。</p>
      </header>
      {loading ? <p className="surface-state__message">正在读取关系记忆……</p> : null}
      {!loading && loadError && showError ? <div className="profile-data-warning" role="alert"><span>关系记忆暂时不可用。</span><button type="button" onClick={() => { setLoading(true); setReloadToken((token) => token + 1); }}>重试</button></div> : null}
      {!loading && memories.length === 0 ? <p className="surface-state__message">目前没有保存的关系记忆。</p> : null}
      {memories.map((memory) => (
        <article className="privacy-permission-card" key={memory.id}>
          <div>
            <h3>{memory.content}</h3>
            <p>
              {characterNames[memory.characterKey] ?? memory.characterKey}
              {memory.shareScope === "explicit" ? " · 已明确共享给其他角色" : " · 仅当前角色可见"}
              {memory.sensitivity === "sensitive" ? " · 敏感资料" : ""}
            </p>
          </div>
          <button type="button" className="button--quiet" onClick={() => void remove(memory)} disabled={busy !== null}>
            {busy === memory.id ? "删除中…" : "删除记忆"}
          </button>
        </article>
      ))}
      {message ? <p className="surface-state__message" role="status">{message}</p> : null}
    </section>
  );
}
