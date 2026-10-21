/**
 * Route-level fallback for `/learn` and its subroutes, including
 * `/learn/media/*`.
 *
 * It used to render the full adaptive card grid, which made a click from the
 * library into a media detail flash a "library is loading" grid before the
 * detail skeleton appeared. The route boundary stays (so `/learn` remains
 * prefetchable and its fallback is instant), but it is now intentionally
 * neutral: the real grid skeleton lives inside `learn/page.tsx`, while this
 * shell only reserves the header slots and tells the user something is
 * opening.
 */
export default function LearnLoading() {
  return (
    <div className="page-stack media-library media-library--loading" data-testid="learn-loading" aria-busy="true">
      <header className="media-library__topbar">
        <span className="media-library__wordmark" aria-hidden="true">Sue<span>ñ</span>o</span>
        <nav className="media-library__topnav" aria-label="学习频道">
          <span>全部</span><span>视频</span><span>播客</span>
        </nav>
        {/* The controls reserve the same slot they occupy once the library has
            loaded, so the channel tabs and the search field do not move when
            the real header replaces this one. */}
        <div className="media-library__toolbar media-library__toolbar--loading" aria-hidden="true">
          <span /><span />
        </div>
        {/* The field is placeholders only: no drawn magnifier, which read as a
            stray icon next to a nearly empty box. */}
        <div className="media-library__search media-library__search--loading" aria-hidden="true">
          <div className="media-library__search-loading-field"><span /></div>
        </div>
      </header>
      <p className="media-library__load-more-state" role="status">正在打开…</p>
    </div>
  );
}
