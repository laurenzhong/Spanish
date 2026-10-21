/** The phrasebook waits only for authentication; its teaching content is local. */
export function PhraseShelfSkeleton() {
  return (
    <section className="phrasebook phrasebook-loading" role="status" aria-busy="true" aria-label="正在载入短语库">
      <p className="sr-only">正在载入实用表达手册…</p>
      <div className="phrasebook-workspace" aria-hidden="true">
      <div className="phrasebook-loading__topics">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div>
      <div className="phrasebook-loading__rows">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="phrase-shelf-skeleton__card" key={index}>
            <span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--title" />
            <span className="phrase-shelf-skeleton__line phrase-shelf-skeleton__line--meaning" />
          </article>
        ))}
      </div>
      </div>
    </section>
  );
}
