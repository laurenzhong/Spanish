import Link from "next/link";

import type { ScenarioPracticeDetail as ScenarioDetailDto } from "../content";
import { DeletePersonalScenarioButton } from "./delete-personal-scenario-button";
import { SaveExpressionButton } from "./save-expression-button";

export function ScenarioDetail({ scenario }: Readonly<{ scenario: ScenarioDetailDto }>) {
  const practiceHref = `/explore/scenarios/${encodeURIComponent(scenario.stableKey)}/practice`;
  const fictionalNotice = scenario.fictionalContext
    ? `这是一个虚构练习场景，不代表真实地点或现实安排${scenario.stableKey === "scenario.rental-conversation" ? "；其中的房源与看房时间也并非真实信息" : ""}。`
    : null;

  return <main className="scenario-detail page-stack" aria-labelledby="scenario-title">
    <nav className="scenario-detail__nav" aria-label="场景导航">
      <Link className="scenario-back-link" href="/explore"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7" /></svg><span>返回探索</span></Link>
      <span>场景详情</span>
    </nav>
    <div className="scenario-detail__layout">
      <header className="scenario-detail__hero">
        <div className="scenario-detail__hero-meta"><span className="scenario-detail__level">{scenario.cefr}</span><span>情景实战</span></div>
        <h1 id="scenario-title">{scenario.title}</h1>
        <p className="scenario-detail__description">{scenario.description}</p>
        {fictionalNotice ? <p className="scenario-fiction-notice scenario-detail__notice"><span aria-hidden="true">i</span>{fictionalNotice}</p> : null}
      </header>

      <aside className="scenario-detail__rail" aria-label="实战信息">
        <div className="scenario-character-card"><span aria-hidden="true">{scenario.temporaryCharacter.displayName.slice(0, 1)}</span><div><small className="scenario-character-card__label">本次对话对象</small><strong>{scenario.temporaryCharacter.displayName}</strong><small>{scenario.temporaryCharacter.role} · 临时人物</small></div></div>
        <dl><div><dt>难度</dt><dd>{scenario.cefr}</dd></div><div><dt>建议轮数</dt><dd>约 {scenario.recommendedTurnCount} 轮</dd></div></dl>
        <div className="scenario-detail__rail-note"><span>你将完成</span><strong>{scenario.tasks.length} 个沟通目标</strong></div>
        <Link className="primary-action scenario-detail__primary-action" href={practiceHref}><span className="scenario-detail__primary-copy"><strong>开始实战</strong><small>进入多轮对话练习</small></span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13m-5-5 5 5-5 5" /></svg></Link>
      </aside>

      <section className="scenario-detail__section scenario-detail__goals" aria-labelledby="scenario-goals-title">
        <div className="section-heading"><div><p className="eyebrow">本次练习</p><h2 id="scenario-goals-title">沟通目标</h2></div><span>{scenario.tasks.length} 个目标</span></div>
        <ol className="scenario-goal-list">{scenario.tasks.map((task) => <li key={task.goalKey}><span className="scenario-goal-list__index" aria-hidden="true">{String(task.position + 1).padStart(2, "0")}</span><div><span className="scenario-goal-list__label">目标 {task.position + 1}</span><p>{task.prompt}</p></div></li>)}</ol>
      </section>

      <section className="scenario-detail__section scenario-detail__expressions" aria-labelledby="scenario-expressions-title">
        <div className="section-heading"><div><p className="eyebrow">可直接借用</p><h2 id="scenario-expressions-title">可用表达</h2></div><span className="scenario-detail__helper">自然替代表达同样有效</span></div>
        <div className="scenario-expression-grid">{scenario.expressions.map((expression) => <article key={expression.stableKey}><div><strong lang="es">{expression.text}</strong><span className="scenario-expression-grid__translation">{expression.translation}</span><small>{expression.communicativeIntent}</small></div>{!scenario.stableKey.startsWith("personal.") ? <SaveExpressionButton expressionKey={expression.stableKey} expressionText={expression.text} version={scenario.version} /> : null}</article>)}</div>
      </section>

      {scenario.stableKey.startsWith("personal.") ? <div className="scenario-detail__delete"><DeletePersonalScenarioButton scenarioKey={scenario.stableKey} /></div> : null}
    </div>
  </main>;
}
