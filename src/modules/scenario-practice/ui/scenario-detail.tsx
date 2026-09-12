import type { ScenarioPracticeDetail as ScenarioDetailDto } from "../content";
import { DeletePersonalScenarioButton } from "./delete-personal-scenario-button";
import { SaveExpressionButton } from "./save-expression-button";

export function ScenarioDetail({ scenario }: Readonly<{ scenario: ScenarioDetailDto }>) {
  const practiceHref = `/explore/scenarios/${encodeURIComponent(scenario.stableKey)}/practice`;
  return <main className="scenario-detail page-stack">
    <a className="scenario-back-link" href="/explore">← 返回探索</a>
    <div className="scenario-detail__layout">
      <header className="scenario-detail__hero">
        <p className="eyebrow">{scenario.cefr} · 情景实战</p>
        <h1>{scenario.title}</h1>
        <p>{scenario.description}</p>
      </header>

      <aside className="scenario-detail__rail" aria-label="实战信息">
        <div className="scenario-character-card"><span aria-hidden="true">{scenario.temporaryCharacter.displayName.slice(0, 1)}</span><div><strong>{scenario.temporaryCharacter.displayName}</strong><small>{scenario.temporaryCharacter.role} · 临时人物</small></div></div>
        <dl><div><dt>难度</dt><dd>{scenario.cefr}</dd></div><div><dt>建议轮数</dt><dd>约 {scenario.recommendedTurnCount} 轮</dd></div></dl>
        <a className="primary-action" href={practiceHref}>开始实战 <span aria-hidden="true">→</span></a>
      </aside>

      {scenario.fictionalContext ? <p className="scenario-fiction-notice scenario-detail__notice">这是一个虚构练习场景，不代表真实地点或现实安排{scenario.stableKey === "scenario.rental-conversation" ? "；其中的房源与看房时间也并非真实信息" : ""}。</p> : null}

      <section className="scenario-detail__section scenario-detail__goals" aria-labelledby="scenario-goals-title">
        <div className="section-heading"><h2 id="scenario-goals-title">沟通目标</h2></div>
        <ol className="scenario-goal-list">{scenario.tasks.map((task) => <li key={task.goalKey}><span>{task.position + 1}</span><p>{task.prompt}</p></li>)}</ol>
      </section>

      <section className="scenario-detail__section scenario-detail__expressions" aria-labelledby="scenario-expressions-title">
        <div className="section-heading"><h2 id="scenario-expressions-title">可用表达</h2><span>自然替代表达同样有效</span></div>
        <div className="scenario-expression-grid">{scenario.expressions.map((expression) => <article key={expression.stableKey}><div><strong lang="es">{expression.text}</strong><span>{expression.translation}</span><small>{expression.communicativeIntent}</small></div>{!scenario.stableKey.startsWith("personal.") ? <SaveExpressionButton expressionKey={expression.stableKey} expressionText={expression.text} version={scenario.version} /> : null}</article>)}</div>
      </section>

      {scenario.stableKey.startsWith("personal.") ? <div className="scenario-detail__delete"><DeletePersonalScenarioButton scenarioKey={scenario.stableKey} /></div> : null}
    </div>
  </main>;
}
