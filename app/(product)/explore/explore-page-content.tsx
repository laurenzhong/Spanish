"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ExploreCardDto, ExploreDashboardDto, ExploreGoalDto } from "@/src/modules/explore/domain";

type ExplorePageContentProps = Readonly<{ dashboard: ExploreDashboardDto; initialQuery?: string; initialPack?: string | null }>;

const skillLabels: Record<ExploreCardDto["skills"][number], string> = { listen: "听", read: "读", speak: "说", write: "写" };
const statusLabels: Record<ExploreCardDto["status"], string> = { published: "可开始", in_progress: "继续中", draft: "内容整理中", unavailable: "暂不可用" };

function focusForGoal(key: string): string {
  if (key.startsWith("communication.need")) return "needs";
  if (key.startsWith("communication.repair")) return "repair";
  if (key.startsWith("communication.maintain") || key.startsWith("communication.response")) return "maintain";
  return "start";
}

function matches(value: string, query: string): boolean {
  return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function statusCopy(card: ExploreCardDto): string {
  if (card.status === "in_progress" && card.progress) return `已完成 ${card.progress.completedSteps} / ${card.progress.totalSteps} 步`;
  if (card.status === "published") return "准备好从一段场景开始";
  if (card.status === "draft") return "完成审核后开放";
  return "暂时无法读取这组内容";
}

function GoalRow({ goal, index }: Readonly<{ goal: ExploreGoalDto; index: number }>) {
  const content = <><span className="explore-goal-row__marker">{String(index + 1).padStart(2, "0")}</span><span className="explore-goal-row__body"><strong>{goal.title}</strong><span>{goal.description}</span></span><span className={`explore-goal-row__status${goal.status === "published" ? " explore-goal-row__status--open" : ""}`}>{goal.status === "published" ? `${goal.expressionCount} 句` : "整理中"}</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg></>;
  if (goal.status !== "published") return <div className="explore-goal-row explore-goal-row--disabled" aria-label={`${goal.title}，内容整理中`}>{content}</div>;
  return <Link className="explore-goal-row" href={`/learn?focus=${focusForGoal(goal.key)}`}>{content}</Link>;
}

function PackCard({ card, selected, onSelect }: Readonly<{ card: ExploreCardDto; selected: boolean; onSelect: (card: ExploreCardDto) => void }>) {
  const cardContent = <><div className="explore-pack-card__art" aria-hidden="true"><span>{card.status === "draft" ? "IN EDIT" : "SUEÑO"}</span><strong>{card.title.split(" ")[0]}</strong></div><div className="explore-pack-card__body"><div className="explore-pack-card__meta"><span>{card.level}</span><span>{card.skills.map((skill) => skillLabels[skill]).join(" · ") || "内容包"}</span></div><h3>{card.title}</h3><p>{card.summary}</p><div className="explore-pack-card__footer"><span className={`status-note${card.status === "published" || card.status === "in_progress" ? " status-note--open" : ""}`}>{statusLabels[card.status]}</span><span>{statusCopy(card)}</span></div></div></>;
  return <article className={`explore-pack-card${selected ? " is-selected" : ""}`} data-status={card.status}><button type="button" className="explore-pack-card__select" aria-label={`查看${card.title}详情，${statusLabels[card.status]}`} onClick={() => onSelect(card)}>{cardContent}</button></article>;
}

function DetailRail({ card, onClose }: Readonly<{ card: ExploreCardDto; onClose: () => void }>) {
  const actionLabel = card.status === "in_progress" ? "继续这组内容" : "开始这组内容";
  return <aside className="explore-detail-rail" data-testid="explore-detail-rail" aria-label="内容详情"><div className="explore-detail-rail__header"><div><p className="eyebrow eyebrow--accent">内容详情</p><h2>{card.title}</h2></div><button className="icon-button" type="button" aria-label="关闭内容详情" onClick={onClose}>×</button></div><p className="explore-detail-rail__summary">{card.summary}</p><dl className="explore-detail-rail__facts"><div><dt>水平</dt><dd>{card.level}</dd></div><div><dt>时长</dt><dd>{card.durationLabel}</dd></div><div><dt>版本</dt><dd>{card.version}</dd></div><div><dt>技能</dt><dd>{card.skills.map((skill) => skillLabels[skill]).join(" · ") || "—"}</dd></div>{card.source ? <div><dt>来源</dt><dd>{card.source.title}</dd></div> : null}</dl><div className="explore-detail-rail__status" role="status"><span className={`status-note${card.status === "published" || card.status === "in_progress" ? " status-note--open" : ""}`}>{statusLabels[card.status]}</span><p>{statusCopy(card)}</p></div>{card.route ? <Link className="primary-action explore-detail-rail__action" href={card.route}><span>{actionLabel}</span><span aria-hidden="true">→</span></Link> : <p className="explore-detail-rail__blocked">这组内容完成审核后会出现在这里。</p>}</aside>;
}

export function ExplorePageContent({ dashboard, initialQuery = "", initialPack = null }: ExplorePageContentProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialPack);
  const [railOpen, setRailOpen] = useState(Boolean(initialPack));

  const filteredGoals = useMemo(() => dashboard.goals.filter((goal) => matches(`${goal.title} ${goal.description} ${goal.key}`, query.trim())), [dashboard.goals, query]);
  const filteredPacks = useMemo(() => dashboard.packs.filter((card) => matches(`${card.title} ${card.summary} ${card.level}`, query.trim())), [dashboard.packs, query]);
  const selectedCard = dashboard.packs.find((card) => card.stableKey === selectedKey) ?? null;

  function updateUrl(nextQuery: string, nextKey: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (nextQuery) params.set("q", nextQuery); else params.delete("q");
    if (nextKey) params.set("pack", nextKey); else params.delete("pack");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }
  function selectCard(card: ExploreCardDto) { setSelectedKey(card.stableKey); setRailOpen(true); updateUrl(query, card.stableKey); }
  function closeRail() { setRailOpen(false); setSelectedKey(null); updateUrl(query, null); }

  return <div className="page-stack explore-page"><header className="page-header page-header--simple explore-page__header"><div><p className="eyebrow">表达资料库</p><h1>探索真实表达</h1><p>从真实沟通目的出发，不按孤立的语法章节堆叠内容。</p></div><Link className="text-link" href="/learn">回到今天 <span aria-hidden="true">→</span></Link></header><section className="explore-intent" aria-label="按意图查找"><div><p className="eyebrow eyebrow--accent">从哪里开始</p><h2>先找到你现在最想说的话。</h2><p className="explore-intent__helper">输入一句话，我们只会匹配已有的沟通目标，不会把文字发送给 AI。</p></div><label className="explore-intent__field"><span className="sr-only">搜索沟通目标和内容</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); updateUrl(event.target.value, selectedKey); }} placeholder="例如：我想学会请求别人重复" />{query ? <button type="button" aria-label="清除搜索" onClick={() => { setQuery(""); updateUrl("", selectedKey); }}>×</button> : <span aria-hidden="true">⌕</span>}</label></section>{dashboard.resume.length > 0 ? <section className="explore-resume" aria-labelledby="explore-resume-title"><div><p className="eyebrow eyebrow--accent">继续探索</p><h2 id="explore-resume-title">从上次停下的地方回来</h2></div><div className="explore-resume__items">{dashboard.resume.map((card) => <button type="button" className="explore-resume__item" key={card.id} onClick={() => selectCard(card)}><span>{card.title}</span><strong>{statusCopy(card)}</strong><span aria-hidden="true">→</span></button>)}</div></section> : null}<div className="explore-workspace"><main className="explore-main"><section className="explore-goals" aria-labelledby="explore-goals-title"><div className="section-heading"><div><p className="eyebrow eyebrow--accent">沟通目标索引</p><h2 id="explore-goals-title">把交流拆成可以练习的动作</h2></div><span>{filteredGoals.length} / {dashboard.goals.length} 个目标</span></div>{filteredGoals.length > 0 ? <div className="explore-goal-index" aria-label="沟通目标">{filteredGoals.map((goal, index) => <GoalRow goal={goal} index={index} key={goal.key} />)}</div> : <div className="explore-empty" role="status"><strong>没有匹配的目标</strong><span>换一种说法，或先浏览全部沟通动作。</span></div>}</section><section className="explore-packs" aria-labelledby="content-packs-title"><div className="section-heading"><div><p className="eyebrow eyebrow--accent">沉浸内容包</p><h2 id="content-packs-title">从一段完整场景里继续理解</h2></div><span>{filteredPacks.length} 个内容包</span></div>{filteredPacks.length > 0 ? <div className="explore-pack-grid">{filteredPacks.map((card) => <PackCard card={card} selected={selectedKey === card.stableKey} onSelect={selectCard} key={card.id} />)}</div> : <div className="explore-empty" role="status"><strong>暂时没有匹配的内容包</strong><span>清除搜索后查看正在整理的内容。</span></div>}<div className="explore-packs__empty" role="status"><span aria-hidden="true">○</span><p>新的内容包正在审核，先从今天的沟通目标开始。</p><Link className="text-link" href="/learn">回到今天 <span aria-hidden="true">→</span></Link></div></section></main>{railOpen && selectedCard ? <DetailRail card={selectedCard} onClose={closeRail} /> : null}</div></div>;
}
