"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { contentSourceHref, type SourcePosition } from "../domain";

type MatchMode = "phrase" | "all";
type EntryKind = "lexeme" | "phrase";

type CorpusItem = Readonly<{
  leftContext: string;
  keyword: string;
  rightContext: string;
  sourceTitle: string;
  sourceKind: string;
  entryKind?: EntryKind;
  entryId?: string;
  document: Readonly<{ kind: "article" | "media"; stableKey: string; version: number }>;
  location: SourcePosition;
}>;

type CorpusResponse = Readonly<{ items: readonly CorpusItem[]; page: number; pageSize: number; total: number }>;

type SearchState = Readonly<{
  query: string;
  match: MatchMode;
  documentKind: "" | "article" | "media";
  sourceKind: string;
  stableKey: string;
  entryKind?: EntryKind;
  entryId?: string;
}>;

type CorpusSearchProps = Readonly<{ initialState?: Partial<SearchState>; initialPage?: number }>;

const FALLBACK_PAGE_SIZE = 20;
const MAX_PAGE = 1000;

function normalizeInitialState(initialState: Partial<SearchState> | undefined): SearchState {
  return {
    query: initialState?.query?.trim() ?? "",
    match: initialState?.match === "all" ? "all" : "phrase",
    documentKind: initialState?.documentKind === "article" || initialState?.documentKind === "media" ? initialState.documentKind : "",
    sourceKind: initialState?.sourceKind?.trim() ?? "",
    stableKey: initialState?.stableKey?.trim() ?? "",
    entryKind: initialState?.entryKind,
    entryId: initialState?.entryId,
  };
}

function locationLabel(location: SourcePosition): string {
  if (location.kind === "text") return `第 ${location.segmentIndex + 1} 段`;
  const seconds = Math.floor(location.startMs / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function readUrlState(): { state: SearchState; page: number } {
  if (typeof window === "undefined") return { state: normalizeInitialState(undefined), page: 1 };
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q") ?? params.get("query") ?? "";
  const entryKind = params.get("entryKind");
  return {
    state: normalizeInitialState({
      query,
      match: params.get("match") === "all" ? "all" : "phrase",
      documentKind: params.get("documentKind") as SearchState["documentKind"],
      sourceKind: params.get("sourceKind") ?? "",
      stableKey: params.get("stableKey") ?? "",
      entryKind: entryKind === "lexeme" || entryKind === "phrase" ? entryKind : undefined,
      entryId: params.get("entryId") ?? undefined,
    }),
    page: Math.min(MAX_PAGE, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1)),
  };
}

function writeUrlState(state: SearchState, page: number, replace = false): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete("query");
  if (state.query) params.set("q", state.query); else params.delete("q");
  params.set("match", state.match);
  if (state.documentKind) params.set("documentKind", state.documentKind); else params.delete("documentKind");
  if (state.sourceKind) params.set("sourceKind", state.sourceKind); else params.delete("sourceKind");
  if (state.stableKey) params.set("stableKey", state.stableKey); else params.delete("stableKey");
  if (state.entryKind && state.entryId) {
    params.set("entryKind", state.entryKind);
    params.set("entryId", state.entryId);
  } else {
    params.delete("entryKind");
    params.delete("entryId");
  }
  if (page > 1) params.set("page", String(page)); else params.delete("page");
  const suffix = params.toString();
  const href = `${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState(null, "", href); else window.history.pushState(null, "", href);
}

export function CorpusSearch({ initialState, initialPage = 1 }: CorpusSearchProps) {
  const initial = normalizeInitialState(initialState);
  const hasInitialSearch = Boolean(initial.query || (initial.entryKind && initial.entryId));
  const [query, setQuery] = useState(initial.query);
  const [match, setMatch] = useState<MatchMode>(initial.match);
  const [documentKind, setDocumentKind] = useState<SearchState["documentKind"]>(initial.documentKind);
  const [submitted, setSubmitted] = useState<SearchState | null>(hasInitialSearch ? initial : null);
  const [result, setResult] = useState<CorpusResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [page, setPage] = useState(initialPage);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const lastRequestRef = useRef<{ search: SearchState; page: number } | null>(null);

  async function requestPage(search: SearchState, nextPage: number) {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastRequestRef.current = { search, page: nextPage };
    setState("loading");
    try {
      const params = new URLSearchParams({ page: String(nextPage), match: search.match });
      if (search.query) params.set("query", search.query);
      if (search.documentKind) params.set("documentKind", search.documentKind);
      if (search.sourceKind) params.set("sourceKind", search.sourceKind);
      if (search.stableKey) params.set("stableKey", search.stableKey);
      if (search.entryKind && search.entryId) {
        params.set("entryKind", search.entryKind);
        params.set("entryId", search.entryId);
      }
      const response = await fetch(`/api/v1/corpus/search?${params.toString()}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("CORPUS_UNAVAILABLE");
      const payload = await response.json() as { data?: CorpusResponse };
      if (generation !== generationRef.current) return;
      setResult(payload.data ?? { items: [], page: nextPage, pageSize: FALLBACK_PAGE_SIZE, total: 0 });
      setPage(nextPage);
      setState("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (generation === generationRef.current) setState("error");
    }
  }

  useEffect(() => {
    if (hasInitialSearch) {
      queueMicrotask(() => void requestPage(initial, initialPage));
    }
    const onPopState = () => {
      const next = readUrlState();
      setQuery(next.state.query);
      setMatch(next.state.match);
      setDocumentKind(next.state.documentKind);
      if (!next.state.query && !(next.state.entryKind && next.state.entryId)) {
        generationRef.current += 1;
        abortRef.current?.abort();
        setSubmitted(null);
        setResult(null);
        setState("idle");
        setPage(1);
        return;
      }
      setSubmitted(next.state);
      void requestPage(next.state, next.page);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      abortRef.current?.abort();
    };
    // The initial state is a server-provided snapshot; it is intentionally read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const search: SearchState = { query: trimmed, match, documentKind, sourceKind: "", stableKey: "" };
    setSubmitted(search);
    setPage(1);
    writeUrlState(search, 1);
    void requestPage(search, 1);
  }

  function clearSearch() {
    const empty = normalizeInitialState(undefined);
    generationRef.current += 1;
    abortRef.current?.abort();
    setQuery("");
    setSubmitted(null);
    setResult(null);
    setState("idle");
    setPage(1);
    writeUrlState(empty, 1);
  }

  function toggleMatch() {
    const nextMatch: MatchMode = match === "phrase" ? "all" : "phrase";
    setMatch(nextMatch);
    if (!submitted) return;
    const search: SearchState = { ...submitted, match: nextMatch };
    setSubmitted(search);
    setPage(1);
    writeUrlState(search, 1);
    void requestPage(search, 1);
  }

  const pageSize = result?.pageSize && result.pageSize > 0 ? result.pageSize : FALLBACK_PAGE_SIZE;
  const totalPages = result ? Math.min(MAX_PAGE, Math.max(1, Math.ceil(result.total / pageSize))) : 1;
  const currentPage = result ? Math.min(Math.max(1, Math.trunc(result.page)), totalPages) : page;
  const loading = state === "loading";
  const showPagination = Boolean(submitted && result && result.items.length > 0 && totalPages > 1);
  const hasSearch = Boolean(submitted && (submitted.query || (submitted.entryKind && submitted.entryId)));

  return <section className="corpus-search" aria-label="语料查询">
    <form className="corpus-search__form" onSubmit={submit}>
      <label className="corpus-search__input"><span>搜索词或短语</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：dar cuenta" maxLength={120} /></label>
      <label className="corpus-search__match"><span>匹配方式</span><select value={match} onChange={(event) => setMatch(event.target.value as MatchMode)}><option value="phrase">连续短语</option><option value="all">包含全部词</option></select></label>
      <label className="corpus-search__filter"><span>来源</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as SearchState["documentKind"])}><option value="">全部</option><option value="article">文章</option><option value="media">视频 / 播客</option></select></label>
      <button type="submit" disabled={!query.trim()}>{loading ? "查询中…" : "查询"}</button>
    </form>
    <div className="corpus-search__status" aria-live="polite" aria-busy={loading}>
      {loading ? <p className="corpus-search__loading" role="status">正在查询，保留上一组结果…</p> : null}
      {state === "error" ? <div className="corpus-search__error" role="alert"><span>语料库暂时不可用，请稍后再试。</span><span>已有结果仍保留。</span><button type="button" onClick={() => { const last = lastRequestRef.current; if (last) void requestPage(last.search, last.page); }}>重试</button></div> : null}
      {state === "idle" && !hasSearch ? <div className="corpus-search__empty corpus-search__empty--intro"><h2>从真实内容里找用法</h2><p>搜索一个词或短语，比较文章、视频和播客中的上下文。</p><p className="corpus-search__examples">试试：<button type="button" onClick={() => { setQuery("dar cuenta"); setMatch("phrase"); }}>dar cuenta</button><button type="button" onClick={() => { setQuery("por favor"); setMatch("phrase"); }}>por favor</button></p></div> : null}
      {state === "idle" && result && result.items.length === 0 ? <div className="corpus-search__empty"><h2>没有找到匹配的用例</h2><p>没有找到同时包含这些词的内容。</p><p>{submitted?.match === "phrase" ? "当前按连续短语和原始顺序匹配。" : "当前按同一片段包含全部词匹配。"} 可以清除筛选或切换匹配方式再试一次。</p><div className="corpus-search__empty-actions"><button type="button" onClick={clearSearch}>清除查询</button><button type="button" onClick={toggleMatch}>切换匹配方式</button><Link href="/read/phrases">返回短语页</Link></div></div> : null}
      {state === "idle" && result && result.items.length > 0 ? <p className="corpus-search__count"><span>找到 {result.total} 条出现记录</span><span> · 当前为{submitted?.match === "phrase" ? "连续短语" : "包含全部词"}匹配</span></p> : null}
    </div>
    {result && result.items.length > 0 ? <div className="corpus-results">{result.items.map((item, index) => <article className="corpus-result" key={`${item.document.kind}:${item.document.stableKey}:${item.document.version}:${item.location.kind === "media" ? item.location.startMs : item.location.segmentIndex}:${index}`}>
      <p className="corpus-result__context"><span>{item.leftContext}{item.leftContext ? " " : ""}</span><mark>{item.keyword}</mark><span>{item.rightContext ? ` ${item.rightContext}` : ""}</span></p>
      <div className="corpus-result__meta"><span>{item.sourceTitle}</span><span>{item.document.kind === "article" ? "文章" : "视频 / 播客"}</span><span>{locationLabel(item.location)}</span><a href={contentSourceHref(item.document, item.location)}>打开来源</a>{item.entryKind && item.entryId ? <Link href={item.entryKind === "phrase" ? `/read/phrases?search=${encodeURIComponent(item.keyword)}` : `/read/vocabulary?search=${encodeURIComponent(item.keyword)}`}>{item.entryKind === "phrase" ? "查看短语条目" : "查看词条"}</Link> : null}</div>
    </article>)}</div> : null}
    {showPagination && submitted && result ? <nav className="lexicon-pagination" aria-label="语料分页"><button type="button" disabled={loading || currentPage <= 1} onClick={() => { writeUrlState(submitted, currentPage - 1); void requestPage(submitted, currentPage - 1); }}>上一页</button><span>第 {currentPage} / {totalPages} 页</span><button type="button" disabled={loading || currentPage >= totalPages} onClick={() => { writeUrlState(submitted, currentPage + 1); void requestPage(submitted, currentPage + 1); }}>下一页</button></nav> : null}
  </section>;
}
