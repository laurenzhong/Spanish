"use client";

import { useMemo, useState } from "react";

import type { CapabilityGroup, FourCapabilityOverview } from "../domain";

const statusLabels: Record<CapabilityGroup["status"], string> = {
  "data-insufficient": "数据不足",
  accumulating: "积累中",
  developing: "建立中",
  verified: "已验证",
};

function percent(value: number | null): string {
  return value === null ? "待验证" : `${Math.round(value * 100)}%`;
}

function modalityLabel(value: CapabilityGroup["representativeAttempts"][number]["modality"]): string {
  return value === "speech" ? "自主开口" : value === "typing" ? "文字表达" : value === "listening" ? "听力活动" : "阅读活动";
}

export function FourCapabilityPanel({ overview }: Readonly<{ overview: FourCapabilityOverview }>) {
  // The progress page leads with the newly gained real ability (design
  // 2026-08-20 §11.1), so open the detail on the first group that actually has
  // evidence instead of always starting on an empty group.
  const [selectedKey, setSelectedKey] = useState<CapabilityGroup["key"]>(
    () => overview.capabilityGroups.find((group) => group.evidenceCount > 0)?.key ?? overview.capabilityGroups[0].key,
  );
  const selected = useMemo(() => overview.capabilityGroups.find((group) => group.key === selectedKey) ?? overview.capabilityGroups[0], [overview.capabilityGroups, selectedKey]);
  const hasEvidence = overview.summary.totalEvidence > 0;

  return <div className="profile-dashboard profile-dashboard--capabilities" data-testid="profile-overview">
    <section className="capability-summary" aria-label="四板块能力摘要">
      <div className="capability-summary__copy"><p className="eyebrow eyebrow--accent">能力概览</p><h2>{hasEvidence ? "正在建立的能力" : "还没有能力证据"}</h2></div>
      <div className="capability-summary__stats"><div><strong>{overview.summary.verifiedGroups} / 4</strong><span>已验证板块</span></div><div><strong>{overview.summary.totalEvidence}</strong><span>能力证据</span></div><div><strong>{overview.capabilityGroups.filter((group) => group.oralCoverage !== null && group.oralCoverage > 0).length}</strong><span>有口语覆盖</span></div></div>
    </section>
    <section className="capability-groups" aria-label="四板块能力">
      {overview.capabilityGroups.map((group) => <button type="button" key={group.key} className={`capability-group ${group.key === selected.key ? "is-selected" : ""}`} aria-pressed={group.key === selected.key} onClick={() => setSelectedKey(group.key)}>
        <span className="capability-group__label">{group.label}</span><span className="capability-group__status">{statusLabels[group.status]}</span><span className="capability-group__track" aria-hidden="true"><i style={{ width: `${group.mastery === null ? 0 : Math.round(group.mastery * 100)}%` }} /></span><span className="capability-group__metrics"><b>{percent(group.mastery)}</b><small>掌握度</small><b>{percent(group.confidence)}</b><small>可信度</small></span>
      </button>)}
    </section>
    <section className="capability-detail" aria-live="polite" aria-labelledby="capability-detail-title">
      <div className="capability-detail__heading"><div><p className="eyebrow eyebrow--accent">板块详情</p><h2 id="capability-detail-title">{selected.label}</h2></div><span className={`profile-axis-row__status profile-axis-row__status--${selected.status}`}>{statusLabels[selected.status]}</span></div>
      <div className="capability-detail__metrics"><div><span>掌握度</span><strong>{percent(selected.mastery)}</strong></div><div><span>证据可信度</span><strong>{percent(selected.confidence)}</strong></div><div><span>口语覆盖</span><strong>{percent(selected.oralCoverage)}</strong></div><div><span>证据数量</span><strong>{selected.evidenceCount || "待积累"}</strong></div><div><span>四周前</span><strong>{percent(selected.previousMastery)}</strong></div></div>
      {selected.skills.length > 0 ? <details className="capability-detail__disclosure"><summary>查看子技能</summary><div className="capability-detail__skills"><ul>{selected.skills.map((skill) => <li key={skill.key}><span>{skill.key}</span><b>{percent(skill.mastery)}</b><small>{skill.evidenceCount} 条证据</small></li>)}</ul></div></details> : null}
      <details className="capability-detail__disclosure" open={selected.representativeAttempts.length > 0}><summary>代表性尝试 <span>{selected.representativeAttempts.length || "—"}</span></summary><div className="capability-detail__attempts">{selected.representativeAttempts.length > 0 ? <ul>{selected.representativeAttempts.map((attempt, index) => <li key={`${attempt.occurredAt}:${index}`}><time dateTime={attempt.occurredAt}>{new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(attempt.occurredAt))}</time><span>{modalityLabel(attempt.modality)}</span><span>{attempt.sceneLabel ?? "未标注场景"}</span><span>{attempt.hintLevel ? `提示 ${attempt.hintLevel}` : "独立完成"}</span></li>)}</ul> : <p>完成可追溯表达后，这里会显示。</p>}</div></details>
    </section>
  </div>;
}
