"use client";

import type { AdminAuditLogDataDto } from "../schemas/admin-console";
import type { AdminAuditFilterState } from "./admin-query";
import { buildAdminAuditHref } from "./admin-query";
import {
  ADMIN_AUDIT_ACTION_LABELS,
  ADMIN_AUDIT_TARGET_KIND_LABELS,
  formatAdminDateTime,
} from "./format";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminCode,
  AdminEmpty,
  AdminFilterChips,
  AdminPageHeader,
  AdminPanel,
  AdminTable,
  type AdminFilterChip,
} from "./admin-primitives";

type AdminAuditLogPanelProps = Readonly<{
  data: AdminAuditLogDataDto;
  filters: AdminAuditFilterState;
  nextHref: string | null;
  firstPageHref: string;
  resetHref: string;
}>;

/**
 * Append-only owner action log (`/admin/audit`).
 *
 * Entries are written by the admin/account management actions and cannot be
 * modified or deleted (the database rejects UPDATE/DELETE/TRUNCATE). The page
 * only renders the actor label plus a short non-reversible reference, target
 * labels (public UID / masked email / diagnostic event type), reason, request
 * id and time. No internal user id or plaintext email is present in the DTO.
 */
export function AdminAuditLogPanel({
  data,
  filters,
  nextHref,
  firstPageHref,
  resetHref,
}: AdminAuditLogPanelProps) {
  const appliedChips: AdminFilterChip[] = [];
  if (filters.action) {
    appliedChips.push({
      label: `动作：${ADMIN_AUDIT_ACTION_LABELS[filters.action]}`,
      removeHref: buildAdminAuditHref(filters, { action: null, cursor: null }),
    });
  }
  if (filters.targetKind) {
    appliedChips.push({
      label: `目标：${ADMIN_AUDIT_TARGET_KIND_LABELS[filters.targetKind]}`,
      removeHref: buildAdminAuditHref(filters, { targetKind: null, cursor: null }),
    });
  }
  const filtered = appliedChips.length > 0;

  return (
    <div className="admin-page admin-page--wide">
      <AdminPageHeader
        description="追加式审计：记录操作者、动作、目标、原因、请求关联 ID 与时间。历史条目不可修改或删除。"
        kicker="审计日志"
        title="所有者操作记录"
      />

      <div>
        <form
          action="/admin/audit"
          aria-label="筛选审计日志"
          className="admin-toolbar"
          method="get"
        >
          <div className="admin-toolbar__fields">
            <div className="admin-field">
              <label htmlFor="admin-audit-action">动作</label>
              <select
                defaultValue={filters.action ?? ""}
                id="admin-audit-action"
                name="action"
              >
                <option value="">全部动作</option>
                {Object.entries(ADMIN_AUDIT_ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="admin-audit-target-kind">目标类型</label>
              <select
                defaultValue={filters.targetKind ?? ""}
                id="admin-audit-target-kind"
                name="targetKind"
              >
                <option value="">全部目标</option>
                {Object.entries(ADMIN_AUDIT_TARGET_KIND_LABELS).map(([value, label]) => (
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
          <AdminBadge className="admin-badge--count">
            本页 {data.entries.length} 条
          </AdminBadge>
        }
        description="历史条目不可修改或删除；请求 ID 由服务端写入，用于关联一次操作。"
        flush={data.entries.length > 0}
        hero={data.entries.length > 0}
        id="admin-audit-entries"
        title="审计条目"
      >
        {data.entries.length === 0 && !filtered ? (
          <AdminEmpty
            description="所有者创建邀请、停用/恢复/注销账号、处理诊断事件时，会自动写入审计。"
            icon="audit"
            title="还没有审计记录"
          />
        ) : (
          <AdminTable
            caption="所有者审计日志"
            tall
            head={
              <tr>
                <th scope="col">时间</th>
                <th scope="col">动作</th>
                <th scope="col">目标类型</th>
                <th scope="col">目标</th>
                <th scope="col">原因</th>
                <th scope="col">请求 ID</th>
                <th scope="col">操作者</th>
              </tr>
            }
          >
            {data.entries.length === 0 ? (
              <tr className="admin-table__empty-row">
                <td colSpan={7}>
                  <div className="admin-table__empty-content">
                    <p>当前筛选条件下没有审计条目。</p>
                    <a className="admin-button admin-button--small" href={resetHref}>
                      清除筛选
                    </a>
                  </div>
                </td>
              </tr>
            ) : (
              data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="admin-nowrap" data-label="时间">
                    {formatAdminDateTime(entry.createdAt)}
                  </td>
                  <td data-label="动作">{ADMIN_AUDIT_ACTION_LABELS[entry.action]}</td>
                  <td data-label="目标类型">
                    {ADMIN_AUDIT_TARGET_KIND_LABELS[entry.targetKind]}
                  </td>
                  <td data-label="目标">
                    <AdminCode>{entry.targetLabel ?? "—"}</AdminCode>
                  </td>
                  <td data-label="原因">
                    <span
                      className="admin-table__clamp"
                      title={entry.reason ?? "—"}
                    >
                      {entry.reason ?? "—"}
                    </span>
                  </td>
                  <td data-label="请求 ID">
                    <AdminCode>{entry.requestId ?? "—"}</AdminCode>
                  </td>
                  <td data-label="操作者">
                    {entry.actor.label}
                    <span className="admin-muted"> · {entry.actor.reference}</span>
                  </td>
                </tr>
              ))
            )}
          </AdminTable>
        )}

        {data.entries.length > 0 || filtered ? (
          <nav aria-label="审计日志分页" className="admin-pagination">
            <span className="admin-pagination__status">
              {nextHref ? "还有更多条目" : "已到列表末尾"}
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
      </AdminPanel>
    </div>
  );
}
