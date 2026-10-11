"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { useBrowserSpeech } from "@/src/modules/providers/tts";

/**
 * One ranked word of the single vocabulary shelf.
 *
 * `markKey` is the local mark identity, not `id`: it is the accent-folded
 * headword the study shelf already stored its marks under, so marks a reader
 * made there keep applying to the same word here.
 */
export type VocabularyShelfItem = Readonly<{
  id: string;
  markKey: string;
  text: string;
  count: number;
  context: string | null;
  source: string | null;
  /** The reviewed glossary entry for this word, or null when it has none. */
  glossary: VocabularyShelfGlossary | null;
}>;

export type VocabularyShelfGlossary = Readonly<{
  cefr: string;
  partOfSpeech: string;
  meanings: readonly Readonly<{ meaning: string; usage: string }>[];
  collocations: readonly string[];
  examples: readonly string[];
  forms: readonly string[];
}>;

export type VocabularyShelfStatus = "familiar" | "revisit" | "ignore";

type VocabularyShelfProps = Readonly<{
  items: readonly VocabularyShelfItem[];
  storageScope: string;
}>;

/**
 * One wording for the familiar/revisit/ignore triad. The server-backed shelves
 * own the same words (`lexicon-shelf-controls.tsx`, `vocabulary-library.tsx`,
 * `phrase-library.tsx`) so one state never reads two ways.
 */
const statusOptions = [
  ["familiar", "已熟悉"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
] as const satisfies readonly (readonly [VocabularyShelfStatus, string])[];

const statusLabels: Record<VocabularyShelfStatus, string> = { familiar: "已熟悉", revisit: "想复现", ignore: "暂不学习" };

/**
 * Browser-local marks, deliberately the same storage contract the study shelf
 * used (`sueno:vocabulary-status:v1:<scope>`, a flat `{ headword: status }`
 * map, the same cross-tab event), so a reader's existing marks stay valid after
 * the two shelves became one page.
 *
 * The server-side `user_lexical_intents` mechanism cannot serve this shelf: it
 * keys on a lexeme or phrase row, and the corpus still contains zero lexemes
 * because the indexing pipeline has never run. Local marks are therefore the
 * only mechanism that can mark a reference-list word today; moving them to the
 * server is the natural follow-up once indexing fills the lexicon.
 */
const storagePrefix = "sueno:vocabulary-status:v1:";
const statusEvent = "sueno:vocabulary-status-changed";
const emptyStatuses: Record<string, VocabularyShelfStatus> = {};
const statusSnapshots = new Map<string, Record<string, VocabularyShelfStatus>>();

function statusStorageKey(scope: string): string {
  return `${storagePrefix}${scope}`;
}

function parseStatuses(scope: string): Record<string, VocabularyShelfStatus> {
  const next: Record<string, VocabularyShelfStatus> = {};
  try {
    const raw = window.localStorage.getItem(statusStorageKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === "familiar" || value === "revisit" || value === "ignore") next[key] = value;
      }
    }
  } catch {
    return {};
  }
  return next;
}

/** `useSyncExternalStore` needs one cached object per scope, not a fresh map. */
function readStatuses(scope: string): Record<string, VocabularyShelfStatus> {
  const cached = statusSnapshots.get(scope);
  if (cached) return cached;
  const next = parseStatuses(scope);
  statusSnapshots.set(scope, next);
  return next;
}

function subscribeStatuses(callback: () => void): () => void {
  const onChange = () => {
    statusSnapshots.clear();
    callback();
  };
  window.addEventListener("storage", onChange);
  window.addEventListener(statusEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(statusEvent, onChange);
  };
}

function writeStatuses(scope: string, next: Record<string, VocabularyShelfStatus>): void {
  statusSnapshots.set(scope, next);
  try {
    window.localStorage.setItem(statusStorageKey(scope), JSON.stringify(next));
  } catch {
    // Ignore storage failures; the current session keeps its marks.
  }
  window.dispatchEvent(new Event(statusEvent));
}

/**
 * The single vocabulary page's word shelf: the reference-ranked content words
 * with their real corpus counts and one published example, the reviewed Chinese
 * meanings where the glossary has them, and the reader's browser-local marks.
 *
 * The order is the server's (reference rank with function words removed) and is
 * rendered exactly as given — re-sorting locally would put the corpus head back
 * on top, which is the defect this shelf exists to fix.
 */
export function VocabularyShelf({ items, storageScope }: VocabularyShelfProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const statuses = useSyncExternalStore(subscribeStatuses, () => readStatuses(storageScope), () => emptyStatuses);
  const speech = useBrowserSpeech();
  const speakingId = speech.speakingId;

  const markStatus = useCallback((markKey: string, status: VocabularyShelfStatus) => {
    const next = { ...readStatuses(storageScope) };
    if (next[markKey] === status) delete next[markKey];
    else next[markKey] = status;
    writeStatuses(storageScope, next);
  }, [storageScope]);

  const toggleSpeech = useCallback((item: VocabularyShelfItem) => {
    if (speech.speakingId === item.id) {
      speech.stop();
      return;
    }
    setNotice("");
    speech.speak(item.id, item.text, () => setNotice("当前浏览器不支持朗读，单词仍可正常学习。"));
  }, [speech]);

  if (!items.length) return null;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const marked = Object.keys(statuses).length;
  const visibleNotice = speech.errorMessage || notice;

  return <section className="vocabulary-study" aria-label="词汇表">
    <p className="vocabulary-study__summary" aria-live="polite">已标记 {marked} 个 · 标记保存在本机浏览器，换设备不会同步</p>
    {visibleNotice ? <p className="vocabulary-study__notice" role="status">{visibleNotice}</p> : null}

    <div className="vocabulary-study__grid" role="list" aria-label="词汇列表">
      {items.map((item) => {
        const status = statuses[item.markKey];
        return <div role="listitem" key={item.id}>
          <button
            type="button"
            lang="es"
            className={`vocabulary-study__word${selected?.id === item.id ? " is-selected" : ""}${status ? ` is-${status}` : ""}`}
            onClick={() => setSelectedId(item.id)}
          >
            <span className="vocabulary-study__word-text">
              {/*
                The occurrence count used to sit here. It was the shelf's sort key
                when the order was raw corpus frequency, and it lost that job when
                the order became the reference frequency rank — the numbers are not
                monotonic, so a count beside a sorted list reads as if it were the
                sort key and makes the list look arbitrary. It is also a
                surface-form count rather than a lemma count (`estar` does not
                include `está`), so it understated the very quantity it named, and
                nothing acted on it. The example sentence below is what carries the
                one actionable fact: that this word really occurs in published
                content.
              */}
              {item.text}
            </span>
            <span className="vocabulary-study__word-meaning">{item.glossary?.meanings[0]?.meaning ?? "释义待补充"}</span>
          </button>
        </div>;
      })}
    </div>

    {selected ? <aside className="vocabulary-study__card" aria-live="polite" aria-label={`${selected.text} 词汇卡片`}>
      <div className="vocabulary-study__card-head">
        <div>
          <p className="vocabulary-study__eyebrow">
            {selected.glossary ? `已审核词表 · ${selected.glossary.cefr} · ${selected.glossary.partOfSpeech}` : "参考词表"}
          </p>
          <h3 lang="es">{selected.text}</h3>
        </div>
        <div className="vocabulary-study__card-actions">
          <button type="button" onClick={() => toggleSpeech(selected)}>{speakingId === selected.id ? "停止朗读" : "朗读单词"}</button>
          <button type="button" onClick={() => setSelectedId(null)}>关闭</button>
        </div>
      </div>

      {selected.glossary
        ? <ul className="vocabulary-study__meanings">
          {selected.glossary.meanings.map((item) => <li key={item.meaning}><strong>{item.meaning}</strong>{item.usage ? <span>{item.usage}</span> : null}</li>)}
        </ul>
        : <p className="vocabulary-study__muted">这个词还没有审核过的中文释义，先按下面的语境理解它。</p>}

      {selected.glossary?.collocations.length ? <div className="vocabulary-study__block"><h4>常用搭配</h4><p className="vocabulary-study__chips" lang="es">{selected.glossary.collocations.map((item) => <span key={item}>{item}</span>)}</p></div> : null}
      {selected.glossary?.examples.length ? <div className="vocabulary-study__block"><h4>词表例句</h4><ul className="vocabulary-study__examples" lang="es">{selected.glossary.examples.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {selected.glossary?.forms.length ? <div className="vocabulary-study__block"><h4>常见变位 / 形式</h4><p className="vocabulary-study__chips" lang="es">{selected.glossary.forms.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</p></div> : null}

      <div className="vocabulary-study__block">
        <h4>已发布内容中的真实例句</h4>
        {selected.context
          ? <figure className="vocabulary-study__corpus">
            <blockquote lang="es">{selected.context}</blockquote>
            {selected.source ? <figcaption>{selected.source}</figcaption> : null}
          </figure>
          : <p className="vocabulary-study__muted">已发布内容中暂时没有收录这个词的例句。</p>}
      </div>

      <div className="vocabulary-study__marking" role="group" aria-label={`标记 ${selected.text}`}>
        {statusOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={statuses[selected.markKey] === value} className={statuses[selected.markKey] === value ? "is-active" : undefined} onClick={() => markStatus(selected.markKey, value)}>{label}</button>)}
        {statuses[selected.markKey] ? <button type="button" onClick={() => markStatus(selected.markKey, statuses[selected.markKey]!)}>清除标记</button> : null}
        <span className="vocabulary-study__muted">{statuses[selected.markKey] ? `当前：${statusLabels[statuses[selected.markKey]!]}` : "还没有标记"}</span>
      </div>
    </aside> : null}
  </section>;
}
