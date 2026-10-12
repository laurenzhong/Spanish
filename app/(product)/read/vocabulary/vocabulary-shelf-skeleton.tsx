"use client";

/**
 * The vocabulary route's loading state.
 *
 * It is shelf-shaped on purpose: rank bands with tiles underneath, in the same
 * classes the real shelf uses (`.vocabulary-study__grid`, `.vocabulary-study__word`,
 * `.vocabulary-rank-band`), so the stylesheet keeps deciding every size and the
 * placeholder cannot drift away from the page it stands in for. The old fallback
 * was the shared `SurfaceState` loading copy — 「正在准备内容 / 稍等一下，你的学习位置
 * 马上就好。」 — which talks about a learning position this page does not have and
 * reads like a different product area.
 *
 * The visible line also names the page: a reader who waits should be told what
 * they are waiting for, and vocabulary is what is loading.
 *
 * Two bands are drawn, not eighty: the fallback has to be shaped like the shelf,
 * not be the shelf. The bars are hidden from assistive technology, which is told
 * once, in words, through the status line and the busy region.
 */
const SKELETON_BANDS = [1, 101] as const;
const SKELETON_TILES = 12;

export function VocabularyShelfSkeleton() {
  return (
    <main className="lexicon-shelf vocabulary-shelf-skeleton" role="status" aria-busy="true" aria-label="正在载入词汇表">
      <h1 className="sr-only">词汇</h1>

      <p className="vocabulary-shelf-skeleton__status">正在载入词汇表…</p>

      {/* The search row and the count line, in the shelf's own containers. */}
      <div className="lexicon-shelf-controls" aria-hidden="true">
        <span className="vocabulary-search vocabulary-shelf-skeleton__search" />
        <span className="vocabulary-shelf-skeleton__count" />
      </div>

      <div aria-hidden="true">
        {SKELETON_BANDS.map((start) => (
          <div className="vocabulary-shelf__band" key={start}>
            <p className="vocabulary-rank-band">排名 {start} - {start + 99}:</p>
            <ul className="vocabulary-study__grid" role="list">
              {Array.from({ length: SKELETON_TILES }, (_, index) => (
                /* A `div`, not the real tile's `button`: nothing here is a
                   control, and `[data-word-key]` must keep matching only the
                   words the shelf actually rendered. */
                <li key={index}>
                  <div className="vocabulary-study__word vocabulary-shelf-skeleton__tile">
                    <span className="read-shelf-skeleton__line vocabulary-shelf-skeleton__word" />
                    <span className="read-shelf-skeleton__line vocabulary-shelf-skeleton__meaning" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
