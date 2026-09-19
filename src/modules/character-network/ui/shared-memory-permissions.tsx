"use client";

import { useEffect, useState } from "react";

type Permission = Readonly<{
  id: string;
  characterKey: string;
  targetCharacterKey?: string;
  category: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  alreadyShared: boolean;
}>;

const characterNames: Record<string, string> = {
  lucia: "Lucía",
  mateo: "Mateo Ruiz",
  ines: "Inés García",
};

type SharedMemoryPermissionsProps = Readonly<{
  onError?: () => void;
  retryToken?: number;
  showError?: boolean;
}>;

export function SharedMemoryPermissions({ onError, retryToken = 0, showError = true }: SharedMemoryPermissionsProps = {}) {
  const [permissions, setPermissions] = useState<readonly Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/character-network/permissions", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("PERMISSIONS_UNAVAILABLE");
        return response.json();
      })
      .then((payload: { data?: { permissions?: Permission[] } }) => {
        if (active) {
          setPermissions(payload.data?.permissions ?? []);
          setMessage(null);
        }
      })
      .catch(() => {
        if (active) {
          setPermissions([]);
          setLoadError(true);
          onError?.();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [onError, reloadToken, retryToken]);

  function retry() {
    setLoading(true);
    setLoadError(false);
    setReloadToken((token) => token + 1);
  }

  async function revoke(permission: Permission) {
    const targetCharacterKey = permission.targetCharacterKey;
    if (!targetCharacterKey) return;
    setBusy(permission.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/character-network/permissions/${encodeURIComponent(permission.id)}/${encodeURIComponent(targetCharacterKey)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("PERMISSION_REVOKE_FAILED");
      setPermissions((current) => current.filter((item) => !(item.id === permission.id && item.targetCharacterKey === targetCharacterKey)));
      setMessage("已撤销这条资料对该角色的共享。");
    } catch {
      setMessage("暂时无法撤销授权，请稍后再试。");
    } finally {
      setBusy(null);
    }
  }

  if (permissions.length === 0 && !message && !loading && !loadError) return null;

  return (
    <section className="privacy-permissions" aria-labelledby="privacy-permissions-title">
      <header>
        <p className="eyebrow eyebrow--accent">关系隐私</p>
        <h2 id="privacy-permissions-title">已授权给角色的资料</h2>
        <p>这里的授权只对指定角色生效。撤销后，原始记忆仍保留在你的账户中。</p>
      </header>
      {loading ? <p className="surface-state__message">正在读取授权资料……</p> : null}
      {!loading && loadError && showError ? (
        <div className="surface-state__message" role="alert">
          <p>暂时无法读取授权资料。</p>
          <button type="button" className="button--quiet" onClick={retry}>
            重试
          </button>
        </div>
      ) : null}
      {permissions.map((permission) => (
        <article className="privacy-permission-card" key={`${permission.id}:${permission.targetCharacterKey}`}>
          <div>
            <h3>{permission.content}</h3>
            <p>
              来源于 {characterNames[permission.characterKey] ?? permission.characterKey}，已分享给 {characterNames[permission.targetCharacterKey ?? ""] ?? permission.targetCharacterKey}
              {permission.sensitivity === "sensitive" ? " · 敏感资料" : ""}
            </p>
          </div>
          <button type="button" className="button--quiet" onClick={() => void revoke(permission)} disabled={busy !== null}>
            撤销授权
          </button>
        </article>
      ))}
      {message ? <p className="surface-state__message" role="status">{message}</p> : null}
    </section>
  );
}
