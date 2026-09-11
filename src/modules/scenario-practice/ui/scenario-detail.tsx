import type { ScenarioPracticeDetail as ScenarioDetailDto } from "../content";
import { SaveExpressionButton } from "./save-expression-button";
import { DeletePersonalScenarioButton } from "./delete-personal-scenario-button";

export function ScenarioDetail({ scenario }: Readonly<{ scenario: ScenarioDetailDto }>) {
  return (
    <main className="scenario-detail page-stack">
      <a className="scenario-back-link" href="/explore">← 返回探索</a>
      <header className="scenario-detail__hero">
        <div>
          <p className="eyebrow">{scenario.cefr} · 情景实战</p>
          <h1>{scenario.title}</h1>
          <p>{scenario.description}</p>
        </div>
        <div className="scenario-character-card">
          <span aria-hidden="true">{scenario.temporaryCharacter.displayName.slice(0, 1)}</span>
          <div><strong>{scenario.temporaryCharacter.displayName}</strong><small>{scenario.temporaryCharacter.role} · 临时人物</small></div>
        </div>
      </header>

      {scenario.fictionalContext ? <p className="scenario-fiction-notice">这是一个虚构练习场景，不代表真实地点或现实安排{scenario.stableKey === "scenario.rental-conversation" ? "；其中的房源与看房时间也并非真实信息" : ""}。</p> : null}

      <section className="scenario-detail__section" aria-labelledby="scenario-goals-title">
        <div className="section-heading"><h2 id="scenario-goals-title">你要完成的沟通</h2><span>约 {scenario.recommendedTurnCount} 轮</span></div>
        <ol className="scenario-goal-list">
          {scenario.tasks.map((task) => <li key={task.goalKey}><span>{task.position + 1}</span><p>{task.prompt}</p></li>)}
        </ol>
      </section>

      <section className="scenario-detail__section" aria-labelledby="scenario-expressions-title">
        <div className="section-heading"><h2 id="scenario-expressions-title">可以主动使用的表达</h2><span>自然替代表达同样有效</span></div>
        <div className="scenario-expression-grid">
          {scenario.expressions.map((expression) => (
            <article key={expression.stableKey}>
              <strong lang="es">{expression.text}</strong>
              <span>{expression.translation}</span>
              <small>{expression.communicativeIntent}</small>
              {!scenario.stableKey.startsWith("personal.") ? <SaveExpressionButton expressionKey={expression.stableKey} version={scenario.version} /> : null}
            </article>
          ))}
        </div>
      </section>

      <div className="scenario-detail__action">
        <a className="primary-action" href={`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}/practice`}>开始实战 <span aria-hidden="true">→</span></a>
        <span>支持文字或语音；语音转写确认后才会提交</span>
      </div>
      {scenario.stableKey.startsWith("personal.") ? <DeletePersonalScenarioButton scenarioKey={scenario.stableKey} /> : null}
    </main>
  );
}
