export default function MediaDetailLoading() {
  return (
    <article className="media-detail media-detail--loading" aria-busy="true">
      <div className="media-detail__topbar">
        <span className="media-detail__back media-loading-line media-loading-line--back" aria-hidden="true" />
        <span className="media-loading-line media-loading-line--meta" aria-hidden="true" />
      </div>
      <header className="media-detail__header">
        <span className="media-loading-line media-loading-line--title" aria-hidden="true" />
        <span className="media-loading-line media-loading-line--subtitle" aria-hidden="true" />
      </header>
      <div className="media-learning-workbench media-learning-workbench--loading">
        <section className="media-learning-workbench__main">
          <div className="media-detail__player media-detail__player--loading" aria-hidden="true" />
          <div className="media-current-segment media-current-segment--loading" aria-hidden="true">
            <span className="media-loading-line media-loading-line--segment-label" />
            <span className="media-loading-line media-loading-line--segment" />
          </div>
        </section>
        <section className="media-learning-workbench__transcript" aria-hidden="true">
          <header><span className="media-loading-line media-loading-line--transcript-title" /><span className="media-loading-line media-loading-line--transcript-count" /></header>
          <div className="media-loading-transcript-lines"><span /><span /><span /><span /><span /></div>
        </section>
      </div>
    </article>
  );
}
