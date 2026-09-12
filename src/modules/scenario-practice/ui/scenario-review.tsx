"use client";

import { useState } from "react";

import type { ScenarioReviewDto } from "../application/build-scenario-review";

function variantLabel(kind: string, value?: string) {
  const label = kind === "character" ? "更换人物" : kind === "location" ? "更换地点" : kind === "expression-slot" ? "更换表达槽位" : "加入新的条件";
  return value ? `${label}：${value}` : label;
}

export function ScenarioReview({ review }: Readonly<{ review: ScenarioReviewDto }>) {
  const [markedOnly, setMarkedOnly] = useState(false);
  const visibleTurns = markedOnly ? review.turns.filter((turn) => turn.marked) : review.turns;
  const marked = review.turns.filter((turn) => turn.marked);
  const alternatives = marked.flatMap((turn) => turn.review?.naturalAlternatives ?? []);
  const practiceHref = review.scenarioKey ? `/explore/scenarios/${encodeURIComponent(review.scenarioKey)}/practice` : "/explore";

  return <main className="scenario-review page-stack">
    <a className="scenario-back-link" href="/explore/history">← 返回练习历史</a>
    <header><p className="eyebrow">练习复盘</p><h1>{review.title}</h1><p>{review.communicationGoal}</p></header>

    <section className="scenario-review__outcome" aria-labelledby="review-outcome"><h2 id="review-outcome">沟通结果</h2><p>{review.communication.successful} 次达成目的，{review.communication.needsWork} 次可以更清楚{review.communication.pending ? `，${review.communication.pending} 次反馈待补充；待补充不会产生负面能力记录` : ""}。</p></section>

    <section className="scenario-review__transcript" aria-labelledby="review-transcript">
      <div className="scenario-review__section-heading"><h2 id="review-transcript">完整对话</h2><button type="button" aria-pressed={markedOnly} onClick={() => setMarkedOnly((current) => !current)}>{markedOnly ? "查看全部" : "只看标记"}</button></div>
      {visibleTurns.length ? visibleTurns.map((turn) => <article key={turn.id} className={`scenario-review-turn scenario-review-turn--${turn.speaker}`}><small>{turn.speaker === "user" ? "你" : turn.speaker === "condition" ? "条件变化" : review.characterName}</small><p lang={turn.speaker === "condition" ? "zh-CN" : "es"}>{turn.text}</p>{turn.speaker === "user" && turn.review?.status !== "ready" ? <p className="scenario-review__neutral">反馈待补充；原句已保留，不形成负面记录。</p> : null}</article>) : <p>当前没有带标记的轮次。</p>}
    </section>

    <div className="scenario-review__details">
      <details><summary>错误详情 <span>{marked.length}</span></summary><div>{marked.length ? marked.map((turn) => <article key={turn.id} className="scenario-review-detail">{turn.review?.errorSpans.map((span, index) => <p key={index}>{typeof span.explanation === "string" ? span.explanation : "这一处可以表达得更清楚。"}{span.affectsUnderstanding === true ? " 这会影响理解。" : " 这不影响主要理解。"}</p>)}</article>) : <p>当前没有需要标记的问题。</p>}</div></details>
      <details><summary>自然替代表达 <span>{alternatives.length}</span></summary><div>{alternatives.length ? <ul>{alternatives.map((text, index) => <li key={`${text}-${index}`} lang="es">{text}</li>)}</ul> : <p>不要求匹配唯一参考句；当前原句已经自然可理解。</p>}</div></details>
      <details><summary>重新说</summary><div>{marked.length ? marked.map((turn) => <a className="secondary-action" key={turn.id} href={`${practiceHref}?sourceSessionId=${encodeURIComponent(review.sessionId)}&retryTurnId=${encodeURIComponent(turn.id)}`}>重新说这一句</a>) : <a className="secondary-action" href={practiceHref}>换一种说法再练一次</a>}</div></details>
      <details><summary>复现计划</summary><div>{review.nextRepetition ? <><p><time dateTime={review.nextRepetition.dueAt.toISOString()}>{review.nextRepetition.intervalDays === 0 ? "今天" : `${review.nextRepetition.intervalDays} 天后`}</time>，在变化后的条件中重新完成同一沟通目标。</p><ul>{review.nextRepetition.variantRequirements.map((item, index) => <li key={index}>{variantLabel(item.kind, item.value)}</li>)}</ul><a className="primary-action" href={`/learn/repetitions/${encodeURIComponent(review.nextRepetition.id)}`}>查看复现任务</a></> : <p>本次复现计划已全部完成。</p>}</div></details>
    </div>
  </main>;
}
