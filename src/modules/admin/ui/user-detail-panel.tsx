"use client";

import Link from "next/link";
import { useState } from "react";

import type { AdminUserDetailDataDto } from "../schemas/admin-console";
import {
  ADMIN_AUDIT_ACTION_LABELS,
  ADMIN_INVITATION_STATUS_LABELS,
  ADMIN_ROLE_LABELS,
  ADMIN_USER_STATUS_LABELS,
  formatAdminCount,
  formatAdminDateTime,
} from "./format";
import { AdminUserActions } from "./user-actions";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminCode,
  AdminDefinitionList,
  AdminEmpty,
  AdminKpiHero,
  AdminMetric,
  AdminMetricGrid,
  AdminPageHeader,
  AdminPanel,
  AdminTable,
} from "./admin-primitives";

type AdminUserDetailPanelProps = Readonly<{
  data: AdminUserDetailDataDto;
}>;

/**
 * Account detail (`/admin/users/[publicUid]`).
 *
 * The page shows only what the read model exposes: public UID, display name,
 * role, account status, timestamps, aggregate counters, the masked invitation
 * source and recent owner actions. It never renders an internal profile id,
 * plaintext email, chat text, recordings or memory.
 */
export function AdminUserDetailPanel({ data }: AdminUserDetailPanelProps) {
  const { user, invitation, recentAudit } = data;
  const [copied, setCopied] = useState(false);

  async function copyPublicUid() {
    try {
      await navigator.clipboard.writeText(user.publicUid);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="admin-page admin-page--detail">
      <nav aria-label="面包屑" className="admin-breadcrumb">
        <Link href="/admin/users">用户</Link>
        <AdminIcon className="admin-breadcrumb__separator" name="chevron-right" />
        <span aria-current="page">账号详情</span>
      </nav>

      <AdminPageHeader
        aside={
          <AdminBadge
            dot
            tone={user.accountStatus === "active" ? "positive" : "danger"}
          >
            {ADMIN_USER_STATUS_LABELS[user.accountStatus]}
          </AdminBadge>
        }
        description="只展示账号元数据与聚合计数；公开 UID 用于支持与审计核对。"
        kicker="账号详情"
        title={user.displayName ?? "未设置显示名"}
      />

      <AdminPanel
        description="身份与账号状态来自 profiles 与邀请记录的只读投影。"
        hero
        id="admin-user-account"
        title="账号信息"
      >
        <AdminDefinitionList
          items={[
            {
              term: "公开 UID",
              value: (
                <span className="admin-inline">
                  <AdminCode>{user.publicUid}</AdminCode>
                  <button
                    aria-label="复制公开 UID"
                    className="admin-copy-button"
                    onClick={() => void copyPublicUid()}
                    type="button"
                  >
                    <AdminIcon name="copy" />
                  </button>
                  {copied ? (
                    <span className="admin-muted" role="status">
                      已复制
                    </span>
                  ) : null}
                </span>
              ),
            },
            { term: "显示名", value: user.displayName ?? "未设置" },
            { term: "角色", value: ADMIN_ROLE_LABELS[user.role] },
            { term: "账号状态", value: ADMIN_USER_STATUS_LABELS[user.accountStatus] },
            {
              term: "注销状态",
              value: user.deletionPending
                ? "已发起注销，尚未完成（可重试）"
                : "未发起注销",
            },
            { term: "注册时间", value: formatAdminDateTime(user.createdAt) },
            { term: "最近活跃", value: formatAdminDateTime(user.lastActiveAt) },
          ]}
        />
      </AdminPanel>

      <AdminPanel
        description="掌握度与证据可信度只在用户自己的画像页展示。"
        id="admin-user-counts"
        title="学习摘要（计数）"
      >
        <AdminKpiHero
          label="学习证据"
          scope="运营计数：证据事件条数，不是能力分数"
          value={formatAdminCount(user.counts.evidenceEvents)}
        />
        <AdminMetricGrid>
          <AdminMetric compact label="训练次数" value={formatAdminCount(user.counts.practiceSessions)} />
          <AdminMetric compact label="训练尝试" value={formatAdminCount(user.counts.practiceAttempts)} />
          <AdminMetric compact label="对话消息" value={formatAdminCount(user.counts.conversationMessages)} />
          <AdminMetric compact label="阅读条目" value={formatAdminCount(user.counts.readingItems)} />
          <AdminMetric compact label="媒体进度" value={formatAdminCount(user.counts.mediaItems)} />
        </AdminMetricGrid>
      </AdminPanel>

      <AdminPanel
        description="邀请邮箱只以掩码展示；一次性邀请码从不在任何后台页面回显。"
        id="admin-user-invitation"
        title="邀请来源"
      >
        {invitation ? (
          <AdminDefinitionList
            items={[
              {
                term: "邀请邮箱（掩码）",
                value: <AdminCode>{invitation.emailMasked}</AdminCode>,
              },
              { term: "邀请角色", value: ADMIN_ROLE_LABELS[invitation.role] },
              {
                term: "邀请状态",
                value: ADMIN_INVITATION_STATUS_LABELS[invitation.status],
              },
              { term: "创建时间", value: formatAdminDateTime(invitation.createdAt) },
              { term: "接受时间", value: formatAdminDateTime(invitation.acceptedAt) },
            ]}
          />
        ) : (
          <AdminEmpty
            description="该账号不是通过邀请创建，或邀请记录已被删除。"
            icon="invitations"
            title="没有可显示的邀请来源"
          />
        )}
      </AdminPanel>

      <AdminPanel
        aside={<AdminBadge className="admin-badge--count">{recentAudit.length} 条</AdminBadge>}
        description="只读展示针对该账号的追加式所有者操作。"
        id="admin-user-audit"
        title="最近审计（针对该账号）"
      >
        {recentAudit.length === 0 ? (
          <AdminEmpty
            description="该账号还没有被所有者执行过管理动作。"
            icon="audit"
            title="尚未记录所有者操作"
          />
        ) : (
          <AdminTable
            caption="针对该账号的最近审计记录"
            density="compact"
            head={
              <tr>
                <th scope="col">时间</th>
                <th scope="col">动作</th>
                <th scope="col">目标</th>
                <th scope="col">原因</th>
              </tr>
            }
          >
            {recentAudit.map((entry) => (
              <tr key={entry.id}>
                <td className="admin-nowrap" data-label="时间">
                  {formatAdminDateTime(entry.createdAt)}
                </td>
                <td data-label="动作">{ADMIN_AUDIT_ACTION_LABELS[entry.action]}</td>
                <td data-label="目标">
                  <AdminCode>{entry.targetLabel ?? "—"}</AdminCode>
                </td>
                <td data-label="原因">{entry.reason ?? "—"}</td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminPanel>

      <AdminUserActions user={user} />
    </div>
  );
}
