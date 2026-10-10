"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useBrowserSpeech } from "@/src/modules/providers/tts";
import type { StudyVocabularyMeaning, StudyVocabularyWord } from "../domain/study-vocabulary";

export type { StudyVocabularyMeaning, StudyVocabularyWord };

export type StudyVocabularyStatus = "familiar" | "revisit" | "ignore";

type CorpusExample = Readonly<{
  sentence: string;
  translation: string | null;
  sourceTitle: string;
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  position: number;
}>;

type VocabularyStudyListProps = Readonly<{
  words: readonly StudyVocabularyWord[];
  storageScope: string;
}>;

const statusOptions = [
  ["familiar", "✓ 已掌握"],
  ["revisit", "▣ 学习中"],
  ["ignore", "⊘ 不学习"],
] as const satisfies readonly (readonly [StudyVocabularyStatus, string])[];

const statusLabels: Record<StudyVocabularyStatus, string> = { familiar: "已掌握", revisit: "学习中", ignore: "不学习" };
const storagePrefix = "sueno:vocabulary-status:v1:";
const statusEvent = "sueno:vocabulary-status-changed";
const emptyStatuses: Record<string, StudyVocabularyStatus> = {};

let snapshotScope = "";
let snapshotValue: Record<string, StudyVocabularyStatus> = emptyStatuses;

function statusStorageKey(scope: string): string {
  return `${storagePrefix}${scope}`;
}

function subscribeStatuses(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(statusEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(statusEvent, callback);
  };
}

function readStatuses(scope: string): Record<string, StudyVocabularyStatus> {
  if (typeof window === "undefined" || snapshotScope === scope) return snapshotValue;
  snapshotScope = scope;
  snapshotValue = emptyStatuses;
  try {
    const raw = window.localStorage.getItem(statusStorageKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const next: Record<string, StudyVocabularyStatus> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === "familiar" || value === "revisit" || value === "ignore") next[key] = value;
      }
      snapshotValue = next;
    }
  } catch {
    snapshotValue = emptyStatuses;
  }
  return snapshotValue;
}

function writeStatuses(scope: string, next: Record<string, StudyVocabularyStatus>): void {
  snapshotScope = scope;
  snapshotValue = next;
  try {
    window.localStorage.setItem(statusStorageKey(scope), JSON.stringify(next));
  } catch {
    // Ignore storage failures; the current session keeps its marks.
  }
  window.dispatchEvent(new Event(statusEvent));
}

function exampleHref(example: CorpusExample): string {
  if (example.documentKind === "media") return `/learn/media/${encodeURIComponent(example.documentStableKey)}`;
  return `/read/article/${encodeURIComponent(`${example.documentStableKey}@${example.documentVersion}`)}#segment-${example.position}`;
}

function matchesQuery(word: StudyVocabularyWord, query: string): boolean {
  if (!query) return true;
  const haystack = [word.headword, word.partOfSpeech, word.cefr, ...word.meanings.map((item) => item.meaning), ...word.meanings.map((item) => item.usage)].join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

export function VocabularyStudyList({ words, storageScope }: VocabularyStudyListProps) {
  const [query, setQuery] = useState("");
  const [cefr, setCefr] = useState("全部");
  const [statusFilter, setStatusFilter] = useState<"all" | "unmarked" | StudyVocabularyStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [examples, setExamples] = useState<Record<string, CorpusExample | null>>({});
  const [exampleErrors, setExampleErrors] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const requestedExamples = useRef(new Set<string>());
  const statuses = useSyncExternalStore(subscribeStatuses, () => readStatuses(storageScope), () => emptyStatuses);
  const speech = useBrowserSpeech();
  const speakingId = speech.speakingId;
  const visibleNotice = speech.errorMessage || notice;

  const cefrLevels = useMemo(() => ["全部", ...Array.from(new Set(words.map((word) => word.cefr))).sort()], [words]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => words.filter((word) => {
    if (!matchesQuery(word, normalizedQuery)) return false;
    if (cefr !== "全部" && word.cefr !== cefr) return false;
    const status = statuses[word.id];
    if (statusFilter === "all") return true;
    if (statusFilter === "unmarked") return !status;
    return status === statusFilter;
  }), [words, normalizedQuery, cefr, statusFilter, statuses]);

  const selected = useMemo(() => words.find((word) => word.id === selectedId) ?? null, [words, selectedId]);

  const markStatus = useCallback((wordId: string, status: StudyVocabularyStatus) => {
    const next = { ...readStatuses(storageScope) };
    if (next[wordId] === status) delete next[wordId];
    else next[wordId] = status;
    writeStatuses(storageScope, next);
  }, [storageScope]);

  const speak = useCallback((word: StudyVocabularyWord) => {
    setNotice("");
    speech.speak(word.id, word.headword, () => setNotice("当前浏览器不支持朗读，单词仍可正常学习。"));
  }, [speech]);

  const toggleSpeech = useCallback((word: StudyVocabularyWord) => {
    if (speech.speakingId === word.id) speech.stop();
    else speak(word);
  }, [speak, speech]);

  const selectWord = useCallback((word: StudyVocabularyWord) => {
    setSelectedId(word.id);
    setNotice("");
    if (requestedExamples.current.has(word.id)) return;
    requestedExamples.current.add(word.id);
    void fetch(`/api/v1/read/vocabulary-example?word=${encodeURIComponent(word.headword)}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("example-unavailable");
        const body = await response.json() as { data?: CorpusExample | null };
        setExamples((previous) => ({ ...previous, [word.id]: body.data ?? null }));
      })
      .catch(() => {
        setExampleErrors((previous) => ({ ...previous, [word.id]: true }));
      });
  }, []);

  const marked = Object.keys(statuses).length;
  const total = words.length;

  return <section className="vocabulary-study" aria-label="学习词表">
    <header className="vocabulary-study__toolbar">
      <label className="vocabulary-study__search"><span>搜索单词或释义</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={60} placeholder="例如 casa、吃、家庭" type="search" />
      </label>
      <div className="vocabulary-study__filters" role="group" aria-label="学习状态筛选">
        <button type="button" className={statusFilter === "all" ? "is-active" : undefined} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部 {total}</button>
        <button type="button" className={statusFilter === "unmarked" ? "is-active" : undefined} aria-pressed={statusFilter === "unmarked"} onClick={() => setStatusFilter("unmarked")}>未标记</button>
        {statusOptions.map(([value, label]) => <button key={value} type="button" className={statusFilter === value ? "is-active" : undefined} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</button>)}
      </div>
      <div className="vocabulary-study__filters" role="group" aria-label="难度筛选">
        {cefrLevels.map((level) => <button key={level} type="button" className={cefr === level ? "is-active" : undefined} aria-pressed={cefr === level} onClick={() => setCefr(level)}>{level}</button>)}
      </div>
    </header>
    <p className="vocabulary-study__summary" aria-live="polite">共 {total} 个已审核单词 · 已标记 {marked} 个 · 学习印记保存在本机浏览器</p>
    {visibleNotice ? <p className="vocabulary-study__notice" role="status">{visibleNotice}</p> : null}

    {!visible.length ? <div className="lexicon-empty"><h2>没有匹配的单词</h2><p>换一个搜索词，或把筛选切回“全部”。</p></div> : <div className="vocabulary-study__grid" role="list" aria-label="单词列表">
      {visible.map((word) => {
        const status = statuses[word.id];
        return <div role="listitem" key={word.id}>
          <button
            type="button"
            lang="es"
            className={`vocabulary-study__word${selected?.id === word.id ? " is-selected" : ""}${status ? ` is-${status}` : ""}`}
            onClick={() => selectWord(word)}
          >
            <span className="vocabulary-study__word-text">{word.headword}</span>
            <span className="vocabulary-study__word-meaning">{word.meanings[0]?.meaning ?? "释义待补充"}</span>
          </button>
        </div>;
      })}
    </div>}

    {selected ? <aside className="vocabulary-study__card" aria-live="polite" aria-label={`${selected.headword} 学习卡片`}>
      <div className="vocabulary-study__card-head">
        <div>
          <p className="vocabulary-study__eyebrow">学习卡片 · {selected.cefr} · {selected.partOfSpeech}</p>
          <h3 lang="es">{selected.headword}</h3>
        </div>
        <div className="vocabulary-study__card-actions">
          <button type="button" onClick={() => toggleSpeech(selected)}>{speakingId === selected.id ? "停止朗读" : "朗读单词"}</button>
          <button type="button" onClick={() => setSelectedId(null)}>关闭</button>
        </div>
      </div>

      <ul className="vocabulary-study__meanings">
        {selected.meanings.map((item) => <li key={item.meaning}><strong>{item.meaning}</strong>{item.usage ? <span>{item.usage}</span> : null}</li>)}
      </ul>

      {selected.collocations.length ? <div className="vocabulary-study__block"><h4>常用搭配</h4><p className="vocabulary-study__chips" lang="es">{selected.collocations.map((item) => <span key={item}>{item}</span>)}</p></div> : null}
      {selected.examples.length ? <div className="vocabulary-study__block"><h4>例句</h4><ul className="vocabulary-study__examples" lang="es">{selected.examples.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {selected.forms.length ? <div className="vocabulary-study__block"><h4>常见变位 / 形式</h4><p className="vocabulary-study__chips" lang="es">{selected.forms.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</p></div> : null}

      <div className="vocabulary-study__block">
        <h4>已发布内容中的真实例句</h4>
        {exampleErrors[selected.id] ? <p className="vocabulary-study__muted">暂时无法读取语料例句，单词释义不受影响。</p> : null}
        {!exampleErrors[selected.id] && !(selected.id in examples) ? <p className="vocabulary-study__muted">正在已审核的字幕与文章中查找这个词…</p> : null}
        {!exampleErrors[selected.id] && selected.id in examples && examples[selected.id] === null ? <p className="vocabulary-study__muted">已发布内容中暂时没有收录这个词的例句。</p> : null}
        {examples[selected.id] ? <figure className="vocabulary-study__corpus">
          <blockquote lang="es">{examples[selected.id]!.sentence}</blockquote>
          {examples[selected.id]!.translation ? <figcaption lang="zh-CN">{examples[selected.id]!.translation}</figcaption> : null}
          <Link href={exampleHref(examples[selected.id]!)}>{examples[selected.id]!.sourceTitle} <span aria-hidden="true">↗</span></Link>
        </figure> : null}
      </div>

      <div className="vocabulary-study__marking" role="group" aria-label={`标记 ${selected.headword}`}>
        {statusOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={statuses[selected.id] === value} className={statuses[selected.id] === value ? "is-active" : undefined} onClick={() => markStatus(selected.id, value)}>{label}</button>)}
        {statuses[selected.id] ? <button type="button" onClick={() => markStatus(selected.id, statuses[selected.id]!)}>清除标记</button> : null}
        <span className="vocabulary-study__muted">{statuses[selected.id] ? `当前：${statusLabels[statuses[selected.id]!]}` : "还没有标记"}</span>
      </div>
    </aside> : null}
  </section>;
}
