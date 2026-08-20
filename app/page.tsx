const foundationChecks = [
  "Next.js App Router",
  "React 与 TypeScript 严格模式",
  "Tailwind CSS",
  "Vitest 与 Playwright",
];

export default function HomePage() {
  return (
    <main className="foundation-shell">
      <section className="foundation-card" aria-labelledby="foundation-title">
        <p className="foundation-kicker">Spanish · Personal Alpha</p>
        <h1 id="foundation-title">基础工程已就绪</h1>
        <p className="foundation-summary">
          当前页面只验证移动优先的应用骨架。学习、探索、对话和个人中心将在后续任务中逐步加入。
        </p>

        <ul className="foundation-list" aria-label="工程能力">
          {foundationChecks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
