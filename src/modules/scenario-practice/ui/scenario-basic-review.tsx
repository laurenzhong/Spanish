"use client";

import { useEffect, useState } from "react";

import type { ScenarioPracticeDetail } from "../content";

type SavedPractice = { turns: Array<{ id: string; speaker: string; text: string }>; reviews: Record<string, { contextualSuccess: boolean; errors: Array<{ explanation: string; affectsUnderstanding: boolean; naturalAlternative: string | null }> }> };

export function ScenarioBasicReview({ scenario }: Readonly<{ scenario: ScenarioPracticeDetail }>) {
  const [practice, setPractice] = useState<SavedPractice | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const raw = localStorage.getItem(`scenario-practice:v1:${scenario.stableKey}`); setPractice(raw ? JSON.parse(raw) as SavedPractice : null); } catch { setPractice(null); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scenario.stableKey]);
  if (!practice) return <main className="scenario-review page-stack"><h1>还没有可复盘的练习</h1><a className="primary-action" href={`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}/practice`}>开始实战</a></main>;
  const userTurns = practice.turns.filter((turn) => turn.speaker === "user");
  const successes = userTurns.filter((turn) => practice.reviews[turn.id]?.contextualSuccess).length;
  return <main className="scenario-review page-stack">
    <a className="scenario-back-link" href={`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}`}>← 返回场景</a>
    <header><p className="eyebrow">基础复盘</p><h1>{scenario.title}</h1><p>完成 {userTurns.length} 次表达{Object.keys(practice.reviews).length ? `，其中 ${successes} 次达成交际目的` : "；自动反馈仍待补充，不会因此产生负面能力记录"}。</p></header>
    <section className="scenario-review__transcript" aria-label="完整文字对话">
      <h2>完整对话</h2>
      {practice.turns.map((turn) => {
        const review = practice.reviews[turn.id];
        return <article key={turn.id} className={`scenario-review-turn scenario-review-turn--${turn.speaker}`}><small>{turn.speaker === "user" ? "你" : turn.speaker === "condition" ? "条件变化" : scenario.temporaryCharacter.displayName}</small><p lang={turn.speaker === "condition" ? "zh-CN" : "es"}>{turn.text}</p>{turn.speaker === "user" ? <div className="scenario-review-feedback">{review ? <><strong>{review.contextualSuccess ? "沟通目的已达成" : "这次表达还可更清楚"}</strong>{review.errors.length ? review.errors.map((error, index) => <p key={index}>{error.explanation} {error.affectsUnderstanding ? "这会影响理解。" : "这不影响主要理解。"}{error.naturalAlternative ? <span lang="es"> 自然说法：{error.naturalAlternative}</span> : null}</p>) : <p>表达在当前语境中自然可理解。</p>}</> : <p>反馈待补充；原句已保留。</p>}</div> : null}</article>;
      })}
    </section>
    <div className="scenario-review__actions"><a className="primary-action" href={`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}/practice`}>再练一次</a><a href="/explore">选择其他场景</a></div>
  </main>;
}
