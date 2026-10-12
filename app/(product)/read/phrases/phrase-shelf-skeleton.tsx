/**
 * A phrase-library-shaped fallback used both during route transitions and while
 * the shelf's remote data is loading. It deliberately mirrors the controls,
 * three-column cards, representative-example panel, and intent actions instead
 * of replacing the page with a generic spinner.
 */
export function PhraseShelfSkeleton() {
  return (
    <section className="phrase-shelf-skeleton" role="status" aria-busy="true" aria-label="正在载入短语库">
      <p className="phrase-shelf-skeleton__status">正在载入短语内容；筛选是可选的…</p>
      <div className="lexicon-shelf-controls" aria-hidden="true">
        <div className="phrase-shelf-skeleton__filters">
          <span className="phrase-shelf-skeleton__field phrase-shelf-skeleton__field--wide" />
          <span className="phrase-shelf-skeleton__field" />
          <span className="phrase-shelf-skeleton__field" />
          <span className="phrase-shelf-skeleton__field" />
          <span className="phrase-shelf-skeleton__field" />
          <span className="phrase-shelf-skeleton__field" />
          <span className="phrase-shelf-skeleton__button" />
          <span className="phrase-shelf-skeleton__button phrase-shelf-skeleton__button--muted" />
        </div>
        <span className="phrase-shelf-skeleton__count" />
      </div>
      <div className="lexicon-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="lexicon-entry phrase-shelf-skeleton__card" key={index}>
            <span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--title" />
            <span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--meaning" />
            <span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--purpose" />
            <div className="phrase-shelf-skeleton__example"><span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--example" /><span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--source" /></div>
            <span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--link" />
            <div className="phrase-shelf-skeleton__intents"><span /><span /><span /></div>
          </article>
        ))}
      </div>
    </section>
  );
}
