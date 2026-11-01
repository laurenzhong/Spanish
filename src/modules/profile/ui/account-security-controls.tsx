"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/src/shared/auth/browser";
import { readSupabasePublicConfig } from "@/src/shared/auth/config";
import { ConfirmActionDialog } from "@/src/shared/ui/confirm-action-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/shared/ui/primitives";

const EXPORT_ENDPOINT = "/api/v1/me/export";
const EXPORT_FILENAME = "sueno-account-export.json";
const ACCOUNT_DELETION_PHRASE = "DELETE MY ACCOUNT";
const ACCOUNT_DELETION_CONFIRMATION = "DELETE_MY_ACCOUNT";

const EXPORT_UNAVAILABLE_MESSAGE = "数据导出暂时不可用，请稍后重试。";
const EXPORT_SESSION_EXPIRED_MESSAGE = "登录状态已失效，请重新登录后再导出。";
const SIGN_OUT_FAILURE_MESSAGE = "退出全部设备未完成，请检查网络后重试。";
const SIGN_OUT_NOT_CONFIGURED_MESSAGE =
  "当前环境尚未配置 Supabase Auth，无法退出全部设备。";
const DELETE_UNAVAILABLE_MESSAGE =
  "注销暂时未完成，账号和数据没有删除。请稍后重试。";
const DELETE_SESSION_EXPIRED_MESSAGE =
  "登录状态已失效，请重新登录后再试。账号和数据没有删除。";

type AccountSecurityDto = Readonly<{
  role?: "owner" | "member";
  accountStatus?: "active" | "suspended";
}>;

type AccountSecurityControlsProps = Readonly<{
  onError?: () => void;
  retryToken?: number;
  showError?: boolean;
}>;

function readFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="?([^";]+)"?/iu.exec(contentDisposition);
  const candidate = match?.[1]?.trim();
  if (!candidate) return null;
  // The download attribute is not a path, but keep the suggestion to characters
  // every supported browser treats as a plain filename.
  const safe = candidate.replace(/[\\/:*?"<>|]/gu, "").trim();
  return safe.length > 0 ? safe : null;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

function deletionFailureMessage(status: number): string {
  return status === 401 ? DELETE_SESSION_EXPIRED_MESSAGE : DELETE_UNAVAILABLE_MESSAGE;
}

/**
 * Account self-service for `/me` (ACCT-ADMIN-001 design §6.2):
 * read-only role/status, data export, global sign-out and full account deletion.
 *
 * The full deletion is the one irreversible action, so it uses the shared
 * UI-SYSTEM-002 confirmation pattern with a typed phrase. The learning-data
 * deletion and Lucía reset in `account-data-controls.tsx` are unchanged.
 */
export function AccountSecurityControls({
  onError,
  retryToken = 0,
  showError = true,
}: AccountSecurityControlsProps = {}) {
  const router = useRouter();
  const deletionPhraseId = useId();
  const [account, setAccount] = useState<AccountSecurityDto | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionPhrase, setDeletionPhrase] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const authConfigured = readSupabasePublicConfig() !== null;
  const deletionPhraseConfirmed =
    deletionPhrase.trim() === ACCOUNT_DELETION_PHRASE;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    void fetch("/api/v1/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("ACCOUNT_SECURITY_UNAVAILABLE");
        const payload = (await response.json()) as { data?: AccountSecurityDto };
        if (active) {
          setAccount(payload.data ?? null);
          setAccountError(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setAccountError(true);
        onError?.();
      })
      .finally(() => {
        if (active) {
          setAccountLoading(false);
          window.clearTimeout(timeout);
        }
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [onError, reloadToken, retryToken]);

  function retryAccountSummary() {
    setAccountLoading(true);
    setAccountError(false);
    setReloadToken((token) => token + 1);
  }

  async function exportAccountData() {
    if (exporting) return;
    setExporting(true);
    setExportMessage(null);
    setExportError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(EXPORT_ENDPOINT, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        setExportError(
          response.status === 401
            ? EXPORT_SESSION_EXPIRED_MESSAGE
            : EXPORT_UNAVAILABLE_MESSAGE,
        );
        return;
      }
      const blob = await response.blob();
      // The content is downloaded as-is: never parse or print the export JSON.
      saveBlob(
        blob,
        readFilename(response.headers.get("content-disposition")) ??
          EXPORT_FILENAME,
      );
      setExportMessage("数据导出已开始下载。");
    } catch {
      setExportError(EXPORT_UNAVAILABLE_MESSAGE);
    } finally {
      window.clearTimeout(timeout);
      setExporting(false);
    }
  }

  async function signOutEverywhere(): Promise<boolean> {
    setSignOutNotice(null);
    const client = createSupabaseBrowserClient();
    if (!client) {
      setSignOutNotice(SIGN_OUT_NOT_CONFIGURED_MESSAGE);
      return false;
    }
    try {
      const { error } = await client.auth.signOut({ scope: "global" });
      if (error) throw error;
      window.dispatchEvent(new Event("account-signed-out"));
      router.replace("/login");
      router.refresh();
      return true;
    } catch {
      setSignOutNotice(SIGN_OUT_FAILURE_MESSAGE);
      return false;
    }
  }

  async function confirmAccountDeletion() {
    if (deleting || !deletionPhraseConfirmed) return;
    setDeleting(true);
    setDeletionError(null);
    try {
      const response = await fetch("/api/v1/me/account", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION }),
      });
      if (!response.ok) {
        setDeletionError(deletionFailureMessage(response.status));
        return;
      }
      const client = createSupabaseBrowserClient();
      try {
        await client?.auth.signOut({ scope: "local" });
      } catch {
        // The server already deleted the account; local cookie cleanup is a
        // best-effort convenience and the account gate blocks any stale session.
      }
      window.dispatchEvent(new Event("account-signed-out"));
      setDeletionOpen(false);
      router.replace("/login");
      router.refresh();
    } catch {
      setDeletionError(DELETE_UNAVAILABLE_MESSAGE);
    } finally {
      setDeleting(false);
    }
  }

  const roleLabel =
    account?.role === "owner"
      ? "所有者"
      : account?.role === "member"
        ? "普通用户"
        : "读取中…";
  const statusLabel =
    account?.accountStatus === "suspended"
      ? "已停用"
      : account?.accountStatus === "active"
        ? "正常"
        : "读取中…";

  return (
    <section
      className="privacy-permissions account-security"
      aria-labelledby="account-security-title"
      data-testid="account-security-controls"
    >
      <header>
        <p className="eyebrow eyebrow--accent">账号与安全</p>
        <h2 id="account-security-title">账号角色、数据导出与登录会话</h2>
        <p>
          查看账号角色与状态，导出自己的数据；也可以退出所有设备或完整注销账号。这些操作不会改变学习证据。
        </p>
      </header>

      <dl className="account-security__facts" data-testid="account-security-facts">
        <div>
          <dt>账号角色</dt>
          <dd>{accountLoading && !account ? "读取中…" : roleLabel}</dd>
        </div>
        <div>
          <dt>账号状态</dt>
          <dd>{accountLoading && !account ? "读取中…" : statusLabel}</dd>
        </div>
      </dl>
      {accountLoading ? <p className="surface-state__message">正在读取账号信息……</p> : null}
      {!accountLoading && accountError && showError ? (
        <div className="profile-data-warning" role="alert">
          <span>账号信息暂时不可用。</span>
          <button type="button" onClick={retryAccountSummary}>重试</button>
        </div>
      ) : null}

      <div className="account-security__action">
        <div>
          <h3>导出我的数据</h3>
          <p>下载包含账号资料、偏好、学习记录、收藏和对话文本的 JSON 文件。导出不会修改任何数据。</p>
        </div>
        <button
          className="button--quiet account-security__button"
          disabled={exporting}
          type="button"
          onClick={() => void exportAccountData()}
        >
          {exporting ? "正在准备导出…" : "导出我的数据"}
        </button>
      </div>
      {exportMessage ? <p className="surface-state__message" role="status">{exportMessage}</p> : null}
      {exportError ? (
        <div className="profile-data-warning" role="alert">
          <span>{exportError}</span>
          {!exporting ? <button type="button" onClick={() => void exportAccountData()}>重试</button> : null}
        </div>
      ) : null}

      <div className="account-security__action">
        <div>
          <h3>退出全部设备</h3>
          <p>
            撤销这台账号在其他设备上的登录会话。已经签发的访问令牌在到期前（最长约 1 小时）仍可能有效，因此危险操作还会由服务端立即拦截。
          </p>
          {!authConfigured ? (
            <p className="account-security__hint">当前环境尚未配置 Supabase Auth，此操作不可用。</p>
          ) : null}
        </div>
        <ConfirmActionDialog
          confirmLabel="退出全部设备"
          description="这会撤销其他设备上的登录会话，并让当前浏览器回到登录页。未同步的本地草稿可能丢失。"
          failureMessage={
            authConfigured ? SIGN_OUT_FAILURE_MESSAGE : SIGN_OUT_NOT_CONFIGURED_MESSAGE
          }
          onConfirm={signOutEverywhere}
          title="退出全部设备？"
          trigger={
            <button className="button--quiet account-security__button" disabled={!authConfigured} type="button">
              退出全部设备
            </button>
          }
        />
      </div>
      {signOutNotice ? <p className="auth-error" role="alert">{signOutNotice}</p> : null}

      <div className="account-security__action account-security__action--danger">
        <div>
          <h3>注销账号</h3>
          <p>
            这会删除账号与学习数据，<strong>不可恢复</strong>。公共内容和人物设定不受影响。
          </p>
        </div>
        <AlertDialog
          open={deletionOpen}
          onOpenChange={(nextOpen) => {
            if (deleting) return;
            setDeletionOpen(nextOpen);
            if (!nextOpen) {
              setDeletionPhrase("");
              setDeletionError(null);
            }
          }}
        >
          <AlertDialogTrigger>
            <button className="account-security__danger-button" type="button">注销账号</button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>注销我的账号？</AlertDialogTitle>
            <AlertDialogDescription>
              会删除账号与学习数据，且无法恢复。请输入 DELETE MY ACCOUNT 以确认。
            </AlertDialogDescription>
            <form
              className="account-security__deletion-form"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmAccountDeletion();
              }}
            >
              <label htmlFor={deletionPhraseId}>确认短语</label>
              <input
                autoComplete="off"
                disabled={deleting}
                id={deletionPhraseId}
                onChange={(event) => setDeletionPhrase(event.target.value)}
                placeholder="DELETE MY ACCOUNT"
                spellCheck={false}
                value={deletionPhrase}
              />
              {deletionError ? (
                <p className="sueno-alert-dialog-error" role="alert">{deletionError}</p>
              ) : null}
              <div className="sueno-alert-dialog-actions">
                <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting || !deletionPhraseConfirmed}
                  onClick={(event) => {
                    event.preventDefault();
                    void confirmAccountDeletion();
                  }}
                >
                  {deleting ? "正在注销…" : "永久注销账号"}
                </AlertDialogAction>
              </div>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}
