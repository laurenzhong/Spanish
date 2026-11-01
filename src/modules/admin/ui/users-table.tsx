"use client";

import Link from "next/link";

import type { AdminUserSummaryDto } from "../schemas/admin-console";
import {
  ADMIN_ROLE_LABELS,
  ADMIN_USER_STATUS_LABELS,
  formatAdminCount,
  formatAdminDateTime,
} from "./format";
import { buildAdminUserDetailHref, buildAdminUsersHref, type AdminUsersFilterState } from "./admin-query";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminEmpty,
  AdminFilterChips,
  AdminPageHeader,
  AdminPanel,
  AdminTable,
  type AdminFilterChip,
} from "./admin-primitives";

type AdminUsersTableProps = Readonly<{
  users: readonly AdminUserSummaryDto[];
  filters: AdminUsersFilterState;
  /** Cursor link for the next page; null when the list is exhausted. */
  nextHref: string | null;
  /** Link that drops the pagination cursor while keeping the filters. */
  firstPageHref: string;
  /** Link that clears every filter. */
  resetHref: string;
}>;

/**
 * User list for `/admin/users`. The URL key is always the public UID; internal
 * profile ids are never part of a response DTO. The learning summary column is
 * a counter set, explicitly not a learning-capability fact.
 *
 * Table contract: sticky header on the panel surface, 46px rows, hover always
 * on, one primary row action, and a card layout below 768px (CSS-only, the
 * semantic table stays intact for assistive technology).
 */
export function AdminUsersTable({
  users,
  filters,
  nextHref,
  firstPageHref,
  resetHref,
}: AdminUsersTableProps) {
  const appliedChips: AdminFilterChip[] = [];
  if (filters.q) {
    appliedChips.push({
      label: `搜索：${filters.q}`,
      removeHref: buildAdminUsersHref(filters, { q: null, cursor: null }),
    });
  }
  if (filters.status) {
    appliedChips.push({
      label: `状态：${ADMIN_USER_STATUS_LABELS[filters.status]}`,
      removeHref: buildAdminUsersHref(filters, { status: null, cursor: null }),
    });
  }
  if (filters.role) {
    appliedChips.push({
      label: `角色：${ADMIN_ROLE_LABELS[filters.role]}`,
      removeHref: buildAdminUsersHref(filters, { role: null, cursor: null }),
    });
  }
  const filtered = appliedChips.length > 0;

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="按公开 UID 或显示名搜索；邮箱只在邀请记录里以掩码出现。表中的训练、证据与消息计数是运营摘要，不是能力分数。"
        kicker="用户管理"
        title="账号与学习摘要"
      />

      <div>
        <form
          action="/admin/users"
          aria-label="筛选用户"
          className="admin-toolbar"
          method="get"
        >
          <div className="admin-field admin-toolbar__search">
            <label htmlFor="admin-users-q">搜索公开 UID 或显示名</label>
            <input
              defaultValue={filters.q ?? ""}
              id="admin-users-q"
              maxLength={80}
              name="q"
              placeholder="SN-XXXX-XXXX 或显示名"
              type="search"
            />
          </div>
          <div className="admin-toolbar__fields">
            <div className="admin-field">
              <label htmlFor="admin-users-status">账号状态</label>
              <select defaultValue={filters.status ?? ""} id="admin-users-status" name="status">
                <option value="">全部状态</option>
                <option value="active">正常</option>
                <option value="suspended">已停用</option>
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="admin-users-role">角色</label>
              <select defaultValue={filters.role ?? ""} id="admin-users-role" name="role">
                <option value="">全部角色</option>
                <option value="owner">所有者</option>
                <option value="member">成员</option>
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
        <AdminFilterChips
          clearHref={filtered ? resetHref : undefined}
          items={appliedChips}
        />
      </div>

      <AdminPanel
        aside={
          <AdminBadge className="admin-badge--count">
            本页 {formatAdminCount(users.length)} 个账号
          </AdminBadge>
        }
        description="表内计数是运营摘要，不是能力分数；公开 UID 是唯一可跳转的账号标识。"
        flush={users.length > 0}
        hero
        id="admin-users-list"
        title="账号列表"
      >
        {users.length === 0 && !filtered ? (
          <AdminEmpty
            action={
              <Link className="admin-button admin-button--primary" href="/admin/invitations">
                去创建邀请
              </Link>
            }
            description="账号由邀请兑换与登录自动创建。还没有账号时，可以先创建一次性邀请。"
            icon="users"
            title="还没有账号"
          />
        ) : (
          <AdminTable
            caption="账号列表"
            head={
              <tr>
                <th scope="col">公开 UID</th>
                <th scope="col">显示名</th>
                <th scope="col">角色</th>
                <th scope="col">状态</th>
                <th scope="col">注册时间</th>
                <th scope="col">最近活跃</th>
                <th scope="col">学习摘要（计数）</th>
                <th scope="col">详情</th>
              </tr>
            }
          >
            {users.length === 0 ? (
              <tr className="admin-table__empty-row">
                <td colSpan={8}>
                  <div className="admin-table__empty-content">
                    <p>当前筛选条件下没有账号。</p>
                    <a className="admin-button admin-button--small" href={resetHref}>
                      清除筛选
                    </a>
                  </div>
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.publicUid}>
                  <td className="admin-table__title" data-label="公开 UID">
                    <code className="admin-code">{user.publicUid}</code>
                  </td>
                  <td data-label="显示名">
                    <span
                      className="admin-table__ellipsis"
                      title={user.displayName ?? "未设置"}
                    >
                      {user.displayName ?? "未设置"}
                    </span>
                  </td>
                  <td data-label="角色">
                    <AdminBadge className="admin-badge--role" tone="neutral">
                      {ADMIN_ROLE_LABELS[user.role]}
                    </AdminBadge>
                  </td>
                  <td data-label="状态">
                    <AdminBadge
                      dot
                      tone={user.accountStatus === "active" ? "positive" : "danger"}
                    >
                      {ADMIN_USER_STATUS_LABELS[user.accountStatus]}
                    </AdminBadge>
                    {user.deletionPending ? (
                      <AdminBadge tone="warning">注销未完成</AdminBadge>
                    ) : null}
                  </td>
                  <td className="admin-nowrap" data-label="注册时间">
                    {formatAdminDateTime(user.createdAt)}
                  </td>
                  <td className="admin-nowrap" data-label="最近活跃">
                    {formatAdminDateTime(user.lastActiveAt)}
                  </td>
                  <td data-label="学习摘要">
                    <span className="admin-muted">
                      训练 {formatAdminCount(user.counts.practiceSessions)} · 证据{" "}
                      {formatAdminCount(user.counts.evidenceEvents)} · 消息{" "}
                      {formatAdminCount(user.counts.conversationMessages)}
                    </span>
                  </td>
                  <td data-label="详情">
                    <Link
                      className="admin-text-link admin-table__row-action"
                      href={buildAdminUserDetailHref(user.publicUid)}
                    >
                      查看账号
                      <AdminIcon name="arrow-right" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </AdminTable>
        )}
      </AdminPanel>

      {users.length > 0 || filtered ? (
        <nav aria-label="用户列表分页" className="admin-pagination">
          <span className="admin-pagination__status">
            {nextHref ? "还有更多账号" : "已到列表末尾"}
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
    </div>
  );
}
