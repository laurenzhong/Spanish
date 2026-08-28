"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const presets = [
  ["sunlit-window", "日光窗边", "#d67d5d"],
  ["terracotta-scarf", "赤陶围巾", "#a95845"],
  ["green-notebook", "绿皮笔记", "#547466"],
  ["paper-collage", "纸张拼贴", "#b79870"],
  ["evening-studio", "夜间工作室", "#405d58"],
  ["quiet-cafe", "安静咖啡馆", "#9b775f"],
] as const;

type Profile = { displayName: string | null; publicUid: string; targetLanguage: string; avatar: { kind: "upload" | "preset" | "initials"; presetId: string | null; initials: string; colorIndex: number; url: string | null }; updatedAt: string };

export function ProfileEditor() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [avatarKind, setAvatarKind] = useState<"preset" | "initials">("initials");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/me", { cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const payload = await response.json() as { data?: Profile };
        if (!payload.data) throw new Error("invalid");
        setProfile(payload.data);
        setName(payload.data.displayName ?? "");
        setAvatarKind(payload.data.avatar.kind === "preset" ? "preset" : "initials");
        setPresetId(payload.data.avatar.presetId);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotice("账户资料暂时不可用，请检查网络后重试");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reloadToken]);

  const initials = useMemo(() => Array.from(name.trim())[0] ?? "你", [name]);

  async function save() {
    if (!profile) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/v1/me", { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json", "if-unmodified-since": profile.updatedAt }, body: JSON.stringify({ displayName: name, avatarKind, avatarPresetId: avatarKind === "preset" ? presetId : null }) });
      const payload = await response.json() as { data?: Profile; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "保存失败");
      setProfile(payload.data); setNotice("资料已保存");
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }

  return (
    <div className="profile-editor-page">
      <div className="profile-editor-page__back"><Link href="/me">← 返回我的进步</Link></div>
      <header className="profile-editor-page__header"><span className="eyebrow">账户资料</span><h1>让别人认出你</h1><p>头像和显示名只用于账户身份。学习证据、关系记忆和私密对话仍然独立保存。</p></header>
      {loading ? <div className="surface-state">正在读取账户资料…</div> : profile ? <>
        <section className="profile-editor-card">
          <div className="profile-editor-card__preview"><span className="account-avatar account-avatar--lg" aria-hidden="true">{initials}</span><div><strong>{name.trim() || "我的 Sueño"}</strong><small>{profile.targetLanguage === "es-ES" ? "西班牙语" : profile.targetLanguage}学习者 · {profile.publicUid}</small></div></div>
          <label className="profile-editor-field"><span>显示名</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="输入你的显示名" /></label>
        </section>
        <section className="profile-editor-card"><div className="profile-editor-card__title"><h2>选择头像</h2><p>你可以随时切换，不会影响 UID。</p></div>
          <div className="profile-editor-options"><button type="button" className={avatarKind === "initials" ? "is-selected" : ""} onClick={() => setAvatarKind("initials")}><span className="avatar-option avatar-option--initials">{initials}</span><span>首字母</span></button>{presets.map(([id, label, color]) => <button type="button" key={id} className={avatarKind === "preset" && presetId === id ? "is-selected" : ""} onClick={() => { setAvatarKind("preset"); setPresetId(id); }}><span className="avatar-option" style={{ background: color }}>{label.slice(0, 1)}</span><span>{label}</span></button>)}</div>
          <p className="profile-editor-hint">照片上传入口会在存储服务配置完成后开放；当前可先使用 Sueño 插画或首字母。</p>
        </section>
        <div className="profile-editor-actions"><Link href="/me" className="button button--quiet">取消</Link><button type="button" className="button button--primary" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存资料"}</button></div>
        {notice ? <p className="profile-editor-notice" role="status">{notice}</p> : null}
      </> : <div className="surface-state"><p>{notice ?? "账户资料暂时不可用"}</p><button type="button" className="button button--quiet" onClick={() => { setLoading(true); setReloadToken((value) => value + 1); }} disabled={loading}>{loading ? "正在重试…" : "重试读取"}</button></div>}
    </div>
  );
}
