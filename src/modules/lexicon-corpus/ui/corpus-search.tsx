"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { contentSourceHref, type SourcePosition } from "../domain";

type MatchMode = "phrase" | "all";
type EntryKind = "lexeme" | "phrase";
type ContentKind = "article" | "video" | "podcast";

type CorpusItem = Readonly<{
  leftContext: string;
  keyword: string;
  rightContext: string;
  sourceTitle: string;
  sourceKind: string;
  entryKind?: EntryKind;
  entryId?: string;
  isContentDiscovery?: boolean;
  document: Readonly<{ kind: "article" | "media"; stableKey: string; version: number }>;
  location: SourcePosition;
}>;

type CorpusResponse = Readonly<{ items: readonly CorpusItem[]; page: number; pageSize: number; total: number }>;

type CorpusClusterContext = CorpusItem & Readonly<{ entryKind: "phrase"; entryId: string; surfaceText: string; contentKind: ContentKind }>;
type CorpusCluster = Readonly<{
  entryKind: "phrase";
  entryId: string;
  expression: string;
  meaningZh: string | null;
  pragmaticPurpose: string | null;
  contexts: readonly CorpusClusterContext[];
  contentKinds: readonly ContentKind[];
  isContentDiscovery?: boolean;
}>;
type CorpusBrowseResponse = Readonly<{ items: readonly CorpusCluster[]; page: number; pageSize: number; total: number }>;

type SearchState = Readonly<{
  query: string;
  match: MatchMode;
  documentKind: "" | "article" | "media";
  contentKind: "" | ContentKind;
  sourceKind: string;
  stableKey: string;
  entryKind?: EntryKind;
  entryId?: string;
}>;

type CorpusSearchProps = Readonly<{ initialState?: Partial<SearchState>; initialPage?: number }>;
type ResultState = Readonly<{ mode: "browse" | "search"; data: CorpusBrowseResponse | CorpusResponse }>;

const FALLBACK_PAGE_SIZE = 20;
const BROWSE_PAGE_SIZE = 8;
const MAX_PAGE = 1000;
const contentKindOrder: readonly ContentKind[] = ["article", "video", "podcast"];
const contentKindLabels: Record<ContentKind, string> = { article: "文章", video: "视频", podcast: "播客" };

function normalizeInitialState(initialState: Partial<SearchState> | undefined): SearchState {
  return {
    query: initialState?.query?.trim() ?? "",
    match: initialState?.match === "all" ? "all" : "phrase",
    documentKind: initialState?.documentKind === "article" || initialState?.documentKind === "media" ? initialState.documentKind : "",
    contentKind: initialState?.contentKind === "article" || initialState?.contentKind === "video" || initialState?.contentKind === "podcast" ? initialState.contentKind : "",
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
  const entryKind = params.get("entryKind");
  const contentKind = params.get("contentKind");
  return {
    state: normalizeInitialState({
      query: params.get("q") ?? params.get("query") ?? "",
      match: params.get("match") === "all" ? "all" : "phrase",
      documentKind: params.get("documentKind") as SearchState["documentKind"],
      contentKind: contentKind as SearchState["contentKind"],
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
  if (state.query) params.set("match", state.match); else params.delete("match");
  if (state.documentKind) params.set("documentKind", state.documentKind); else params.delete("documentKind");
  if (state.contentKind) params.set("contentKind", state.contentKind); else params.delete("contentKind");
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

function filterParams(state: SearchState, page: number, pageSize: number): URLSearchParams {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (state.query) params.set("query", state.query);
  if (state.documentKind) params.set("documentKind", state.documentKind);
  if (state.contentKind) params.set("contentKind", state.contentKind);
  if (state.sourceKind) params.set("sourceKind", state.sourceKind);
  if (state.stableKey) params.set("stableKey", state.stableKey);
  if (state.entryKind && state.entryId) {
    params.set("entryKind", state.entryKind);
    params.set("entryId", state.entryId);
  }
  return params;
}

function ContextCard({ item }: Readonly<{ item: CorpusItem }>) {
  return <article className="corpus-context">
    <p className="corpus-result__context"><span>{item.leftContext}{item.leftContext ? " " : ""}</span><mark>{item.keyword}</mark><span>{item.rightContext ? ` ${item.rightContext}` : ""}</span></p>
    <div className="corpus-result__meta"><span>{item.sourceTitle}</span><span>{item.document.kind === "article" ? "文章" : "媒体"}</span><span>{locationLabel(item.location)}</span><a href={contentSourceHref(item.document, item.location)}>打开来源</a>{item.entryKind && item.entryId && !item.isContentDiscovery ? <Link href={item.entryKind === "phrase" ? `/read/phrases?search=${encodeURIComponent(item.keyword)}` : `/read/vocabulary?search=${encodeURIComponent(item.keyword)}`}>{item.entryKind === "phrase" ? "查看短语条目" : "查看词条"}</Link> : null}</div>
  </article>;
}

function ClusterCard({ cluster }: Readonly<{ cluster: CorpusCluster }>) {
  return <article className="corpus-cluster">
    <header className="corpus-cluster__header">
      <div><h2 lang="es">{cluster.expression}</h2>{cluster.meaningZh ? <p>{cluster.meaningZh}</p> : null}{cluster.pragmaticPurpose ? <p className="corpus-cluster__purpose">{cluster.pragmaticPurpose}</p> : null}</div>
      <div className="corpus-cluster__kinds" aria-label="可用内容类型">{cluster.contentKinds.map((kind) => <span key={kind}>{contentKindLabels[kind]}</span>)}</div>
    </header>
    <div className="corpus-cluster__lanes">
      {contentKindOrder.map((kind) => {
        const contexts = cluster.contexts.filter((item) => item.contentKind === kind);
        if (!contexts.length) return null;
        return <section className="corpus-cluster__lane" key={kind} aria-labelledby={`corpus-${cluster.entryId}-${kind}`}>
          <h3 id={`corpus-${cluster.entryId}-${kind}`}>{contentKindLabels[kind]}</h3>
          <div className="corpus-cluster__contexts">{contexts.map((item, index) => <ContextCard key={`${item.document.stableKey}:${item.location.kind === "media" ? item.location.startMs : item.location.segmentIndex}:${index}`} item={item} />)}</div>
        </section>;
      })}
    </div>
    <footer className="corpus-cluster__footer">{cluster.isContentDiscovery ? <span>内容发现片段 · 打开每条来源查看完整上下文</span> : <><Link href={`/read/corpus?entryKind=phrase&entryId=${encodeURIComponent(cluster.entryId)}`}>查看这个短语的全部用例</Link><Link href={`/read/phrases?search=${encodeURIComponent(cluster.expression)}`}>查看短语卡</Link></>}</footer>
  </article>;
}

export function CorpusSearch({ initialState, initialPage = 1 }: CorpusSearchProps) {
  const initial = normalizeInitialState(initialState);
  const hasInitialSearch = Boolean(initial.query || (initial.entryKind && initial.entryId));
  const [query, setQuery] = useState(initial.query);
  const [match, setMatch] = useState<MatchMode>(initial.match);
  const [documentKind, setDocumentKind] = useState<SearchState["documentKind"]>(initial.documentKind);
  const [contentKind, setContentKind] = useState<SearchState["contentKind"]>(initial.contentKind);
  const [submitted, setSubmitted] = useState<SearchState | null>(hasInitialSearch ? initial : null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [page, setPage] = useState(initialPage);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const lastRequestRef = useRef<{ mode: "browse" | "search"; search: SearchState; page: number } | null>(null);

  async function request(mode: "browse" | "search", search: SearchState, nextPage: number) {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastRequestRef.current = { mode, search, page: nextPage };
    setState("loading");
    try {
      const params = filterParams(search, nextPage, mode === "browse" ? BROWSE_PAGE_SIZE : FALLBACK_PAGE_SIZE);
      if (mode === "search") params.set("match", search.match);
      const response = await fetch(`/api/v1/corpus/${mode === "browse" ? "browse" : "search"}?${params.toString()}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("CORPUS_UNAVAILABLE");
      const payload = await response.json() as { data?: CorpusBrowseResponse | CorpusResponse };
      if (generation !== generationRef.current) return;
      const data = payload.data ?? (mode === "browse" ? { items: [], page: nextPage, pageSize: BROWSE_PAGE_SIZE, total: 0 } : { items: [], page: nextPage, pageSize: FALLBACK_PAGE_SIZE, total: 0 });
      setResult({ mode, data });
      setPage(nextPage);
      setState("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (generation === generationRef.current) setState("error");
    }
  }

  useEffect(() => {
    queueMicrotask(() => void request(hasInitialSearch ? "search" : "browse", initial, initialPage));
    const onPopState = () => {
      const next = readUrlState();
      setQuery(next.state.query);
      setMatch(next.state.match);
      setDocumentKind(next.state.documentKind);
      setContentKind(next.state.contentKind);
      if (!next.state.query && !(next.state.entryKind && next.state.entryId)) {
        setSubmitted(null);
        void request("browse", next.state, next.page);
        return;
      }
      setSubmitted(next.state);
      void request("search", next.state, next.page);
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
    const nextState: SearchState = { query: query.trim(), match, documentKind, contentKind, sourceKind: "", stableKey: "" };
    setPage(1);
    writeUrlState(nextState, 1);
    if (!nextState.query) {
      setSubmitted(null);
      void request("browse", nextState, 1);
      return;
    }
    setSubmitted(nextState);
    void request("search", nextState, 1);
  }

  function clearSearch() {
    const empty = normalizeInitialState({ documentKind, contentKind });
    generationRef.current += 1;
    abortRef.current?.abort();
    setQuery("");
    setSubmitted(null);
    setPage(1);
    writeUrlState(empty, 1);
    void request("browse", empty, 1);
  }

  function toggleMatch() {
    const nextMatch: MatchMode = match === "phrase" ? "all" : "phrase";
    setMatch(nextMatch);
    if (!submitted) return;
    const search: SearchState = { ...submitted, match: nextMatch };
    setSubmitted(search);
    setPage(1);
    writeUrlState(search, 1);
    void request("search", search, 1);
  }

  const loading = state === "loading";
  const hasSearch = Boolean(submitted && (submitted.query || (submitted.entryKind && submitted.entryId)));
  const browseData = result?.mode === "browse" ? result.data as CorpusBrowseResponse : null;
  const searchData = result?.mode === "search" ? result.data as CorpusResponse : null;
  const pageData = browseData ?? searchData;
  const pageSize = pageData?.pageSize && pageData.pageSize > 0 ? pageData.pageSize : (result?.mode === "browse" ? BROWSE_PAGE_SIZE : FALLBACK_PAGE_SIZE);
  const totalPages = pageData ? Math.min(MAX_PAGE, Math.max(1, Math.ceil(pageData.total / pageSize))) : 1;
  const currentPage = pageData ? Math.min(Math.max(1, Math.trunc(pageData.page)), totalPages) : page;
  const showPagination = Boolean(pageData && pageData.items.length > 0 && totalPages > 1);

  return <section className="corpus-search" aria-label="语料内容浏览">
    <form className="corpus-search__form" onSubmit={submit}>
      <label className="corpus-search__input"><span>可选：筛选短语或来源</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="不输入也可以直接浏览内容" maxLength={120} /></label>
      <label className="corpus-search__match"><span>匹配方式</span><select value={match} onChange={(event) => setMatch(event.target.value as MatchMode)}><option value="phrase">连续短语</option><option value="all">包含全部词</option></select></label>
      <label className="corpus-search__filter"><span>内容类型</span><select value={contentKind || documentKind} onChange={(event) => { const value = event.target.value; if (value === "article") { setContentKind("article"); setDocumentKind(""); } else if (value === "video" || value === "podcast") { setContentKind(value); setDocumentKind(""); } else { setContentKind(""); setDocumentKind(""); } }}><option value="">全部</option><option value="article">文章</option><option value="video">视频</option><option value="podcast">播客</option></select></label>
      <button type="submit">{loading ? "加载中…" : hasSearch ? "筛选" : "应用筛选"}</button>
    </form>
    <div className="corpus-search__status" aria-live="polite" aria-busy={loading}>
      {loading ? <p className="corpus-search__loading" role="status">正在加载，保留上一组内容…</p> : null}
      {state === "error" ? <div className="corpus-search__error" role="alert"><span>语料内容暂时不可用，请稍后再试。</span><span>已有内容仍保留。</span><button type="button" onClick={() => { const last = lastRequestRef.current; if (last) void request(last.mode, last.search, last.page); }}>重试</button></div> : null}
      {state === "idle" && result?.mode === "browse" && browseData?.items.length === 0 ? <div className="corpus-search__empty"><h2>暂时还没有可比较的语料</h2><p>已发布文章、视频或播客形成短语上下文后，会在这里按表达聚类展示。</p><button type="button" onClick={() => void request("browse", normalizeInitialState({ documentKind, contentKind }), 1)}>重新加载内容</button></div> : null}
      {state === "idle" && result?.mode === "search" && searchData?.items.length === 0 ? <div className="corpus-search__empty"><h2>没有找到匹配的用例</h2><p>没有找到同时包含这些词的内容。</p><p>{submitted?.match === "phrase" ? "当前按连续短语和原始顺序匹配。" : "当前按同一片段包含全部词匹配。"} 可以清除筛选或切换匹配方式再试一次。</p><div className="corpus-search__empty-actions"><button type="button" onClick={clearSearch}>回到全部内容</button><button type="button" onClick={toggleMatch}>切换匹配方式</button></div></div> : null}
      {state === "idle" && pageData && pageData.items.length > 0 ? <p className="corpus-search__count">{result?.mode === "browse" ? `正在浏览 ${pageData.total} 组短语上下文` : <><span>找到 {pageData.total} 条出现记录</span><span> · 当前为{submitted?.match === "phrase" ? "连续短语" : "包含全部词"}匹配</span></>}</p> : null}
    </div>
    {browseData && browseData.items.length > 0 ? <div className="corpus-clusters">{browseData.items.map((cluster) => <ClusterCard key={cluster.entryId} cluster={cluster} />)}</div> : null}
    {searchData && searchData.items.length > 0 ? <div className="corpus-results">{searchData.items.map((item, index) => <ContextCard key={`${item.document.kind}:${item.document.stableKey}:${item.document.version}:${item.location.kind === "media" ? item.location.startMs : item.location.segmentIndex}:${index}`} item={item} />)}</div> : null}
    {showPagination && pageData ? <nav className="lexicon-pagination" aria-label="语料分页"><button type="button" disabled={loading || currentPage <= 1} onClick={() => { const next = currentPage - 1; const search = submitted ?? normalizeInitialState({ documentKind, contentKind }); writeUrlState(search, next); void request(result?.mode ?? "browse", search, next); }}>上一页</button><span>第 {currentPage} / {totalPages} 页</span><button type="button" disabled={loading || currentPage >= totalPages} onClick={() => { const next = currentPage + 1; const search = submitted ?? normalizeInitialState({ documentKind, contentKind }); writeUrlState(search, next); void request(result?.mode ?? "browse", search, next); }}>下一页</button></nav> : null}
  </section>;
}
