"use client";

import Link from "next/link";

import type { AdminContentHealthDataDto } from "../schemas/admin-console";
import type { AdminWindowLink } from "./overview-panel";
import {
  ADMIN_CANDIDATE_STATUS_LABELS,
  ADMIN_WINDOW_LABELS,
  formatAdminCount,
  formatAdminDateTime,
} from "./format";
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
} from "./admin-primitives";

type AdminContentHealthPanelProps = Readonly<{
  data: AdminContentHealthDataDto;
  windowLinks: readonly AdminWindowLink[];
}>;

/**
 * Content and acquisition health (`/admin/content`).
 *
 * Read-only snapshot of acquisition runs, the candidate funnel, review backlog,
 * published counts, media asset health and corpus freshness. Candidate review
 * still happens in the owner content workflow; this page never publishes,
 * unpublishes or repairs anything.
 */
export function AdminContentHealthPanel({
  data,
  windowLinks,
}: AdminContentHealthPanelProps) {
  const candidateRows = (
    [
      "discovered",
      "screened",
      "acquiring",
      "processing",
      "review_ready",
      "failed",
      "rejected",
    ] as const
  ).map((status) => ({
    status,
    label: ADMIN_CANDIDATE_STATUS_LABELS[status],
    value:
      status === "discovered"
        ? data.candidates.discovered
        : status === "screened"
          ? data.candidates.screened
          : status === "acquiring"
            ? data.candidates.acquiring
            : status === "processing"
              ? data.candidates.processing
              : status === "review_ready"
                ? data.candidates.reviewReady
                : status === "failed"
                  ? data.candidates.failed
                  : data.candidates.rejected,
  }));
  const maxCandidate = Math.max(1, ...candidateRows.map((row) => row.value));
  const mediaChecks = [
    ["缺词级时间轴", data.media.missingWordTimeline],
    ["缺中文翻译", data.media.missingChineseTranslation],
    ["缺可用播放资产", data.media.missingPlayableAsset],
    ["播放资产过期", data.media.expiredPlaybackAsset],
    ["缺封面", data.media.missingArtwork],
    ["版权未清", data.media.copyrightNotCleared],
    ["字幕回填待处理", data.media.transcriptBackfillPending],
  ] as const;
  const mediaIssues = mediaChecks.reduce((total, [, value]) => total + value, 0);

  return (
    <div className="admin-page">
      <AdminPageHeader
        aside={
          <AdminBadge dot tone={mediaIssues > 0 ? "warning" : "positive"}>
            媒体待处理项 {formatAdminCount(mediaIssues)}
          </AdminBadge>
        }
        description="只读快照：采集运行来自 acquisition_runs，候选来自处理状态，媒体健康按当前已发布版本统计。这里不发布、不撤下也不修复内容。"
        kicker="内容与采集"
        title="采集运行、候选与媒体健康"
      />

      <div className="admin-context-row">
        <AdminSegmented label="统计时间窗口" items={windowLinks} />
        <p className="admin-page__meta" role="note">
          窗口 {ADMIN_WINDOW_LABELS[data.window]} · {formatAdminDateTime(data.from)} →{" "}
          {formatAdminDateTime(data.to)} · 生成时间 {formatAdminDateTime(data.generatedAt)}
        </p>
      </div>

      <AdminPanel
        className="admin-panel--hero"
        description="只使用 acquisition_runs；content_pipeline_runs/steps 是尚未写入的预留表，因此不展示。"
        id="admin-content-acquisition"
        title="采集运行"
      >
        <AdminKpiHero
          label="窗口内运行"
          scope={`统计窗口：${ADMIN_WINDOW_LABELS[data.window]}`}
          value={formatAdminCount(data.acquisition.runsInWindow)}
        />
        <AdminMetricGrid>
          <AdminMetric label="成功" value={formatAdminCount(data.acquisition.succeededRuns)} />
          <AdminMetric
            label="失败"
            tone={data.acquisition.failedRuns > 0 ? "danger" : "default"}
            value={formatAdminCount(data.acquisition.failedRuns)}
          />
          <AdminMetric label="取消" value={formatAdminCount(data.acquisition.cancelledRuns)} />
          <AdminMetric label="进行中" value={formatAdminCount(data.acquisition.runningRuns)} />
          <AdminMetric
            hint="运行超时仍标记为 running"
            label="疑似卡住"
            tone={data.acquisition.runningStale > 0 ? "warning" : "default"}
            value={formatAdminCount(data.acquisition.runningStale)}
          />
        </AdminMetricGrid>
        <dl className="admin-facts">
          <div>
            <dt>最近运行</dt>
            <dd>{formatAdminDateTime(data.acquisition.lastRunAt)}</dd>
          </div>
          <div>
            <dt>新增条目（窗口）</dt>
            <dd>{formatAdminCount(data.acquisition.insertedCountInWindow)}</dd>
          </div>
          <div>
            <dt>重复条目（窗口）</dt>
            <dd>{formatAdminCount(data.acquisition.duplicateCountInWindow)}</dd>
          </div>
        </dl>
        <AdminNote>
          采集失败原因码暂时没有进入监管读模型（当前只有运行计数）；失败运行需要到运行日志排查。
        </AdminNote>
      </AdminPanel>

      <AdminPanel
        aside={
          <AdminBadge
            dot
            tone={data.reviewBacklog > 0 ? "warning" : "positive"}
          >
            审核积压 {formatAdminCount(data.reviewBacklog)}
          </AdminBadge>
        }
        description="自动采集最多把素材推进到候选审核库；发布仍需要在内容工作流中显式完成双维度审核。"
        id="admin-content-candidates"
        title="候选漏斗"
      >
        {candidateRows.some((row) => row.value > 0) ? (
          <AdminBarList
            caption={`单位：条 · 条宽按本窗口最大值 ${formatAdminCount(maxCandidate)} 归一；状态名称与数值同时以文本给出。`}
            label="候选状态分布"
            rows={candidateRows.map((row) => ({
              label: row.label,
              value: formatAdminCount(row.value),
              percent: Math.min(100, (row.value / maxCandidate) * 100),
              tone: row.status === "failed" ? "danger" : "info",
            }))}
          />
        ) : (
          <AdminEmpty
            description="自动采集还没有把素材推进到候选审核库。"
            icon="content"
            title="当前窗口没有候选记录"
          />
        )}
        <dl className="admin-facts">
          <div>
            <dt>候选总数</dt>
            <dd>{formatAdminCount(data.candidates.total)}</dd>
          </div>
        </dl>
        <p className="admin-muted">
          候选审核与发布入口在{" "}
          <Link className="admin-text-link" href="/me/content-workflow">
            内容工作流
          </Link>
          （候选审核仍在那里完成）。
        </p>
      </AdminPanel>

      <div className="admin-grid admin-grid--3">
        <AdminPanel
          aside={
            <AdminBadge className="admin-badge--count">
              共 {formatAdminCount(
                data.published.articles + data.published.videos + data.published.podcasts,
              )}{" "}
              项
            </AdminBadge>
          }
          id="admin-content-published"
          title="发布量（当前可发布版本）"
        >
          <dl className="admin-facts">
            <div>
              <dt>文章</dt>
              <dd>{formatAdminCount(data.published.articles)}</dd>
            </div>
            <div>
              <dt>视频</dt>
              <dd>{formatAdminCount(data.published.videos)}</dd>
            </div>
            <div>
              <dt>播客</dt>
              <dd>{formatAdminCount(data.published.podcasts)}</dd>
            </div>
          </dl>
        </AdminPanel>

        <AdminPanel
          aside={
            <AdminBadge className="admin-badge--count">
              已发布版本 {formatAdminCount(data.media.publishedVersions)}
            </AdminBadge>
          }
          description="只读缺口计数；修复动作不在监管后台提供。"
          id="admin-content-media"
          title="媒体资产健康"
        >
          <ul className="admin-checklist">
            {mediaChecks.map(([label, value]) => {
              const passed = value === 0;
              return (
                <li data-passed={passed ? "true" : "false"} key={label}>
                  <span aria-hidden="true" className="admin-checklist__icon">
                    <AdminIcon name={passed ? "check" : "alert"} />
                  </span>
                  <span className="admin-checklist__label">{label}</span>
                  <AdminBadge dot tone={passed ? "positive" : "warning"}>
                    {passed ? "通过" : `缺失 ${formatAdminCount(value)}`}
                  </AdminBadge>
                </li>
              );
            })}
          </ul>
        </AdminPanel>

        <AdminPanel id="admin-content-corpus" title="语料新鲜度">
          <dl className="admin-facts">
            <div>
              <dt>语料出现次数</dt>
              <dd>{formatAdminCount(data.corpus.occurrences)}</dd>
            </div>
            <div>
              <dt>窗口内新增</dt>
              <dd>{formatAdminCount(data.corpus.occurrencesInWindow)}</dd>
            </div>
            <div>
              <dt>最近索引时间</dt>
              <dd>{formatAdminDateTime(data.corpus.lastIndexedAt)}</dd>
            </div>
          </dl>
        </AdminPanel>
      </div>
    </div>
  );
}
