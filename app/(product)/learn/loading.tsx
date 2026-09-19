export default function LearnLoading() {
  return (
    <div className="page-stack media-library media-library--loading" data-testid="learn-loading" aria-busy="true">
      <header className="media-library__topbar">
        <span className="media-library__wordmark" aria-hidden="true">Sue<span>ñ</span>o</span>
        <nav className="media-library__topnav" aria-label="学习频道">
          <span>全部</span><span>视频</span><span>播客</span>
        </nav>
        <div className="media-library__search media-library__search--loading" aria-hidden="true" />
      </header>
      <div className="media-grid media-grid--loading" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <div className="media-card media-card--skeleton" key={index} />)}
      </div>
    </div>
  );
}
