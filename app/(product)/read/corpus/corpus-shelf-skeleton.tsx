import "./corpus-workbench.css";

export function CorpusShelfSkeleton() {
  return (
    <main className="corpus-lab" role="status" aria-busy="true" aria-label="正在载入语料页">
      <header className="corpus-lab-header">
        <div><p className="corpus-lab-header__eyebrow">PALABRAS EN CONTEXTO</p><h1>语料</h1><p className="corpus-lab-header__description">在真实内容里，查清一个词怎么用。</p></div>
      </header>
      <section className="corpus-workspace" aria-hidden="true">
        <div className="corpus-initial-placeholder"><div /><div /><div /></div>
      </section>
    </main>
  );
}
