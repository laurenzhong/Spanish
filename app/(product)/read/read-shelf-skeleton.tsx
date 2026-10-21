"use client";

import { ARTICLE_PAGE_SIZE } from "./shelf-constants";

/**
 * The reading shelf's loading state.
 *
 * It deliberately reuses the shelf's own class names for every box that has
 * geometry (`.read-library`, `.read-library__toolbar`, `.read-search__field`,
 * `.read-article-list`, `.read-article-row` and its cells) instead of drawing
 * its own mock. The stylesheet therefore decides the sizes, and the skeleton
 * cannot drift away from the page the way a hand-measured placeholder does:
 * same toolbar columns, same row grid, same breakpoint behaviour (the article
 * type column disappears under 520px because the real row does the same).
 *
 * Only the pulsing fills are defined by `.read-shelf-skeleton__*`; a change to
 * the shelf's structure must show up here too, which is the point.
 *
 * It is a client component on purpose. As a server component React serialised
 * this ~170-node tree into the flight payload of every `/read` response
 * (measured: 118,860 B total, 70,235 B payload; with the client boundary
 * 81,166 B / 32,736 B), which is a lot to pay for a fallback that is usually
 * replaced before it is read.
 */
export function ReadShelfSkeleton({ rows = ARTICLE_PAGE_SIZE }: Readonly<{ rows?: number }>) {
  return (
    <div className="read-library read-shelf-skeleton" role="status" aria-busy="true" aria-label="正在载入文章列表">
      {/* Same two-column toolbar as the shelf: full-width search field, then
          the sort / filter / add controls. */}
      <div className="read-library__toolbar" aria-hidden="true">
        <div className="read-search"><span className="read-search__field read-shelf-skeleton__field" /></div>
        <div className="read-library__toolbar-actions">
          <span className="read-shelf-skeleton__control read-shelf-skeleton__control--sort" />
          <span className="read-shelf-skeleton__control read-shelf-skeleton__control--filter" />
          <span className="read-shelf-skeleton__control read-shelf-skeleton__control--add" />
        </div>
      </div>
      <div className="read-results" aria-hidden="true">
        <div className="read-article-list">
          {Array.from({ length: rows }, (_, index) => (
            /* A `div`, not the real row's `article`: the skeleton is not
               content, and `article.read-article-row` must keep matching only
               the rows the shelf actually rendered. */
            <div className="read-article-row read-article-row--skeleton" key={index}>
              <div className="read-article-row__type"><i /></div>
              <div className="read-article-row__body">
                <div className="read-article-row__heading">
                  <span className="read-shelf-skeleton__line read-shelf-skeleton__line--meta" />
                  <span className="read-shelf-skeleton__line read-shelf-skeleton__line--state" />
                </div>
                <h3><span className="read-shelf-skeleton__line read-shelf-skeleton__line--title" /></h3>
                <div className="read-article-row__rule" aria-hidden="true"><span /></div>
                <div className="read-article-row__footer">
                  <span className="read-shelf-skeleton__line read-shelf-skeleton__line--topic" />
                </div>
              </div>
              <span className="read-article-row__save"><span className="read-shelf-skeleton__dot" /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
