"use client";

import Link from "next/link";

import type { AdminOverviewDataDto } from "../schemas/admin-console";
import type { AdminAiErrorAggregateDto } from "../schemas/admin-console";
import {
  ADMIN_HEALTH_LABELS,
  ADMIN_WINDOW_LABELS,
  formatAdminCostMicros,
  formatAdminCount,
  formatAdminDateTime,
  formatAdminLatency,
  formatAdminRatio,
  providerTypeLabel,
} from "./format";
import type { AdminWindow } from "../domain/admin-console";
import { AdminIcon } from "./admin-icons";
import {
  AdminBadge,
  AdminBarList,
  AdminEmpty,
  AdminKpiHero,
  AdminMetric,
  AdminMetricGrid,
  AdminNote,
  AdminPageHeader,
  AdminPanel,
  AdminSegmented,
  type AdminTone,
} from "./admin-primitives";

/** Sparse cost: a zero-coverage "$0.0000" is "no sample", not a real zero. */
function formatCostOrDash(
  costMicros: number | null,
  coverageRatio: number | null,
): string {
  if (costMicros === null || coverageRatio === null || coverageRatio === 0) {
    return "—";
  }
  return formatAdminCostMicros(costMicros);
}

export type AdminWindowLink = Readonly<{
  window: AdminWindow;
  label: string;
  href: string;
  current: boolean;
}>;

type AdminOverviewPanelProps = Readonly<{
  data: AdminOverviewDataDto;
  windowLinks: readonly AdminWindowLink[];
  /**
   * Top provider error types from the AI-usage read model for the same window.
   * `null` means that secondary read failed or was skipped; the overview still
   * renders instead of hiding the other operational metrics.
   */
  recentErrorTypes?: readonly AdminAiErrorAggregateDto[] | null;
}>;

const HEALTH_TONES: Readonly<Record<string, AdminTone>> = {
  healthy: "positive",
  degraded: "warning",
  critical: "danger",
};

/**
 * Operational overview (`/admin`). Every block is an operational metric
 * (users/content/AI/acquisition/diagnostics); nothing here is written back or
 * presented as learning evidence.
 *
 * The top grid keeps the six cross-cutting KPIs (4–6 is the designed budget);
 * everything else is downgraded to compact fact rows, bar lists or rank lists
 * so the page reads as a dashboard instead of seven equal cards.
 */
export function AdminOverviewPanel({
  data,
  windowLinks,
  recentErrorTypes = null,
}: AdminOverviewPanelProps) {
  const maxProviderCalls = Math.max(1, ...data.ai.byProviderType.map((row) => row.calls));
  const totalPublished =
    data.content.published.articles + data.content.published.videos + data.content.published.podcasts;
  const candidateRows = [
    { label: "已发现", value: data.content.candidates.discovered },
    { label: "已初筛", value: data.content.candidates.screened },
    { label: "采集中", value: data.content.candidates.acquiring },
    { label: "处理中", value: data.content.candidates.processing },
    { label: "等待审核", value: data.content.candidates.reviewReady },
    { label: "失败", value: data.content.candidates.failed, tone: "danger" as const },
    { label: "已拒绝", value: data.content.candidates.rejected },
  ];
  const maxCandidate = Math.max(1, ...candidateRows.map((row) => row.value));
  const hasCandidates = candidateRows.some((row) => row.value > 0);
  const healthTone = HEALTH_TONES[data.health] ?? "neutral";

  return (
    <div className="admin-page">
      <AdminPageHeader
        aside={
          <AdminBadge dot tone={healthTone}>
            {ADMIN_HEALTH_LABELS[data.health]}
          </AdminBadge>
        }
        description="只读聚合：用户、发布内容、AI 调用与采集运行。计数与成本属于运营指标，不是学习能力事实。"
        kicker="运营总览"
        title="平台运行概况"
      />

      <div className="admin-context-row">
        <AdminSegmented label="统计时间窗口" items={windowLinks} />
        <p className="admin-page__meta" role="note">
          数据截至 {formatAdminDateTime(data.generatedAt)}
        </p>
      </div>

      <AdminPanel
        className="admin-panel--hero"
        description="一个主指标 + 四个跨领域运营指标；数字均为逐窗口聚合，不含仍在途的调用。"
        id="admin-overview-kpis"
        kicker="关键指标"
        title="运行概况"
      >
        <AdminKpiHero
          label="账号总数"
          scope={`统计窗口：${ADMIN_WINDOW_LABELS[data.window]}`}
          value={formatAdminCount(data.users.total)}
        />
        <AdminMetricGrid>
          <AdminMetric
            label="窗口内活跃"
            value={formatAdminCount(data.users.activeInWindow)}
          />
          <AdminMetric label="AI 调用" value={formatAdminCount(data.ai.calls)} />
          <AdminMetric
            hint={
              data.ai.costCoverageRatio === 0
                ? `成本覆盖率 ${formatAdminRatio(
                    data.ai.costCoverageRatio,
                  )} · 无成本样本`
                : `成本覆盖率 ${formatAdminRatio(data.ai.costCoverageRatio)}`
            }
            label="估算成本"
            value={formatCostOrDash(
              data.ai.estimatedCostMicros,
              data.ai.costCoverageRatio,
            )}
          />
          <AdminMetric
            label="已发布内容"
            value={formatAdminCount(totalPublished)}
          />
          <AdminMetric
            hint="全部 diagnostic_events 的当前状态"
            label="待处理诊断"
            tone={data.diagnostics.open > 0 ? "danger" : "default"}
            value={formatAdminCount(data.diagnostics.open)}
          />
        </AdminMetricGrid>
      </AdminPanel>

      <div className="admin-grid admin-grid--2">
        <AdminPanel
          description="其余账号事实；账号总数与窗口活跃度见上方主指标。"
          id="admin-overview-users"
          title="用户"
        >
          <dl className="admin-facts">
            <div>
              <dt>窗口内新增</dt>
              <dd>{formatAdminCount(data.users.newInWindow)}</dd>
            </div>
            <div>
              <dt>已停用</dt>
              <dd>{formatAdminCount(data.users.suspended)}</dd>
            </div>
            <div>
              <dt>所有者</dt>
              <dd>{formatAdminCount(data.users.owners)}</dd>
            </div>
          </dl>
          <Link className="admin-text-link" href="/admin/users">
            打开用户管理
            <AdminIcon name="arrow-right" />
          </Link>
        </AdminPanel>

        <AdminPanel
          description="诊断事件只展示类型、严重度与状态；不展示事件 metadata。"
          id="admin-overview-diagnostics"
          title="安全与诊断"
        >
          <dl className="admin-facts">
            <div>
              <dt>已确认</dt>
              <dd>{formatAdminCount(data.diagnostics.acknowledged)}</dd>
            </div>
            <div>
              <dt>窗口内告警</dt>
              <dd>{formatAdminCount(data.diagnostics.alertsInWindow)}</dd>
            </div>
            <div>
              <dt>Storage 清理失败</dt>
              <dd
                className={
                  data.diagnostics.storageCleanupFailed > 0
                    ? "admin-value--danger"
                    : undefined
                }
              >
                {formatAdminCount(data.diagnostics.storageCleanupFailed)}
              </dd>
            </div>
          </dl>
          <div className="admin-actions">
            <Link className="admin-button admin-button--small" href="/admin/diagnostics">
              查看诊断事件
            </Link>
            <Link className="admin-button admin-button--small" href="/admin/audit">
              查看审计日志
            </Link>
          </div>
        </AdminPanel>
      </div>

      <AdminPanel
        description="发布量按当前可发布版本计数，候选按处理状态分桶；自动采集最多推进到候选审核库。"
        id="admin-overview-content"
        title="内容与采集"
      >
        <dl className="admin-facts">
          <div>
            <dt>已发布文章</dt>
            <dd>{formatAdminCount(data.content.published.articles)}</dd>
          </div>
          <div>
            <dt>已发布视频</dt>
            <dd>{formatAdminCount(data.content.published.videos)}</dd>
          </div>
          <div>
            <dt>已发布播客</dt>
            <dd>{formatAdminCount(data.content.published.podcasts)}</dd>
          </div>
          <div>
            <dt>窗口内采集运行</dt>
            <dd>
              {formatAdminCount(data.acquisition.runsInWindow)} 次 · 失败{" "}
              {formatAdminCount(data.acquisition.failedRuns)} · 疑似卡住{" "}
              {formatAdminCount(data.acquisition.runningStale)}
            </dd>
          </div>
          <div>
            <dt>最近采集运行</dt>
            <dd>{formatAdminDateTime(data.acquisition.lastRunAt)}</dd>
          </div>
        </dl>
        <div>
          <p className="admin-subtitle">候选漏斗</p>
          {hasCandidates ? (
            <AdminBarList
              caption={`单位：条 · 条宽按本窗口最大值 ${formatAdminCount(
                maxCandidate,
              )} 条归一；数值同时以文本给出。`}
              label="候选漏斗"
              rows={candidateRows.map((row) => ({
                label: row.label,
                value: formatAdminCount(row.value),
                percent: Math.min(100, (row.value / maxCandidate) * 100),
                tone: row.tone,
              }))}
            />
          ) : (
            <AdminEmpty
              description="自动采集还没有把素材推进到候选审核库。"
              icon="content"
              title="当前窗口没有候选记录"
            />
          )}
        </div>
        <div className="admin-actions">
          <Link className="admin-button admin-button--small" href="/admin/content">
            内容与采集健康
          </Link>
          <Link className="admin-button admin-button--small" href="/me/content-workflow">
            去内容工作流审核候选
            <AdminIcon name="external" />
          </Link>
        </div>
      </AdminPanel>

      <AdminPanel
        description="失败率 = 失败 /（成功 + 失败 + 取消），不含仍在途的调用；延迟分位数只统计成功调用。"
        id="admin-overview-ai"
        title="AI 用量与估算成本"
      >
        <dl className="admin-facts">
          <div>
            <dt>失败调用</dt>
            <dd className={data.ai.failedCalls > 0 ? "admin-value--danger" : undefined}>
              {formatAdminCount(data.ai.failedCalls)}
            </dd>
          </div>
          <div>
            <dt>失败率</dt>
            <dd>{formatAdminRatio(data.ai.failureRate)}</dd>
          </div>
          <div>
            <dt>p50 延迟</dt>
            <dd>{formatAdminLatency(data.ai.p50LatencyMs)}</dd>
          </div>
          <div>
            <dt>p95 延迟</dt>
            <dd>{formatAdminLatency(data.ai.p95LatencyMs)}</dd>
          </div>
          <div>
            <dt>无成本记录的调用</dt>
            <dd className={data.ai.costUnknownCalls > 0 ? "admin-value--warning" : undefined}>
              {formatAdminCount(data.ai.costUnknownCalls)}
            </dd>
          </div>
        </dl>
        {data.ai.byProviderType.length > 0 ? (
          <div>
            <p className="admin-subtitle">按调用类型</p>
            <AdminBarList
              caption={`单位：次 · 条宽按本窗口最大值 ${formatAdminCount(
                maxProviderCalls,
              )} 次归一；成本与失败数同时以文本给出。`}
              label="按调用类型的使用量"
              rows={data.ai.byProviderType.map((row) => ({
                label: providerTypeLabel(row.providerType),
                value: `${formatAdminCount(row.calls)} 次 · ${formatCostOrDash(
                  row.costMicros,
                  data.ai.costCoverageRatio,
                )}`,
                percent: Math.min(100, (row.calls / maxProviderCalls) * 100),
                hint: `失败 ${formatAdminCount(row.failed)} 次`,
              }))}
            />
          </div>
        ) : (
          <p className="admin-muted">当前窗口没有已埋点的 AI 调用记录。</p>
        )}

        <h3 className="admin-subtitle">最近失败错误 Top</h3>
        {recentErrorTypes === null ? (
          <p className="admin-muted">
            错误类型明细暂时不可用，可在{" "}
            <Link className="admin-text-link" href="/admin/ai-usage">
              AI 用量页
            </Link>{" "}
            查看完整聚合。
          </p>
        ) : recentErrorTypes.length === 0 ? (
          <p className="admin-muted">当前窗口没有失败调用。</p>
        ) : (
          <ol aria-label="最近失败错误 Top" className="admin-rank-list">
            {recentErrorTypes.slice(0, 5).map((error) => (
              <li key={error.errorType}>
                <code className="admin-code">{error.errorType}</code>
                <span>{formatAdminCount(error.count)}</span>
              </li>
            ))}
          </ol>
        )}

        <AdminNote>
          成本只覆盖已写入 <code>provider_calls</code> 且带估算成本的调用；TTS、STT
          与转写当前未埋点，因此覆盖率不会达到 100%。
        </AdminNote>
        <p className="admin-muted">
          逐日趋势与按供应商聚合见{" "}
          <Link className="admin-text-link" href="/admin/ai-usage">
            AI 用量页
          </Link>
          。
        </p>
      </AdminPanel>
    </div>
  );
}
