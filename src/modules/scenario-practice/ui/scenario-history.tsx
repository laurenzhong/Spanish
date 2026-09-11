import type { ScenarioHistoryItem } from "../repositories";

export function ScenarioHistory({ items }: Readonly<{ items: readonly ScenarioHistoryItem[] }>) {
  return <main className="scenario-history page-stack">
    <header className="page-header"><div><p className="eyebrow">账号记录</p><h1>场景练习历史</h1><p>每次已完成练习都保留独立对话和反馈；重新练习不会覆盖原记录。</p></div><a href="/explore">返回探索</a></header>
    {items.length ? <ol className="scenario-history__list">{items.map((item) => <li key={item.sessionId}><article><div><small><time dateTime={item.completedAt.toISOString()}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(item.completedAt)}</time> · {item.primaryModality === "speech" ? "语音" : "文字"}</small><h2>{item.title}</h2><p>{item.communicationGoal}</p><span>{item.temporaryCharacterName} · {item.userTurnCount} 次表达 · {item.reviewStatus === "ready" ? "反馈完整" : "部分反馈待补充"}</span></div>{item.scenarioKey ? <a className="secondary-action" href={`/explore/scenarios/${encodeURIComponent(item.scenarioKey)}/review?sessionId=${encodeURIComponent(item.sessionId)}`}>查看复盘</a> : null}</article></li>)}</ol> : <section className="empty-state"><h2>还没有已完成的场景练习</h2><p>完成一次实战后，完整文字历史会出现在这里。</p><a className="primary-action" href="/explore">选择场景</a></section>}
  </main>;
}
