"use client";

import { useParams } from "next/navigation";

export default function MediaDetailLoading() {
  const { stableKey } = useParams<{ stableKey: string }>();
  // Ingested podcast keys carry this prefix. This is only a layout hint;
  // the page still resolves and validates the actual media kind on the server.
  const isPodcast = stableKey?.startsWith("podcast.") ?? false;
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
      <div className={`media-learning-workbench media-learning-workbench--loading${isPodcast ? " media-learning-workbench--podcast" : ""}`}>
        <section className="media-learning-workbench__main">
          {isPodcast ? (
            <div className="media-detail__player media-detail__player--audio-loading" aria-hidden="true">
              <div className="audio-player-adapter">
                <span className="audio-player-adapter__art media-loading-line" />
                <div className="media-loading-audio-controls">
                  <span className="media-loading-line media-loading-audio-controls__button" />
                  <span className="media-loading-line media-loading-audio-controls__seek" />
                  <span className="media-loading-line media-loading-audio-controls__time" />
                  <span className="media-loading-line media-loading-audio-controls__button" />
                  <span className="media-loading-line media-loading-audio-controls__button" />
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="media-detail__player media-detail__player--loading" aria-hidden="true" />
              <div className="media-current-segment media-current-segment--loading" aria-hidden="true">
                <span className="media-loading-line media-loading-line--segment-label" />
                <span className="media-loading-line media-loading-line--segment" />
              </div>
            </>
          )}
        </section>
        <section className="media-learning-workbench__transcript" aria-hidden="true">
          <header><span className="media-loading-line media-loading-line--transcript-title" /><span className="media-loading-line media-loading-line--transcript-count" /></header>
          <div className="media-loading-transcript-lines"><span /><span /><span /><span /><span /></div>
        </section>
      </div>
    </article>
  );
}
