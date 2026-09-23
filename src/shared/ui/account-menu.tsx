"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/src/shared/auth/browser";
import { ThemeToggle } from "./theme-toggle";
import { loadAccountProfile, type AccountProfileDto } from "./account-profile-cache";

const avatarPresetColors: Record<string, string> = {
  "sunlit-window": "#d67d5d",
  "terracotta-scarf": "#a95845",
  "green-notebook": "#547466",
  "paper-collage": "#b79870",
  "evening-studio": "#405d58",
  "quiet-cafe": "#9b775f",
};

function Avatar({ profile, size = "sm" }: Readonly<{ profile: AccountProfileDto | null; size?: "sm" | "lg" }>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = profile ? { "--avatar-index": profile.avatar.colorIndex, ...(profile.avatar.kind === "preset" && profile.avatar.presetId && avatarPresetColors[profile.avatar.presetId] ? { backgroundColor: avatarPresetColors[profile.avatar.presetId] } : {}) } as React.CSSProperties : undefined;
  const imageFailed = Boolean(profile?.avatar.url && failedUrl === profile.avatar.url);
  // eslint-disable-next-line @next/next/no-img-element
  if (profile?.avatar.url && !imageFailed) return <img className={`account-avatar account-avatar--${size}`} src={profile.avatar.url} alt="账户头像" style={{ ...style, objectFit: "cover" }} onError={() => setFailedUrl(profile.avatar.url)} />;
  return <span className={`account-avatar account-avatar--${size}`} aria-hidden="true" style={style}>{profile?.avatar.initials ?? "你"}</span>;
}

export function AccountMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<AccountProfileDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  useEffect(() => {
    const refreshProfile = () => {
      void loadAccountProfile()
        .then((nextProfile) => {
          setProfile(nextProfile);
          setNotice(null);
        })
        .catch(() => setNotice("账户资料暂时不可用"));
    };
    refreshProfile();
    window.addEventListener("account-profile-updated", refreshProfile);
    return () => window.removeEventListener("account-profile-updated", refreshProfile);
  }, []);

  async function copyUid() {
    if (!profile?.publicUid) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(profile.publicUid);
      } else {
        const input = document.createElement("textarea");
        input.value = profile.publicUid;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("copy-failed");
      }
      setNotice("UID 已复制");
    } catch { setNotice("复制失败，请手动选择 UID"); }
  }

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    setNotice(null);
    try {
      const client = createSupabaseBrowserClient();
      if (client) {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      }
      window.dispatchEvent(new Event("account-signed-out"));
      setOpen(false);
      router.replace("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
      setNotice("退出失败，请检查网络后重试");
    }
  }

  const displayName = profile?.displayName?.trim() || "我的 Sueño";
  const language = profile?.targetLanguage === "es-ES" ? "西班牙语" : profile?.targetLanguage ?? "西班牙语";

  return (
    <div className="account-menu" ref={menuRef}>
      <button className="account-menu__trigger" type="button" aria-expanded={open} aria-haspopup="menu" aria-label="打开账户菜单" onClick={() => setOpen((current) => !current)}>
        <Avatar profile={profile} />
      </button>
      {open ? (
        <div className="account-menu__popover" role="menu" aria-label="账户菜单">
          <div className="account-menu__identity">
            <div className="account-menu__identity-head"><Avatar profile={profile} size="lg" /><div><span className="eyebrow">当前账户</span><strong>{displayName}</strong><small>{language}学习者</small></div></div>
              <div className="account-menu__uid"><span><small>公开 UID</small><code>{profile?.publicUid ?? (notice ? "暂不可用" : "读取中…")}</code></span><button type="button" onClick={copyUid} disabled={!profile?.publicUid} aria-label="复制公开 UID">复制</button></div>
            {notice ? <p className="account-menu__notice" role="status">{notice}</p> : null}
          </div>
          <Link href="/me/profile" role="menuitem" onClick={() => setOpen(false)}>编辑个人资料 <span aria-hidden="true">↗</span></Link>
          <Link href="/me" role="menuitem" onClick={() => setOpen(false)}>我的进步与隐私 <span aria-hidden="true">↗</span></Link>
          <Link href="/me#preferences" role="menuitem" onClick={() => setOpen(false)}>偏好设置 <span aria-hidden="true">↗</span></Link>
          <Link href="/help" role="menuitem" onClick={() => setOpen(false)}>帮助与反馈 <span aria-hidden="true">↗</span></Link>
          <div className="account-menu__divider" />
          <ThemeToggle />
          <button className="account-menu__logout" type="button" role="menuitem" onClick={() => void signOut()} disabled={loggingOut}>{loggingOut ? "正在退出…" : "退出登录"}</button>
        </div>
      ) : null}
    </div>
  );
}
