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
  /**
   * The shelf rank is the identity here, not the row id: the id is the
   * accent-folded word (`word:solo`), and the reference list deliberately keeps
   * `solo`/`sólo` and `te`/`té` as separate rows, so ids repeat. The rank is
   * unique and stable for a server-rendered shelf.
   */
  function tile(item: VocabularyShelfItem, rank: number) {
    return <li key={rank}>
      <button
        type="button"
        lang="es"
        className="vocabulary-study__word"
        data-word-key={item.markKey}
        data-word={item.text}
        data-example={item.context ?? undefined}
        data-source={item.source ?? undefined}
      >
        <span className="vocabulary-study__word-text">{item.text}</span>
        <span className="vocabulary-study__word-meaning">{item.meaning ?? "释义待补充"}</span>
      </button>
    </li>;
  }

  if (!ranked) {
    return <ul className="vocabulary-study__grid" role="list" aria-label="词汇列表">{items.map((item, index) => tile(item, index))}</ul>;
  }

  return <>{groupRanks(items, 1, total).map(({ band, items: bandItems }) => (
    <div className="vocabulary-shelf__band" data-band-start={band.start} key={band.start}>
      <h2 className="vocabulary-rank-band" id={bandAnchorId(band.start)}>排名 {band.start} - {band.end}:</h2>
      <ul className="vocabulary-study__grid" role="list" aria-labelledby={bandAnchorId(band.start)}>
        {bandItems.map((item, index) => tile(item, band.start + index))}
      </ul>
    </div>
  ))}</>;
}
