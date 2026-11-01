"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { InvitationSummaryDto } from "@/src/modules/account/schemas/invitation";
import type { AdminInvitationsFilterState } from "./admin-query";
import { buildAdminInvitationsHref } from "./admin-query";
import {
  ADMIN_INVITATION_STATUS_LABELS,
  ADMIN_ROLE_LABELS,
  formatAdminDateTime,
} from "./format";
import { AdminReasonDialog } from "./admin-reason-dialog";
import { sendAdminWrite } from "./admin-write-client";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminCode,
  AdminEmpty,
  AdminFilterChips,
  AdminPanel,
  AdminTable,
  type AdminFilterChip,
  type AdminTone,
} from "./admin-primitives";

/* -------------------------------------------------------------------------- */
/* Create invitation                                                          */
/* -------------------------------------------------------------------------- */

type CreateInvitationResponse = Readonly<{
  invitation: InvitationSummaryDto;
  code: string;
}>;

type AdminInvitationCreateFormProps = Readonly<{
  /** Mirrors ACCOUNT_INVITATIONS_ENABLED; the API is fail-closed regardless. */
  registrationEnabled: boolean;
}>;

/**
 * Create one single-use invitation. The API returns the plaintext code exactly
 * once and stores only its hash; the form therefore renders the code in a
 * one-time block that disappears on a full reload (never in the URL, never in
 * a log). The list is refreshed after creation, but the code block is state, so
 * a `router.refresh()` keeps it visible.
 */
export function AdminInvitationCreateForm({
  registrationEnabled,
}: AdminInvitationCreateFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [expiresInHours, setExpiresInHours] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateInvitationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setCopied(false);
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmedEmail)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    let hours: number | undefined;
    if (expiresInHours.trim() !== "") {
      const parsed = Number(expiresInHours);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
        setError("有效期必须是 1–720 之间的整数小时。");
        return;
      }
      hours = parsed;
    }
    if (notes.trim().length > 500) {
      setError("备注不能超过 500 字。");
      return;
    }

    setPending(true);
    try {
      const result = await sendAdminWrite({
        path: "/api/v1/admin/invitations",
        method: "POST",
        body: {
          email: trimmedEmail,
          role,
          ...(hours === undefined ? {} : { expiresInHours: hours }),
          ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
        },
        fallbackMessage: "邀请未创建。请检查邮箱与输入后重试。",
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const data = result.data as CreateInvitationResponse | null;
      if (!data || typeof data.code !== "string") {
        setError("邀请响应缺少一次性邀请码，请刷新列表核对后再重试。");
        return;
      }
      setCreated(data);
      setEmail("");
      setNotes("");
      setExpiresInHours("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function copyCode() {
    if (!created) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(created.code);
      } else {
        const input = document.createElement("textarea");
        input.value = created.code;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copiedByBrowser = document.execCommand("copy");
        input.remove();
        if (!copiedByBrowser) throw new Error("copy-failed");
      }
      setCopied(true);
    } catch {
      setCopied(false);
      setError("复制失败，请手动选择邀请码。");
    }
  }

  return (
    <AdminPanel
      aside={
        <AdminBadge dot tone={registrationEnabled ? "positive" : "warning"}>
          {registrationEnabled ? "邀请注册已开启" : "邀请注册已关闭"}
        </AdminBadge>
      }
      description="邀请码只显示一次；请线下分享给被邀请人。邀请邮箱必须与兑换邮箱一致，默认有效期 7 天。"
      hero
      id="admin-invitation-create"
      kicker="邀请注册"
      title="创建一次性邀请"
    >
      {!registrationEnabled ? (
        <p className="admin-note" data-tone="warning" role="note">
          邀请注册开关当前关闭（<code>ACCOUNT_INVITATIONS_ENABLED=0</code>）。创建请求会被服务端拒绝，
          请先由运行手册显式开启。
        </p>
      ) : null}

      <form
        aria-label="创建邀请"
        className="admin-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="admin-form__row">
          <label htmlFor="admin-invitation-email">邮箱（必填）</label>
          <input
            autoComplete="off"
            disabled={pending}
            id="admin-invitation-email"
            maxLength={320}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            required
            type="email"
            value={email}
          />
        </div>
        <div className="admin-form__grid">
          <div className="admin-form__row">
            <label htmlFor="admin-invitation-role">角色</label>
            <select
              disabled={pending}
              id="admin-invitation-role"
              onChange={(event) => setRole(event.target.value === "owner" ? "owner" : "member")}
              value={role}
            >
              <option value="member">成员</option>
              <option value="owner">所有者</option>
            </select>
          </div>
          <div className="admin-form__row">
            <label htmlFor="admin-invitation-expires">有效期（小时，可选 1–720）</label>
            <input
              disabled={pending}
              id="admin-invitation-expires"
              inputMode="numeric"
              max={720}
              min={1}
              onChange={(event) => setExpiresInHours(event.target.value)}
              placeholder="默认 168"
              type="number"
              value={expiresInHours}
            />
          </div>
        </div>
        <div className="admin-form__row">
          <label htmlFor="admin-invitation-notes">备注（可选，最多 500 字）</label>
          <textarea
            disabled={pending}
            id="admin-invitation-notes"
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            value={notes}
          />
        </div>
        <div className="admin-actions">
          <button
            className="admin-button admin-button--primary"
            disabled={pending || !registrationEnabled}
            type="submit"
          >
            {pending ? "正在创建…" : "创建邀请"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="admin-notice admin-notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {created ? (
        <div className="admin-once-code">
          <div>
            <p className="admin-kicker">一次性邀请码</p>
            <AdminCode>{created.code}</AdminCode>
            <p className="admin-muted">
              仅显示这一次，刷新页面后不再显示；数据库只保存哈希。邮箱{" "}
              {created.invitation.emailMasked}。
            </p>
          </div>
          <button className="admin-button" onClick={() => void copyCode()} type="button">
            <AdminIcon name="copy" />
            复制邀请码
          </button>
          {copied ? (
            <p className="admin-muted" role="status">
              邀请码已复制。
            </p>
          ) : null}
        </div>
      ) : null}
    </AdminPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* Invitation list + revoke                                                   */
/* -------------------------------------------------------------------------- */

type AdminInvitationListProps = Readonly<{
  invitations: readonly InvitationSummaryDto[];
  filters: AdminInvitationsFilterState;
  nextHref: string | null;
  firstPageHref: string;
  resetHref: string;
}>;

function invitationTone(status: InvitationSummaryDto["status"]): AdminTone {
  if (status === "accepted") return "positive";
  if (status === "pending" || status === "redeeming") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

export function AdminInvitationList({
  invitations,
  filters,
  nextHref,
  firstPageHref,
  resetHref,
}: AdminInvitationListProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const appliedChips: AdminFilterChip[] = [];
  if (filters.status) {
    appliedChips.push({
      label: `状态：${ADMIN_INVITATION_STATUS_LABELS[filters.status]}`,
      removeHref: buildAdminInvitationsHref(filters, { status: null, cursor: null }),
    });
  }
  const filtered = appliedChips.length > 0;

  async function revoke(
    invitation: InvitationSummaryDto,
    reason: string,
  ): Promise<{ ok: boolean; message: string }> {
    const result = await sendAdminWrite({
      path: `/api/v1/admin/invitations/${encodeURIComponent(invitation.id)}/revoke`,
      method: "POST",
      body: { reason },
      fallbackMessage: "撤销未完成，邀请状态没有改变。",
    });
    if (!result.ok) return result;
    router.refresh();
    return { ok: true, message: `已撤销 ${invitation.emailMasked} 的邀请。` };
  }

  return (
    <>
      <div>
        <form
          action="/admin/invitations"
          aria-label="筛选邀请"
          className="admin-toolbar"
          method="get"
        >
          <div className="admin-toolbar__fields">
            <div className="admin-field">
              <label htmlFor="admin-invitations-status">邀请状态</label>
              <select
                defaultValue={filters.status ?? ""}
                id="admin-invitations-status"
                name="status"
              >
                <option value="">全部状态</option>
                {Object.entries(ADMIN_INVITATION_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <input name="limit" type="hidden" value={filters.limit} />
          <div className="admin-actions">
            <button className="admin-button admin-button--primary" type="submit">
              <AdminIcon name="filter" />
              筛选
            </button>
            <a className="admin-button" href={resetHref}>
              清除筛选
            </a>
          </div>
        </form>
        <AdminFilterChips clearHref={filtered ? resetHref : undefined} items={appliedChips} />
      </div>

      <AdminPanel
        aside={
          <AdminBadge className="admin-badge--count">本页 {invitations.length} 条</AdminBadge>
        }
        description="邮箱只以掩码展示；待兑换的邀请可以撤销，撤销需要填写原因并写入审计。"
        flush={invitations.length > 0}
        id="admin-invitation-list"
        kicker="邀请记录"
        title="邀请列表"
      >
        {invitations.length === 0 && !filtered ? (
          <AdminEmpty
            description="创建一次性邀请后，把邀请码线下分享给被邀请人。创建表单在本页上方。"
            icon="invitations"
            title="还没有创建过邀请"
          />
        ) : (
            <AdminTable
              caption="邀请列表"
              tall
              head={
            <tr>
              <th scope="col">邮箱（掩码）</th>
              <th scope="col">角色</th>
              <th scope="col">状态</th>
              <th scope="col">创建时间</th>
              <th scope="col">过期时间</th>
              <th scope="col">接受时间</th>
              <th scope="col">操作</th>
            </tr>
          }
        >
          {invitations.length === 0 ? (
            <tr className="admin-table__empty-row">
              <td colSpan={7}>
                <div className="admin-table__empty-content">
                  <p>当前筛选条件下没有邀请记录。</p>
                  <a className="admin-button admin-button--small" href={resetHref}>
                    清除筛选
                  </a>
                </div>
              </td>
            </tr>
          ) : (
            invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="admin-table__title" data-label="邮箱（掩码）">
                  <AdminCode>{invitation.emailMasked}</AdminCode>
                </td>
                <td data-label="角色">
                  <AdminBadge className="admin-badge--role">
                    {ADMIN_ROLE_LABELS[invitation.role]}
                  </AdminBadge>
                </td>
                <td data-label="状态">
                  <AdminBadge dot tone={invitationTone(invitation.status)}>
                    {ADMIN_INVITATION_STATUS_LABELS[invitation.status]}
                  </AdminBadge>
                  {invitation.failureCode ? (
                    <span className="admin-muted"> · {invitation.failureCode}</span>
                  ) : null}
                </td>
                <td className="admin-nowrap" data-label="创建时间">
                  {formatAdminDateTime(invitation.createdAt)}
                </td>
                <td className="admin-nowrap" data-label="过期时间">
                  {formatAdminDateTime(invitation.expiresAt)}
                </td>
                <td className="admin-nowrap" data-label="接受时间">
                  {formatAdminDateTime(invitation.acceptedAt)}
                </td>
                <td data-label="操作">
                  {invitation.status === "pending" ? (
                    <AdminReasonDialog
                      confirmLabel="确认撤销邀请"
                      danger
                      description={`撤销 ${invitation.emailMasked} 的邀请后，该邀请码立即失效且无法恢复。操作会写入审计。`}
                      onConfirm={(reason) => revoke(invitation, reason)}
                      onSuccess={setNotice}
                      reasonPlaceholder="例如：邀请发错邮箱 / 被邀请人已线下放弃"
                      title="撤销这条邀请？"
                      trigger={
                        <button
                          className="admin-button admin-button--danger admin-button--small"
                          type="button"
                        >
                          撤销
                        </button>
                      }
                    />
                  ) : (
                    <span className="admin-muted">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </AdminTable>
        )}

        {invitations.length > 0 || filtered ? (
          <nav aria-label="邀请列表分页" className="admin-pagination">
            <span className="admin-pagination__status">
              {nextHref ? "还有更多邀请" : "已到列表末尾"}
            </span>
            {filters.cursor ? (
              <a className="admin-button" href={firstPageHref}>
                回到第一页
              </a>
            ) : null}
            {nextHref ? (
              <a className="admin-button admin-button--primary" href={nextHref}>
                下一页
              </a>
            ) : null}
          </nav>
        ) : null}

        {notice ? (
          <p className="admin-notice admin-notice--success" role="status">
            {notice}
          </p>
        ) : null}
      </AdminPanel>
    </>
  );
}
