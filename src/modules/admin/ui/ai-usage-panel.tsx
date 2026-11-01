"use client";

import type { AdminAiUsageDataDto } from "../schemas/admin-console";
import type { AdminAiUsageFilterState } from "./admin-query";
import { buildAdminAiUsageHref } from "./admin-query";
import {
  formatAdminCostMicros,
  formatAdminCount,
  formatAdminDateTime,
  formatAdminLatency,
  formatAdminRatio,
  providerTypeLabel,
} from "./format";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminBarChart,
  AdminBarList,
  AdminEmpty,
  AdminFilterChips,
  AdminKpiHero,
  AdminMetric,
  AdminMetricGrid,
  AdminNote,
  AdminPageHeader,
  AdminPanel,
  AdminSegmented,
  AdminTable,
  type AdminFilterChip,
} from "./admin-primitives";

export type AdminAiRangeLink = Readonly<{
  label: string;
  href: string;
  current: boolean;
}>;

type AdminAiUsagePanelProps = Readonly<{
  data: AdminAiUsageDataDto;
  filters: AdminAiUsageFilterState;
  rangeLinks: readonly AdminAiRangeLink[];
}>;

/** Sparse cost: $0 with zero coverage is not "$0.0000", it is "no sample". */
function formatCostOrNoSample(
  costMicros: number | null,
  coverageRatio: number | null,
): string {
  if (costMicros === null || coverageRatio === null || coverageRatio === 0) {
    return "—（无成本样本）";
  }
  return formatAdminCostMicros(costMicros);
}

/** Compact variant for table cells and bar values (no room for the sentence). */
function formatCostOrDash(
  costMicros: number | null,
  coverageRatio: number | null,
): string {
  if (costMicros === null || coverageRatio === null || coverageRatio === 0) {
    return "—";
  }
  return formatAdminCostMicros(costMicros);
}

type DailyAggregate = Readonly<{
  calls: number;
  failed: number;
  estimatedCostMicros: number;
  costUnknownCalls: number;
}>;

type DailyBucket = Readonly<{
  label: string;
  rangeLabel: string;
  aggregate: DailyAggregate;
}>;

const EMPTY_DAY: DailyAggregate = {
  calls: 0,
  failed: 0,
  estimatedCostMicros: 0,
  costUnknownCalls: 0,
};

function utcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Zero-fill the whole requested window so a quiet day is a visible zero column,
 * then collapse long windows into at most 14 buckets. Implemented in the UI
 * layer only: the API keeps returning sparse daily rows.
 */
function buildDailyBuckets(
  fromIso: string,
  toIso: string,
  rows: AdminAiUsageDataDto["byDay"],
): readonly DailyBucket[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (end < start) return [];

  const byDate = new Map(rows.map((row) => [row.date, row]));
  const days: { date: string; aggregate: DailyAggregate }[] = [];
  const dayMs = 24 * 60 * 60 * 1_000;
  for (let time = start; time <= end; time += dayMs) {
    const date = utcDayKey(new Date(time));
    const row = byDate.get(date);
    days.push({
      date,
      aggregate: row
        ? {
            calls: row.calls,
            failed: row.failed,
            estimatedCostMicros: row.estimatedCostMicros,
            costUnknownCalls: row.costUnknownCalls,
          }
        : EMPTY_DAY,
    });
  }

  const maxBuckets = 14;
  if (days.length <= maxBuckets) {
    return days.map(({ date, aggregate }) => ({
      label: date.slice(5),
      rangeLabel: date,
      aggregate,
    }));
  }

  const buckets: DailyBucket[] = [];
  for (let index = 0; index < maxBuckets; index += 1) {
    const firstIndex = Math.floor((index * days.length) / maxBuckets);
    const lastIndex = Math.floor(((index + 1) * days.length) / maxBuckets) - 1;
    const slice = days.slice(firstIndex, Math.max(firstIndex, lastIndex) + 1);
    if (slice.length === 0) continue;
    const aggregate = slice.reduce<DailyAggregate>(
      (total, day) => ({
        calls: total.calls + day.aggregate.calls,
        failed: total.failed + day.aggregate.failed,
        estimatedCostMicros:
          total.estimatedCostMicros + day.aggregate.estimatedCostMicros,
        costUnknownCalls:
          total.costUnknownCalls + day.aggregate.costUnknownCalls,
      }),
      EMPTY_DAY,
    );
    const firstDate = slice[0].date;
    const lastDate = slice[slice.length - 1].date;
    buckets.push({
      label: firstDate.slice(5),
      rangeLabel: firstDate === lastDate ? firstDate : `${firstDate} → ${lastDate}`,
      aggregate,
    });
  }
  return buckets;
}

/**
 * AI usage and estimated cost (`/admin/ai-usage`).
 *
 * Aggregates only: call counts, failure rate, latency percentiles (succeeded
 * calls), estimated cost with its coverage, error types and safety-gate hits.
 * No request/response text is read or rendered. TTS/STT/transcription do not
 * write `provider_calls` yet, which the page states explicitly instead of
 * reporting a misleading "complete" bill.
 */
export function AdminAiUsagePanel({ data, filters, rangeLinks }: AdminAiUsagePanelProps) {
  const buckets = buildDailyBuckets(data.from, data.to, data.byDay);
  const maxBucketCalls = Math.max(
    1,
    ...buckets.map((bucket) => bucket.aggregate.calls),
  );
  const hasCallActivity = buckets.some((bucket) => bucket.aggregate.calls > 0);
  const maxProviderTypeCalls = Math.max(
    1,
    ...data.byProviderType.map((row) => row.calls),
  );
  const appliedChips: AdminFilterChip[] = [];
  if (filters.from || filters.to) {
    appliedChips.push({
      label: `时间窗：${formatAdminDateTime(data.from)} → ${formatAdminDateTime(data.to)}`,
      removeHref: buildAdminAiUsageHref(filters, { from: null, to: null }),
    });
  }
  if (filters.providerType) {
    appliedChips.push({
      label: `类型：${providerTypeLabel(filters.providerType)}`,
      removeHref: buildAdminAiUsageHref(filters, { providerType: null }),
    });
  }
  if (filters.provider) {
    appliedChips.push({
      label: `供应商：${filters.provider}`,
      removeHref: buildAdminAiUsageHref(filters, { provider: null }),
    });
  }
  const filtered = appliedChips.length > 0;

  return (
    <div className="admin-page">
      <AdminPageHeader
        aside={
          <AdminBadge className="admin-badge--label">
            成本覆盖率 {formatAdminRatio(data.totals.costCoverageRatio)}
          </AdminBadge>
        }
        description="只读取供应商调用的元数据聚合：调用量、失败率、延迟分位数与估算成本，不读取请求或响应正文。"
        kicker="AI 用量"
        title="调用、延迟与估算成本"
      />

      <div className="admin-context-row">
        <AdminSegmented label="时间窗快捷选择" items={rangeLinks} />
        <p className="admin-page__meta" role="note">
          查询窗口 {formatAdminDateTime(data.from)} → {formatAdminDateTime(data.to)} · 生成时间{" "}
          {formatAdminDateTime(data.generatedAt)}
        </p>
      </div>

      <div>
        <form
          action="/admin/ai-usage"
          aria-label="筛选 AI 用量"
          className="admin-toolbar"
          method="get"
        >
          <div className="admin-toolbar__fields">
            <div className="admin-field">
              <label htmlFor="admin-ai-from">开始（ISO / UTC）</label>
              <input
                defaultValue={filters.from ?? ""}
                id="admin-ai-from"
                name="from"
                placeholder="2026-10-01T00:00:00Z"
                type="text"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="admin-ai-to">结束（ISO / UTC）</label>
              <input
                defaultValue={filters.to ?? ""}
                id="admin-ai-to"
                name="to"
                placeholder="2026-10-08T00:00:00Z"
                type="text"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="admin-ai-provider-type">调用类型</label>
              <input
                defaultValue={filters.providerType ?? ""}
                id="admin-ai-provider-type"
                maxLength={80}
                name="providerType"
                placeholder="例如 conversation"
                type="text"
              />
            </div>
            <div className="admin-field">
              <label htmlFor="admin-ai-provider">供应商</label>
              <input
                defaultValue={filters.provider ?? ""}
                id="admin-ai-provider"
                maxLength={120}
                name="provider"
                placeholder="例如 minimax"
                type="text"
              />
            </div>
          </div>
          <div className="admin-actions">
            <button className="admin-button admin-button--primary" type="submit">
              <AdminIcon name="filter" />
              应用筛选
            </button>
            <a className="admin-button" href="/admin/ai-usage">
              重置为默认 30 天
            </a>
          </div>
        </form>
        <AdminFilterChips
          clearHref={filtered ? "/admin/ai-usage" : undefined}
          items={appliedChips}
        />
      </div>

      <AdminPanel
        className="admin-panel--hero"
        description="失败率 = 失败 /（成功 + 失败 + 取消），不含进行中的调用；延迟分位数只统计成功调用。"
        id="admin-ai-totals"
        title="调用总计"
      >
        <AdminKpiHero
          label="调用总数"
          scope={`统计窗口 ${formatAdminDateTime(data.from)} → ${formatAdminDateTime(data.to)}`}
          value={formatAdminCount(data.totals.calls)}
        />
        <AdminMetricGrid>
          <AdminMetric label="成功" value={formatAdminCount(data.totals.succeeded)} />
          <AdminMetric
            label="失败"
            tone={data.totals.failed > 0 ? "danger" : "default"}
            value={formatAdminCount(data.totals.failed)}
          />
          <AdminMetric label="失败率" value={formatAdminRatio(data.totals.failureRate)} />
          <AdminMetric label="p50 延迟" value={formatAdminLatency(data.totals.p50LatencyMs)} />
          <AdminMetric label="p95 延迟" value={formatAdminLatency(data.totals.p95LatencyMs)} />
        </AdminMetricGrid>
        <div className="admin-grid admin-grid--2">
          <dl className="admin-facts">
            <div>
              <dt>取消</dt>
              <dd>{formatAdminCount(data.totals.cancelled)}</dd>
            </div>
            <div>
              <dt>进行中</dt>
              <dd>{formatAdminCount(data.totals.started)}</dd>
            </div>
            <div>
              <dt>估算成本</dt>
              <dd>
                {formatCostOrNoSample(
                  data.totals.estimatedCostMicros,
                  data.totals.costCoverageRatio,
                )}
              </dd>
            </div>
            <div>
              <dt>无成本记录的调用</dt>
              <dd
                className={
                  data.totals.costUnknownCalls > 0 ? "admin-value--warning" : undefined
                }
              >
                {formatAdminCount(data.totals.costUnknownCalls)}
              </dd>
            </div>
          </dl>
          <AdminNote>
            成本只覆盖已写入 <code>provider_calls</code> 且带{" "}
            <code>estimated_cost_micros</code> 的调用；TTS、STT 与转写当前未埋点，
            因此该数字不是完整账单。
          </AdminNote>
        </div>
      </AdminPanel>

      <AdminPanel
        description="按 UTC 日聚合并补零缺失日期；超过 14 天时按等宽区间聚合。单位：次。"
        id="admin-ai-by-day"
        title="按 UTC 日调用量"
      >
        {hasCallActivity ? (
          <AdminBarChart
            caption={`单位：次 · 图表底边为 0 基线 · 柱高按最大单日/区间调用量 ${formatAdminCount(
              maxBucketCalls,
            )} 归一；红色文字为该日（区间）失败调用数。`}
            columns={buckets.map((bucket) => ({
              label: bucket.label,
              value: formatAdminCount(bucket.aggregate.calls),
              percent: Math.min(100, (bucket.aggregate.calls / maxBucketCalls) * 100),
              note:
                bucket.aggregate.failed > 0
                  ? `失败 ${formatAdminCount(bucket.aggregate.failed)}`
                  : undefined,
              ariaLabel: `${bucket.rangeLabel}：调用 ${formatAdminCount(
                bucket.aggregate.calls,
              )}，失败 ${formatAdminCount(
                bucket.aggregate.failed,
              )}，估算成本 ${formatAdminCostMicros(
                bucket.aggregate.estimatedCostMicros,
              )}`,
            }))}
            label="按日调用量"
          />
        ) : (
          <AdminEmpty
            description="当前统计窗口内没有已埋点的供应商调用。"
            icon="ai-usage"
            title="当前窗口没有调用记录"
          />
        )}
      </AdminPanel>

      <div className="admin-grid admin-grid--2">
        <AdminPanel id="admin-ai-by-type" title="按调用类型">
          {data.byProviderType.length === 0 ? (
            <AdminEmpty
              description="当前筛选条件下没有按类型的调用聚合。"
              icon="ai-usage"
              title="没有调用类型数据"
            />
          ) : (
            <AdminBarList
              caption={`单位：次 · 条宽按本窗口最大值 ${formatAdminCount(
                maxProviderTypeCalls,
              )} 次归一；失败率与成本以文字标注。`}
              label="按调用类型"
              rows={data.byProviderType.map((row) => ({
                label: providerTypeLabel(row.providerType),
                value: `${formatAdminCount(row.calls)} 次 · ${formatCostOrDash(
                  row.estimatedCostMicros,
                  data.totals.costCoverageRatio,
                )}`,
                percent: Math.min(100, (row.calls / maxProviderTypeCalls) * 100),
                hint: `失败 ${formatAdminCount(row.failed)} 次（${formatAdminRatio(
                  row.failureRate,
                )}）`,
              }))}
            />
          )}
        </AdminPanel>

        <AdminPanel id="admin-ai-errors" title="失败错误类型 Top 10">
          {data.topErrorTypes.length === 0 ? (
            <AdminEmpty
              description="当前窗口没有失败调用，因此没有错误类型。"
              icon="diagnostics"
              title="没有失败调用"
            />
          ) : (
            <ol className="admin-rank-list">
              {data.topErrorTypes.map((error) => (
                <li key={error.errorType}>
                  <code className="admin-code">{error.errorType}</code>
                  <span>{formatAdminCount(error.count)}</span>
                </li>
              ))}
            </ol>
          )}
          <h3 className="admin-subtitle">安全门禁命中</h3>
          <dl className="admin-facts">
            <div>
              <dt>对话生成被拦截</dt>
              <dd>{formatAdminCount(data.safetyGate.conversationBlockedGenerations)}</dd>
            </div>
            <div>
              <dt>主动消息候选被拦截</dt>
              <dd>{formatAdminCount(data.safetyGate.proactiveBlockedCandidates)}</dd>
            </div>
          </dl>
        </AdminPanel>
      </div>

      <AdminPanel
        aside={
          <AdminBadge className="admin-badge--count">
            {formatAdminCount(data.byProvider.length)} 个组合
          </AdminBadge>
        }
        description="数值列右对齐并使用等宽数字；成本与覆盖率随行给出。"
        flush={data.byProvider.length > 0}
        id="admin-ai-by-provider"
        title="按供应商"
      >
        {data.byProvider.length === 0 ? (
          <AdminEmpty
            description="当前筛选条件下没有按供应商的调用聚合。"
            icon="database"
            title="没有供应商数据"
          />
        ) : (
          <AdminTable
            caption="按供应商的调用聚合"
            head={
              <tr>
                <th scope="col">供应商</th>
                <th scope="col">调用类型</th>
                <th data-num scope="col">
                  调用
                </th>
                <th data-num scope="col">
                  失败
                </th>
                <th data-num scope="col">
                  失败率
                </th>
                <th data-num scope="col">
                  估算成本
                </th>
                <th data-num scope="col">
                  成本覆盖率
                </th>
              </tr>
            }
          >
            {data.byProvider.map((row) => (
              <tr key={`${row.provider}:${row.providerType}`}>
                <td className="admin-table__title" data-label="供应商">
                  <code className="admin-code">{row.provider}</code>
                </td>
                <td data-label="调用类型">{providerTypeLabel(row.providerType)}</td>
                <td data-label="调用" data-num>
                  {formatAdminCount(row.calls)}
                </td>
                <td data-label="失败" data-num>
                  {formatAdminCount(row.failed)}
                </td>
                <td data-label="失败率" data-num>
                  {formatAdminRatio(row.failureRate)}
                </td>
                <td data-label="估算成本" data-num>
                  {formatCostOrDash(row.estimatedCostMicros, row.costCoverageRatio)}
                </td>
                <td data-label="成本覆盖率" data-num>
                  {formatAdminRatio(row.costCoverageRatio)}
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminPanel>
    </div>
  );
}
