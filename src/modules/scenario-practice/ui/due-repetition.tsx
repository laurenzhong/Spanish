import Link from "next/link";

import type { ScenarioRepetitionItem } from "../domain";

function variantCopy(item: ScenarioRepetitionItem) {
  return item.variantRequirements.map((requirement) => requirement.value ?? (
    requirement.kind === "character" ? "更换沟通对象" :
      requirement.kind === "location" ? "更换地点" :
        requirement.kind === "expression-slot" ? "使用另一种自然说法" : "加入新的限制条件"
  ));
}

export function DueRepetition({ item, scenarioKey }: Readonly<{ item: ScenarioRepetitionItem; scenarioKey: string | null }>) {
  return <main className="due-repetition page-stack">
    <Link className="scenario-back-link" href="/learn/repetitions">← 返回到期复现</Link>
    <header><p className="eyebrow">间隔复现 · 第 {item.intervalStep + 1} 次</p><h1>{item.goalSnapshot}</h1><p>在变化后的条件里重新完成沟通目标，不需要背出原句。</p></header>
    <section><h2>这次改变什么</h2><ul>{variantCopy(item).map((copy, index) => <li key={index}>{copy}</li>)}</ul></section>
    <section><h2>可以参考，但不必照读</h2><ul>{item.expressionSnapshot.map((expression) => <li key={expression} lang="es">{expression}</li>)}</ul></section>
    {scenarioKey ? <a className="primary-action" href={`/explore/scenarios/${encodeURIComponent(scenarioKey)}/practice?repetitionId=${encodeURIComponent(item.id)}`}>开始变式复现</a> : <p role="status">原场景暂时不可用，任务不会因此被标记完成。</p>}
    <aside className="gentle-note"><p>技术失败不会消耗本次复现，也不会产生负面能力记录。</p></aside>
  </main>;
}
