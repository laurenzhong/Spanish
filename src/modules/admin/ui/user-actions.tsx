"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminUserSummaryDto } from "../schemas/admin-console";
import { AdminReasonDialog } from "./admin-reason-dialog";
import { sendAdminWrite } from "./admin-write-client";
import { AdminIcon } from "./admin-icons";
import { AdminPanel } from "./admin-primitives";

type AdminUserActionsProps = Readonly<{
  user: AdminUserSummaryDto;
}>;

/**
 * Limited management actions for one account (`/admin/users/[publicUid]`).
 *
 * Only account state changes live here: suspend/restore and deletion. Every
 * action requires an audited reason, uses the shared same-origin write client
 * and only refreshes the page after the server confirms the new state. Deleting
 * navigates back to the list, because the detail URL no longer resolves.
 */
export function AdminUserActions({ user }: AdminUserActionsProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const statusPath = `/api/v1/admin/users/${encodeURIComponent(user.publicUid)}/status`;
  const deletionPath = `/api/v1/admin/users/${encodeURIComponent(user.publicUid)}/deletion`;

  async function changeStatus(
    status: "active" | "suspended",
    reason: string,
  ): Promise<{ ok: boolean; message: string }> {
    const result = await sendAdminWrite({
      path: statusPath,
      method: "PATCH",
      body: { status, reason },
      fallbackMessage:
        status === "suspended"
          ? "停用未完成，账号状态没有改变。"
          : "恢复未完成，账号仍保持原状态。",
    });
    if (!result.ok) return result;
    router.refresh();
    return {
      ok: true,
      message:
        status === "suspended"
          ? "账号已停用：服务端访问已立即阻断，并已尝试封禁登录。"
          : "账号已恢复为正常状态。",
    };
  }

  async function deleteAccount(reason: string): Promise<{ ok: boolean; message: string }> {
    const result = await sendAdminWrite({
      path: deletionPath,
      method: "POST",
      body: {
        confirmation: `DELETE ${user.publicUid}`,
        reason,
      },
      idempotency: true,
      fallbackMessage: "注销未完成，账号仍保留可重试的注销标记。",
    });
    if (!result.ok) return result;
    const alreadyDeleted =
      typeof result.data === "object" &&
      result.data !== null &&
      (result.data as { alreadyDeleted?: unknown }).alreadyDeleted === true;
    router.replace("/admin/users");
    router.refresh();
    return {
      ok: true,
      message: alreadyDeleted
        ? "该账号此前已完成注销，本次确认后跳回用户列表。"
        : "账号已注销：业务数据与登录账号已删除。",
    };
  }

  return (
    <AdminPanel
      description="每个动作都必须填写原因并写入追加式审计；停用立即阻断服务端访问，但不能核对用户设备上的已缓存页面。"
      id="admin-user-actions"
      kicker="受限管理动作"
      title="停用、恢复与注销"
      tone="danger"
    >
      <p className="admin-note" data-tone="warning">
        <AdminIcon name="lock" /> 停用会立即阻断服务端访问；注销无法恢复。两个动作都会写入追加式审计。
        {user.deletionPending ? " 该账号已发起注销但尚未完成，可以重试注销。" : ""}
      </p>

      <div className="admin-danger-actions">
        <div className="admin-actions">
          {user.accountStatus === "active" ? (
            <AdminReasonDialog
              confirmLabel="确认停用账号"
              danger
              description={`停用 ${user.publicUid} 后，该账号的所有页面与 API 请求会立即被服务端拒绝，并尝试封禁登录。操作会写入审计。`}
              onConfirm={(reason) => changeStatus("suspended", reason)}
              onSuccess={setNotice}
              reasonPlaceholder="例如：用户要求暂停使用 / 安全检查"
              title="停用这个账号？"
              trigger={
                <button className="admin-button admin-button--danger" type="button">
                  停用账号
                </button>
              }
            />
          ) : (
            <AdminReasonDialog
              confirmLabel="确认恢复账号"
              description={`恢复 ${user.publicUid} 后，该账号可以重新通过 OTP 登录并使用产品。操作会写入审计。`}
              onConfirm={(reason) => changeStatus("active", reason)}
              onSuccess={setNotice}
              reasonPlaceholder="例如：用户确认可以恢复使用"
              title="恢复这个账号？"
              trigger={
                <button className="admin-button admin-button--primary" type="button">
                  恢复账号
                </button>
              }
            />
          )}
        </div>

        <hr className="admin-divider" />

        <div className="admin-actions">
          <AdminReasonDialog
            confirmationLabel={`输入公开 UID ${user.publicUid} 以确认`}
            confirmationPhrase={user.publicUid}
            confirmLabel="确认注销账号"
            danger
            description={`注销 ${user.publicUid} 会删除学习数据与登录账号，无法恢复。失败时保留“注销未完成”标记以便重试。操作会写入审计。`}
            onConfirm={deleteAccount}
            onSuccess={setNotice}
            reasonPlaceholder="例如：用户通过线下渠道确认注销"
            title="注销这个账号？"
            trigger={
              <button className="admin-button admin-button--danger" type="button">
                注销账号
              </button>
            }
          />
        </div>
      </div>

      {user.role === "owner" ? (
        <p className="admin-note" role="note">
          该账号是所有者。服务端会拒绝停用或注销最后一名所有者，也可能因此返回冲突错误。
        </p>
      ) : null}

      {notice ? (
        <p className="admin-notice admin-notice--success" role="status">
          {notice}
        </p>
      ) : null}
    </AdminPanel>
  );
}
