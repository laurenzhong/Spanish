"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AdminDiagnosticEventDto,
  AdminDiagnosticsDataDto,
} from "../schemas/admin-console";
import type { AdminDiagnosticsFilterState } from "./admin-query";
import { buildAdminDiagnosticsHref } from "./admin-query";
import {
  ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS,
  ADMIN_DIAGNOSTIC_SEVERITY_LABELS,
  ADMIN_DIAGNOSTIC_STATUS_LABELS,
  formatAdminCount,
  formatAdminDateTime,
} from "./format";
import { AdminReasonDialog } from "./admin-reason-dialog";
import { sendAdminWrite } from "./admin-write-client";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminEmpty,
  AdminFilterChips,
  AdminKpiHero,
  AdminMetric,
  AdminMetricGrid,
  AdminPageHeader,
  AdminPanel,
  AdminTable,
  type AdminFilterChip,
} from "./admin-primitives";

type AdminDiagnosticsPanelProps = Readonly<{
  data: AdminDiagnosticsDataDto;
  filters: AdminDiagnosticsFilterState;
  nextHref: string | null;
  firstPageHref: string;
  resetHref: string;
}>;

/**
 * Diagnostic alerts (`/admin/diagnostics`).
 *
 * The list shows event type, severity, status, error type and timestamps only;
 * event metadata may carry internal correlation ids and is never projected.
 * Acknowledge/resolve is the console's only non-account write and follows the
 * strict `open -> acknowledged -> resolved` transitions; both write an audit row.
 */
export function AdminDiagnosticsPanel({
  data,
  filters,
  nextHref,
  firstPageHref,
  resetHref,
}: AdminDiagnosticsPanelProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const appliedChips: AdminFilterChip[] = [];
  if (filters.status) {
    appliedChips.push({
      label: `状态：${ADMIN_DIAGNOSTIC_STATUS_LABELS[filters.status]}`,
      removeHref: buildAdminDiagnosticsHref(filters, { status: null, cursor: null }),
    });
  }
  if (filters.severity) {
    appliedChips.push({
      label: `严重度：${ADMIN_DIAGNOSTIC_SEVERITY_LABELS[filters.severity]}`,
      removeHref: buildAdminDiagnosticsHref(filters, { severity: null, cursor: null }),
    });
  }
  if (filters.eventType) {
    appliedChips.push({
      label: `类型：${ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS[filters.eventType]}`,
      removeHref: buildAdminDiagnosticsHref(filters, { eventType: null, cursor: null }),
    });
  }
  if (filters.since) {
    appliedChips.push({
      label: `起始：${formatAdminDateTime(filters.since)}`,
      removeHref: buildAdminDiagnosticsHref(filters, { since: null, cursor: null }),
    });
  }
  const filtered = appliedChips.length > 0;

  async function triage(
    event: AdminDiagnosticEventDto,
    status: "acknowledged" | "resolved",
    reason: string,
  ): Promise<{ ok: boolean; message: string }> {
    const result = await sendAdminWrite({
      path: `/api/v1/admin/diagnostics/${encodeURIComponent(event.id)}`,
      method: "PATCH",
      body: { status, reason },
      fallbackMessage: "诊断事件状态未更新。",
    });
    if (!result.ok) return result;
    const auditRecorded =
      typeof result.data === "object" &&
      result.data !== null &&
      (result.data as { auditRecorded?: unknown }).auditRecorded === true;
    router.refresh();
    const base =
      status === "acknowledged" ? "事件已标记为已确认。" : "事件已标记为已解决。";
    return {
      ok: true,
      message: auditRecorded
        ? base
        : `${base} 审计记录未写入，请稍后刷新审计日志核对。`,
    };
  }

  return (
    <div className="admin-page admin-page--wide">
      <AdminPageHeader
        description="diagnostic_events 的只读告警视图：只展示类型、严重度、状态与时间；不展示事件 metadata 与任何私密正文。"
        kicker="安全与诊断"
        title="诊断事件与告警聚合"
      />

      <AdminPanel
        className="admin-panel--hero"
        description="聚合只统计事件状态；处理顺序为「待处理 → 已确认 → 已解决」。"
        id="admin-diagnostics-aggregate"
        title="聚合"
      >
        <AdminKpiHero
          label="待处理"
          scope="全部 diagnostic_events 的当前状态计数"
          value={formatAdminCount(data.aggregate.open)}
        />
        <AdminMetricGrid>
          <AdminMetric label="已确认" value={formatAdminCount(data.aggregate.acknowledged)} />
          <AdminMetric label="已解决" value={formatAdminCount(data.aggregate.resolved)} />
          <AdminMetric
            label="Storage 清理积压失败"
            tone={data.aggregate.storageCleanupFailed > 0 ? "danger" : "default"}
            value={formatAdminCount(data.aggregate.storageCleanupFailed)}
          />
        </AdminMetricGrid>
        {data.aggregate.byEventType.length > 0 ? (
          <AdminTable
            caption="按事件类型的聚合"
            density="compact"
            head={
              <tr>
                <th scope="col">事件类型</th>
                <th data-num scope="col">
                  待处理
                </th>
                <th data-num scope="col">
                  总数
                </th>
              </tr>
            }
          >
            {data.aggregate.byEventType.map((row) => (
              <tr key={row.eventType}>
                <td className="admin-table__title" data-label="事件类型">
                  {ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS[row.eventType]}
                </td>
                <td data-label="待处理" data-num>
                  {formatAdminCount(row.open)}
                </td>
                <td data-label="总数" data-num>
                  {formatAdminCount(row.total)}
                </td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmpty
            description="当对话流失败、证据重复、记忆冲突或 Storage 清理失败时，事件会出现在这里。"
            icon="diagnostics"
            title="还没有诊断事件"
          />
        )}
      </AdminPanel>

      <div>
        <form
          action="/admin/diagnostics"
          aria-label="筛选诊断事件"
          className="admin-toolbar"
          method="get"
        >
          <div className="admin-toolbar__fields">
            <div className="admin-field">
              <label htmlFor="admin-diagnostics-status">状态</label>
              <select
                defaultValue={filters.status ?? ""}
                id="admin-diagnostics-status"
                name="status"
              >
                <option value="">全部状态</option>
                <option value="open">待处理</option>
                <option value="acknowledged">已确认</option>
                <option value="resolved">已解决</option>
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="admin-diagnostics-severity">严重度</label>
              <select
                defaultValue={filters.severity ?? ""}
                id="admin-diagnostics-severity"
                name="severity"
              >
                <option value="">全部严重度</option>
                <option value="warning">警告</option>
                <option value="alert">告警</option>
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="admin-diagnostics-event-type">事件类型</label>
              <select
                defaultValue={filters.eventType ?? ""}
                id="admin-diagnostics-event-type"
                name="eventType"
              >
                <option value="">全部类型</option>
                {Object.entries(ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="admin-diagnostics-since">起始时间（ISO / UTC）</label>
              <input
                defaultValue={filters.since ?? ""}
                id="admin-diagnostics-since"
                name="since"
                placeholder="2026-10-01T00:00:00Z"
                type="text"
              />
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
          <AdminBadge className="admin-badge--count">本页 {data.events.length} 条</AdminBadge>
        }
        description="处理顺序为「待处理 → 已确认 → 已解决」；每次处理都需要填写原因并写入审计。"
        flush={data.events.length > 0}
        id="admin-diagnostics-events"
        title="诊断事件"
      >
        {data.events.length === 0 && !filtered ? (
          <AdminEmpty
            description="当对话流失败、证据重复、记忆冲突或 Storage 清理失败时，事件会出现在这里。"
            icon="diagnostics"
            title="还没有诊断事件"
          />
        ) : (
          <AdminTable
            caption="诊断事件列表"
            tall
            head={
              <tr>
                <th scope="col">发生时间</th>
                <th scope="col">事件类型</th>
                <th scope="col">严重度</th>
                <th scope="col">状态</th>
                <th scope="col">错误类型</th>
                <th scope="col">处理</th>
              </tr>
            }
          >
            {data.events.length === 0 ? (
              <tr className="admin-table__empty-row">
                <td colSpan={6}>
                  <div className="admin-table__empty-content">
                    <p>当前筛选条件下没有事件。</p>
                    <a className="admin-button admin-button--small" href={resetHref}>
                      清除筛选
                    </a>
                  </div>
                </td>
              </tr>
            ) : (
              data.events.map((event) => (
                <tr key={event.id}>
                  <td className="admin-nowrap" data-label="发生时间">
                    {formatAdminDateTime(event.occurredAt)}
                  </td>
                  <td data-label="事件类型">
                    {ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS[event.eventType]}
                  </td>
                  <td data-label="严重度">
                    <AdminBadge dot tone={event.severity === "alert" ? "danger" : "warning"}>
                      {ADMIN_DIAGNOSTIC_SEVERITY_LABELS[event.severity]}
                    </AdminBadge>
                  </td>
                  <td data-label="状态">
                    <AdminBadge tone="neutral">
                      {ADMIN_DIAGNOSTIC_STATUS_LABELS[event.status]}
                    </AdminBadge>
                  </td>
                  <td data-label="错误类型">
                    <code className="admin-code">{event.errorType ?? "—"}</code>
                  </td>
                  <td data-label="处理">
                    {event.status === "open" ? (
                      <AdminReasonDialog
                        confirmLabel="确认标记"
                        description={`将 ${ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS[event.eventType]} 事件标记为已确认。操作会写入审计。`}
                        onConfirm={(reason) => triage(event, "acknowledged", reason)}
                        onSuccess={setNotice}
                        reasonPlaceholder="例如：已确认是上游超时，正在跟踪"
                        title="确认这条诊断事件？"
                        trigger={
                          <button
                            className="admin-button admin-button--small"
                            type="button"
                          >
                            标记已确认
                          </button>
                        }
                      />
                    ) : event.status === "acknowledged" ? (
                      <AdminReasonDialog
                        confirmLabel="确认解决"
                        description={`将 ${ADMIN_DIAGNOSTIC_EVENT_TYPE_LABELS[event.eventType]} 事件标记为已解决。操作会写入审计。`}
                        onConfirm={(reason) => triage(event, "resolved", reason)}
                        onSuccess={setNotice}
                        reasonPlaceholder="例如：上游恢复，已复核无持续失败"
                        title="解决这条诊断事件？"
                        trigger={
                          <button
                            className="admin-button admin-button--primary admin-button--small"
                            type="button"
                          >
                            标记已解决
                          </button>
                        }
                      />
                    ) : (
                      <span className="admin-muted">已解决</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </AdminTable>
        )}

        {data.events.length > 0 || filtered ? (
          <nav aria-label="诊断事件分页" className="admin-pagination">
            <span className="admin-pagination__status">
              {nextHref ? "还有更多事件" : "已到列表末尾"}
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
    </div>
  );
}
