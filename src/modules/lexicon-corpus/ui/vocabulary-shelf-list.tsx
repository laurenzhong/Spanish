import { bandAnchorId, groupRanks } from "./vocabulary-rank";

/**
 * One row of the shelf, as the page hands it to the list.
 *
 * `markKey` is the browser-local mark identity (the accent-folded headword), and
 * `meaning` is only the *first* reviewed Chinese meaning — the word's full,
 * ordered meaning list lives in the frame's glossary map and is what the hover
 * or focus translation shows.
 */
export type VocabularyShelfItem = Readonly<{
  id: string;
  markKey: string;
  text: string;
  /** The word's one published example, carried on the tile so the card needs no second path. */
  context: string | null;
  source: string | null;
  meaning: string | null;
}>;

type VocabularyShelfListProps = Readonly<{
  items: readonly VocabularyShelfItem[];
  /** False for a search result: its positions are not shelf ranks, so it gets no bands. */
  ranked: boolean;
  total: number;
}>;

/** Attribute and text escaping for the tile markup, which is emitted as HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * One tile's markup, as a string.
 *
 * A string rather than JSX because of what the document costs. The shelf renders 7,922 words
 * inside a client component, and every element passed across that boundary is serialised into
 * the RSC payload **in addition to** the HTML it renders — measured on the real page, 6.45 MB
 * of a 9.42 MB document was that payload, against 2.97 MB of markup. Emitting the tiles as one
 * HTML string lets the server render them without serialising 7,922 elements, and the frame
 * already reads everything it needs from `data-*` attributes on a single delegated listener,
 * so nothing about the interaction depends on those elements being React nodes.
 */
export function shelfTileHtml(item: VocabularyShelfItem): string {
  const context = item.context === null ? "" : ` data-example="${escapeHtml(item.context)}"`;
  const source = item.source === null ? "" : ` data-source="${escapeHtml(item.source)}"`;
  return `<li><button type="button" lang="es" class="vocabulary-study__word"`
    + ` data-word-key="${escapeHtml(item.markKey)}" data-word="${escapeHtml(item.text)}"${context}${source}>`
    + `<span class="vocabulary-study__word-text">${escapeHtml(item.text)}</span>`
    + `<span class="vocabulary-study__word-meaning">${escapeHtml(item.meaning ?? "释义待补充")}</span>`
    + "</button></li>";
}

/** A grid of tiles, as one HTML string. See {@link shelfTileHtml} for why this is a string. */
function gridHtml(items: readonly VocabularyShelfItem[]): string {
  return items.map((item) => shelfTileHtml(item)).join("");
}

/**
 * The shelf itself, rendered on the server: every word of the list at once, in
 * reference-rank order, grouped under its rank band (`排名 1 - 100:`).
 *
 * The tiles are plain HTML inside the interactive frame. That is deliberate:
 * with the whole 7,922-word shelf on one page, hydrating a component per word
 * would cost a fiber per word for no benefit — the frame listens on the
 * container and reads what it needs off these data attributes instead.
 *
 * The occurrence count is deliberately absent (it was removed as misleading:
 * it is a surface-form count beside a reference-rank order). The one published
 * example travels on the tile so the click-open card keeps the shelf's single
 * example path.
 */
export function VocabularyShelfList({ items, ranked, total }: VocabularyShelfListProps) {
  if (!ranked) {
    return <ul
      className="vocabulary-study__grid"
      role="list"
      aria-label="词汇列表"
      dangerouslySetInnerHTML={{ __html: gridHtml(items) }}
    />;
  }

  return <>{groupRanks(items, 1, total).map(({ band, items: bandItems }) => (
    <div className="vocabulary-shelf__band" data-band-start={band.start} key={band.start}>
      {/* A centred divider: the rules on either side do the separating the
          trailing colon used to do. */}
      <h2 className="vocabulary-rank-band" id={bandAnchorId(band.start)}>排名 {band.start} - {band.end}</h2>
      <ul
        className="vocabulary-study__grid"
        role="list"
        aria-labelledby={bandAnchorId(band.start)}
        dangerouslySetInnerHTML={{ __html: gridHtml(bandItems) }}
      />
    </div>
  ))}</>;
}
