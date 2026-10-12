export function CorpusShelfSkeleton() {
  return (
    <main className="lexicon-shelf corpus-page corpus-shelf-skeleton" role="status" aria-busy="true" aria-label="正在载入语料页">
      <header className="lexicon-shelf__header">
        <div><p className="lexicon-shelf__eyebrow">真实用法</p><h1>语料</h1><p className="page-lede">在真实文章、视频和播客里比较一个词或短语的上下文。</p></div>
        <p>浏览语料不会写入能力评分；只有完成文字考察才会产生词句证据。</p>
      </header>
      <section className="corpus-search" aria-hidden="true">
        <div className="corpus-search__form corpus-shelf-skeleton__form"><span /><span /><span /><span /></div>
        <div className="corpus-shelf-skeleton__results"><article /><article /><article /></div>
      </section>
    </main>
  );
}
