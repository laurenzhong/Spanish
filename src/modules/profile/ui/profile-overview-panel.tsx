"use client";

import { useEffect, useMemo, useState } from "react";

import {
  PROFILE_AXIS_DEFINITIONS,
  profileOverviewSchema,
  type ProfileAxis,
  type ProfileOverview,
} from "@/src/modules/profile/domain";
import { SurfaceState } from "@/src/shared/ui/surface-state";

const statusLabels: Record<ProfileAxis["status"], string> = {
  "data-insufficient": "数据不足",
  accumulating: "积累中",
  developing: "建立中",
  verified: "已验证",
};

const statusDescriptions: Record<ProfileAxis["status"], string> = {
  "data-insufficient": "完成几次相关表达后，这里会出现可追溯状态。",
  accumulating: "证据还在积累，当前状态不代表能力上限。",
  developing: "已有可用证据，还需要陌生变体继续验证。",
  verified: "掌握度与证据可信度都达到当前验证门槛。",
};

function emptyOverview(): ProfileOverview {
  return {
    axes: PROFILE_AXIS_DEFINITIONS.map((definition) => ({
      confidence: null,
      description: definition.description,
      evidenceCount: 0,
      key: definition.key,
      label: definition.label,
      lastEvidenceAt: null,
      mastery: null,
      oralCoverage: null,
      previousMastery: null,
      previousConfidence: null,
      representativeAttempts: [],
      skillKeys: [],
      status: "data-insufficient",
    })),
    generatedAt: new Date(0).toISOString(),
    summary: { totalAxes: 8, totalEvidence: 0, verifiedAxes: 0 },
  };
}

function formatPercent(value: number | null): string {
  return value === null ? "待验证" : `${Math.round(value * 100)}%`;
}

function axisPoints(
  axes: readonly ProfileAxis[],
  radius: number,
  value: (axis: ProfileAxis) => number | null = (axis) => axis.mastery,
): string {
  const center = 50;
  return axes
    .map((axis, index) => {
      const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
      const mastery = value(axis) ?? 0;
      return `${center + Math.cos(angle) * radius * mastery},${center + Math.sin(angle) * radius * mastery}`;
    })
    .join(" ");
}

async function fetchProfileOverview(): Promise<ProfileOverview> {
  const response = await fetch("/api/v1/profile", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("profile-request-failed");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("profile-response-invalid");
  }
  return profileOverviewSchema.parse(payload.data);
}

function RadarGraphic({ axes }: Readonly<{ axes: readonly ProfileAxis[] }>) {
  const complete = axes.every((axis) => axis.mastery !== null);
  const previousComplete = axes.every((axis) => axis.previousMastery !== null);
  const rings = [20, 35, 50];

  return (
    <div className="profile-radar" data-complete={complete}>
      <svg
        aria-label={
          complete
            ? "八维能力掌握度图"
            : "八维能力图，证据不足时不绘制完整能力轮廓"
        }
        role="img"
        viewBox="0 0 100 100"
      >
        {rings.map((radius) => (
          <polygon
            className="profile-radar__ring"
            key={radius}
            points={axisPoints(axes.map((axis) => ({ ...axis, mastery: 1 })), radius)}
          />
        ))}
        {axes.map((axis, index) => {
          const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
          return (
            <line
              className="profile-radar__spoke"
              key={axis.key}
              x1="50"
              x2={50 + Math.cos(angle) * 50}
              y1="50"
              y2={50 + Math.sin(angle) * 50}
            />
          );
        })}
        {previousComplete ? (
          <polygon
            className="profile-radar__area profile-radar__area--previous"
            points={axisPoints(axes, 50, (axis) => axis.previousMastery)}
          />
        ) : null}
        {complete ? (
          <polygon className="profile-radar__area" points={axisPoints(axes, 50)} />
        ) : null}
      </svg>
      <div className="profile-radar__caption">
        {complete && previousComplete ? "当前掌握度 · 虚线为四周前" : complete ? "当前掌握度" : "证据积累后显示能力轮廓"}
      </div>
    </div>
  );
}

export function ProfileOverviewPanel() {
  const [overview, setOverview] = useState<ProfileOverview>(emptyOverview);
  const [selectedKey, setSelectedKey] = useState(PROFILE_AXIS_DEFINITIONS[0].key);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function loadOverview() {
    setLoading(true);
    setError(false);
    try {
      setOverview(await fetchProfileOverview());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchProfileOverview()
      .then((nextOverview) => {
        if (!active) return;
        setOverview(nextOverview);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedAxis = useMemo(
    () => overview.axes.find((axis) => axis.key === selectedKey) ?? overview.axes[0],
    [overview.axes, selectedKey],
  );

  if (loading) {
    return (
      <div className="profile-dashboard" data-testid="profile-overview-loading">
        <SurfaceState state="loading" description="正在读取你的能力证据。" />
      </div>
    );
  }

  return (
    <div className="profile-dashboard" data-testid="profile-overview">
      {error ? (
        <div className="profile-data-warning" role="alert">
          <span>暂时无法读取最新能力证据，当前只显示空状态。</span>
          <button onClick={() => void loadOverview()} type="button">重试</button>
        </div>
      ) : null}
      <section className="profile-dashboard__summary" aria-label="能力总览摘要">
        <div>
          <p className="eyebrow eyebrow--accent">能力总览</p>
          <h2>看见哪些能力已经有证据</h2>
          <p>掌握程度、可信度和口语覆盖分开显示，不把学习时长算进能力。</p>
        </div>
        <div className="profile-dashboard__stats">
          <div>
            <strong>{overview.summary.verifiedAxes} / {overview.summary.totalAxes}</strong>
            <span>已验证维度</span>
          </div>
          <div>
            <strong>{overview.summary.totalEvidence}</strong>
            <span>有效证据</span>
          </div>
          <div>
            <strong>{overview.axes.filter((axis) => axis.oralCoverage !== null && axis.oralCoverage > 0).length}</strong>
            <span>有口语覆盖</span>
          </div>
        </div>
      </section>

      <section className="profile-dashboard__overview" aria-labelledby="profile-axis-title">
        <div className="profile-dashboard__chart">
          <div className="section-heading">
            <div>
              <p className="eyebrow eyebrow--accent">八维能力</p>
              <h2 id="profile-axis-title">当前能力轮廓</h2>
            </div>
            <span>不使用总分</span>
          </div>
          <RadarGraphic axes={overview.axes} />
        </div>

        <div className="profile-axis-list" aria-label="八维能力选择">
          {overview.axes.map((axis) => (
            <button
              aria-pressed={axis.key === selectedKey}
              className={`profile-axis-row ${axis.key === selectedKey ? "is-selected" : ""}`}
              key={axis.key}
              onClick={() => setSelectedKey(axis.key)}
              type="button"
            >
              <span className="profile-axis-row__label">{axis.label}</span>
              <span className="profile-axis-row__track" aria-hidden="true">
                <i style={{ width: `${axis.mastery === null ? 0 : Math.round(axis.mastery * 100)}%` }} />
              </span>
              <span className={`profile-axis-row__status profile-axis-row__status--${axis.status}`}>
                {axis.mastery === null ? statusLabels[axis.status] : formatPercent(axis.mastery)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {selectedAxis ? (
        <section className="profile-axis-detail" aria-live="polite" aria-labelledby="profile-axis-detail-title">
          <div>
            <p className="eyebrow eyebrow--accent">维度详情</p>
            <h2 id="profile-axis-detail-title">{selectedAxis.label}</h2>
            <p>{selectedAxis.description}</p>
          </div>
          <div className="profile-axis-detail__metrics">
            <div><span>掌握程度</span><strong>{formatPercent(selectedAxis.mastery)}</strong></div>
            <div><span>四周前</span><strong>{formatPercent(selectedAxis.previousMastery)}</strong></div>
            <div><span>证据可信度</span><strong>{formatPercent(selectedAxis.confidence)}</strong></div>
            <div><span>口语覆盖</span><strong>{formatPercent(selectedAxis.oralCoverage)}</strong></div>
            <div><span>有效证据</span><strong>{selectedAxis.evidenceCount || "待积累"}</strong></div>
          </div>
          <p className="profile-axis-detail__status">
            <span className={`status-dot status-dot--${selectedAxis.status}`} aria-hidden="true" />
            {statusLabels[selectedAxis.status]} · {statusDescriptions[selectedAxis.status]}
          </p>
          <div className="profile-axis-detail__attempts">
            <h3>代表性尝试</h3>
            {selectedAxis.representativeAttempts.length > 0 ? (
              <ul>
                {selectedAxis.representativeAttempts.map((attempt, index) => (
                  <li key={`${attempt.occurredAt}:${attempt.modality}:${index}`}>
                    <time dateTime={attempt.occurredAt}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(attempt.occurredAt))}</time>
                    <span>{attempt.modality === "speech" ? "自主开口" : attempt.modality === "typing" ? "自主打字" : attempt.modality === "listening" ? "听力活动" : "阅读活动"}</span>
                    <span>{attempt.sceneLabel ?? "未标注场景"}</span>
                    <span>{attempt.hintLevel === null ? "无提示记录" : attempt.hintLevel === 0 ? "独立完成" : `使用 ${attempt.hintLevel} 级提示`}</span>
                  </li>
                ))}
              </ul>
            ) : <p>完成可追溯表达后，这里会显示代表性尝试。</p>}
          </div>
        </section>
      ) : null}

      <section className="profile-axis-table" aria-labelledby="profile-axis-table-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow--accent">可追溯明细</p>
            <h2 id="profile-axis-table-title">每个维度的证据状态</h2>
          </div>
        </div>
        <div className="profile-axis-table__scroll">
          <table>
            <thead><tr><th>能力维度</th><th>掌握度</th><th>四周前</th><th>可信度</th><th>口语覆盖</th><th>证据</th><th>状态</th></tr></thead>
            <tbody>
              {overview.axes.map((axis) => (
                <tr key={axis.key}>
                  <th scope="row"><button type="button" onClick={() => setSelectedKey(axis.key)}>{axis.label}</button></th>
                  <td>{formatPercent(axis.mastery)}</td>
                  <td>{formatPercent(axis.previousMastery)}</td>
                  <td>{formatPercent(axis.confidence)}</td>
                  <td>{formatPercent(axis.oralCoverage)}</td>
                  <td>{axis.evidenceCount || "—"}</td>
                  <td><span className={`table-status table-status--${axis.status}`}>{statusLabels[axis.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
