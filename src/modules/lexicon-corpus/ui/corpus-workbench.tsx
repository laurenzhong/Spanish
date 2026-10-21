"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReadAloud } from "@/src/modules/providers/tts/use-read-aloud";
import { contentSourceHref } from "../domain/content-reference";
import { corpusHighlightRanges } from "../domain/corpus-highlight";
import { corpusArticleExcerpt } from "../domain/corpus-excerpt";
import { corpusExamplesPageSchema, corpusExamplesQuerySchema, type CorpusExampleItem, type CorpusExamplesPage, type CorpusExamplesQuery } from "../schemas/corpus-examples";

const kinds = [{ value: "", label: "全部" }, { value: "article", label: "文章" }, { value: "video", label: "视频" }, { value: "podcast", label: "播客" }] as const;
const examples = ["por eso", "tener que", "a veces", "quedar"];
const labels = { article: "文章", video: "视频", podcast: "播客" };

function Icon({ name }: { name: "search" | "sound" | "arrow" | "compare" | "close" }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    sound: <><path d="m11 5-6 4H2v6h3l6 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    compare: <><path d="M3 5h7v14H3zM14 5h7v14h-7z" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Highlight({ text, query, match }: { text: string; query: string; match: "phrase" | "all" }) {
  const ranges = corpusHighlightRanges(text, query, match);
  const pieces: ReactNode[] = [];
  let offset = 0;
  for (const range of ranges) {
    pieces.push(text.slice(offset, range.start), <mark key={range.start}>{text.slice(range.start, range.end)}</mark>);
    offset = range.end;
  }
  pieces.push(text.slice(offset));
  return <>{pieces}</>;
}

function readState(): CorpusExamplesQuery {
  const params = new URLSearchParams(window.location.search);
  const values = Object.fromEntries(params);
  values.query = params.get("q") ?? params.get("query") ?? "";
  // Historical media links used match=surface to mean one exact surface form.
  if (values.match === "surface") values.match = "phrase";
  const parsed = corpusExamplesQuerySchema.safeParse(values);
  return parsed.success ? parsed.data : corpusExamplesQuerySchema.parse({});
}

function writeState(state: CorpusExamplesQuery) {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["q", "query", "match", "page", "contentKind", "documentKind", "sourceKind", "stableKey", "entryKind", "entryId", "pageSize"]) params.delete(key);
  if (state.query) { params.set("q", state.query); params.set("match", state.match); }
  for (const key of ["contentKind", "documentKind", "sourceKind", "stableKey", "entryKind", "entryId"] as const) if (state[key]) params.set(key, state[key]);
  if (state.page > 1) params.set("page", String(state.page));
  const suffix = params.toString();
  window.history.pushState(null, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`);
}

export function CorpusWorkbench({ initialState }: { initialState: CorpusExamplesQuery }) {
  const [applied, setApplied] = useState(initialState);
  const [draft, setDraft] = useState(initialState.query);
  const [result, setResult] = useState<{ data: CorpusExamplesPage; query: CorpusExamplesQuery } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const [comparison, setComparison] = useState<CorpusExampleItem[]>([]);
  const [notice, setNotice] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const generationRef = useRef(0);
  const speech = useReadAloud();
  const { stop } = speech;

  useEffect(() => {
    const pop = () => { const next = readState(); setDraft(next.query); setApplied(next); stop(); };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [stop]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    queueMicrotask(() => { if (!controller.signal.aborted) setStatus("loading"); });
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(applied)) if (value !== undefined && value !== "") params.set(key, String(value));
    void (async () => {
      try {
        const response = await fetch(`/api/v1/corpus/examples?${params}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("CORPUS_UNAVAILABLE");
        const payload: unknown = await response.json();
        const data = corpusExamplesPageSchema.parse((payload as { data?: unknown })?.data);
        if (generation !== generationRef.current || controller.signal.aborted) return;
        setResult({ data, query: applied });
        setStatus("ready");
      } catch {
        if (generation === generationRef.current && (!controller.signal.aborted || timedOut)) setStatus("error");
      } finally { window.clearTimeout(timer); }
    })();
    return () => { generationRef.current = generation + 1; controller.abort(); window.clearTimeout(timer); };
  }, [applied, retry]);

  function navigate(next: Partial<CorpusExamplesQuery>) {
    const merged = { ...applied, page: 1, ...next };
    stop();
    speech.clearError();
    setNotice("");
    setApplied(merged);
    writeState(merged);
  }

  function search(query: string) {
    setDraft(query);
    navigate({ query: query.trim(), entryId: undefined, entryKind: undefined, stableKey: undefined, sourceKind: undefined });
  }

  function speakButton(item: CorpusExampleItem, prefix = "example") {
    const id = `${prefix}:${item.id}`;
    const active = speech.speakingId === id;
    return <button className="corpus-tool" type="button" aria-label={`${active ? "停止" : "朗读"}：${item.text}`} aria-pressed={active} onClick={() => {
      setUnsupported(false);
      if (active) stop(); else speech.speak(id, item.text, () => setUnsupported(true));
    }}><Icon name="sound" /><span>{active ? "停止" : "朗读"}</span></button>;
  }

  function sourceLink(item: CorpusExampleItem) {
    return <a className="corpus-source-link" href={contentSourceHref(item.document, item.location)} target="_blank" rel="noopener noreferrer" aria-label={`${item.contentKind === "article" ? "读原文" : "到原处听"}：${item.sourceTitle}（新标签页）`}>
      {item.contentKind === "article" ? "读原文" : "到原处听"}<Icon name="arrow" />
    </a>;
  }

  function toggleComparison(item: CorpusExampleItem) {
    if (comparison.some((entry) => entry.id === item.id)) {
      if (speech.speakingId === `comparison:${item.id}`) stop();
      setComparison((entries) => entries.filter((entry) => entry.id !== item.id));
      setNotice("");
    } else if (comparison.length < 3) { setComparison((entries) => [...entries, item]); setNotice(""); }
    else setNotice("最多同时对照3条，请先移除一条。");
  }

  const loading = status === "loading";
  const data = result?.data;
  const displayed = result?.query ?? applied;
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const hasScope = Boolean(applied.entryId || applied.stableKey || applied.sourceKind || applied.documentKind);
  const pageOutOfRange = Boolean(data && data.total > 0 && !data.items.length);

  return <div className="corpus-workbench">
    <div className="corpus-workspace">
      <section className="corpus-main" aria-label="真实用例查询">
        <form className="corpus-query" onSubmit={(event) => { event.preventDefault(); search(draft); }}>
          <label htmlFor="corpus-query"><Icon name="search" /><span className="sr-only">搜索西语单词或短语</span></label>
          <input id="corpus-query" type="search" value={draft} maxLength={120} placeholder="输入西语单词或短语" onChange={(event) => setDraft(event.target.value)} />
          <button type="submit">查用法<Icon name="arrow" /></button>
        </form>
        <div className="corpus-query-options">
          <div role="group" aria-label="查询匹配方式"><button type="button" aria-pressed={applied.match === "phrase"} onClick={() => navigate({ match: "phrase" })}>按原词序</button><button type="button" aria-pressed={applied.match === "all"} onClick={() => navigate({ match: "all" })}>同段包含全部词</button></div>
          <button className="corpus-translation-toggle" type="button" aria-pressed={showTranslation} onClick={() => setShowTranslation((value) => !value)}>{showTranslation ? "隐藏译文" : "显示译文"}</button>
        </div>
        {!applied.query && !hasScope ? <div className="corpus-suggestions"><span>试着查</span>{examples.map((query) => <button type="button" lang="es" key={query} onClick={() => search(query)}>{query}<span aria-hidden="true">↗</span></button>)}</div> : null}
        <div className="corpus-type-tabs" role="group" aria-label="用例内容类型">{kinds.map((kind) => <button key={kind.value} type="button" aria-pressed={(applied.contentKind ?? "") === kind.value} onClick={() => navigate({ contentKind: kind.value || undefined, documentKind: undefined })}>{kind.label}</button>)}</div>
        {hasScope ? <p className="corpus-scope">仅查看传入的词条或来源范围。<button type="button" onClick={() => navigate({ entryId: undefined, entryKind: undefined, stableKey: undefined, sourceKind: undefined, documentKind: undefined })}>查全部资料</button></p> : null}
        <div className="corpus-feedback" aria-live="polite" aria-atomic="true">
          {status === "error" ? <p role="alert">暂时无法读取真实用例。{data ? "上一组结果仍保留。" : ""}<button type="button" onClick={() => { stop(); setRetry((value) => value + 1); }}>重试</button></p> : loading ? <p role="status">{data ? "正在查询，上一组结果仍保留…" : "正在读取真实用例…"}</p> : <p>{data?.total ?? 0} 条{displayed.query ? `“${displayed.query}”的` : "真实"}用例{displayed.query ? " · 匹配具体词形，忽略大小写与重音" : " · 按来源交错展示"}</p>}
          {notice ? <p>{notice}</p> : null}
          {unsupported || speech.errorMessage ? <p role="alert">{unsupported ? "当前浏览器不支持合成朗读，可以到原处听。" : speech.errorMessage}</p> : null}
        </div>
        {comparison.length ? <section className="corpus-comparison" aria-label="用例对照">
          <header><div><Icon name="compare" /><h2>放在一起看 <span>{comparison.length} / 3</span></h2></div><button type="button" onClick={() => { if (speech.speakingId?.startsWith("comparison:")) stop(); setComparison([]); setNotice(""); }}>清空对照</button></header>
          <div className="corpus-comparison__grid">{comparison.map((item, index) => <article key={item.id}><div className="corpus-comparison__meta"><span>0{index + 1} · {labels[item.contentKind]}</span><button type="button" aria-label={`移除对照：${item.sourceTitle}`} onClick={() => toggleComparison(item)}><Icon name="close" /></button></div><p lang="es">{item.text}</p>{showTranslation && item.translation ? <p className="corpus-translation">{item.translation}</p> : null}<p className="corpus-comparison__title">{item.sourceTitle}</p><footer>{speakButton(item, "comparison")}{sourceLink(item)}</footer></article>)}</div>
          <p className="corpus-comparison__note">对比搭配、句型和前后语境。对照仅保留在本页，刷新后清除。</p>
        </section> : null}
        {data?.items.length ? <div className="corpus-example-list" aria-label="真实用例" aria-busy={loading}>{data.items.map((item, index) => {
          const selected = comparison.some((entry) => entry.id === item.id);
          // Existing translations belong to full segments; do not pair them with a shortened sentence.
          const text = item.contentKind === "article" && !item.translation ? corpusArticleExcerpt(item.text, displayed.query, displayed.match) : item.text;
          const excerpted = text !== item.text;
          const displayItem = excerpted ? { ...item, text } : item;
          return <article key={item.id} className="corpus-example">
            <div className="corpus-example__number" aria-hidden="true">{String((data.page - 1) * data.pageSize + index + 1).padStart(2, "0")}</div>
            <div className="corpus-example__body">
              <div className="corpus-example__meta"><span>{labels[item.contentKind]}</span><span>{item.sourceName}</span><span>{item.location.kind === "text" ? `第${item.location.segmentIndex + 1}段` : `${Math.floor(item.location.startMs / 60000)}:${String(Math.floor(item.location.startMs / 1000) % 60).padStart(2, "0")}`}</span></div>
              <p className="corpus-example__text" lang="es"><Highlight text={text} query={displayed.query} match={displayed.match} /></p>
              {excerpted ? <p className="corpus-example__excerpt-note">{displayed.query ? "显示命中句" : "显示段落开头"} · 展开前后文可读完整段落</p> : null}
              {showTranslation && item.translation ? <p className="corpus-translation">{item.translation}</p> : null}
              <p className="corpus-example__title">{item.sourceTitle}</p>
              <div className="corpus-example__actions">{speakButton(displayItem)}<button type="button" className="corpus-tool" aria-pressed={selected} onClick={() => toggleComparison(displayItem)}><Icon name="compare" /><span>{selected ? "已加入对照" : "加入对照"}</span></button>{sourceLink(item)}</div>
              <details className="corpus-context-detail"><summary>展开前后文</summary><div>{item.before ? <p lang="es">{item.before}</p> : <p className="corpus-context-detail__edge">已到当前来源的开头</p>}<p className="corpus-context-detail__current" lang="es">{item.text}</p>{item.after ? <p lang="es">{item.after}</p> : <p className="corpus-context-detail__edge">已到当前来源的结尾</p>}</div></details>
            </div>
          </article>;
        })}</div> : status === "ready" ? <div className="corpus-empty"><span aria-hidden="true">∅</span>
          <h2>{pageOutOfRange ? "这一页没有用例" : applied.query ? "暂时没有这个说法的用例" : "当前范围还没有可用语料"}</h2>
          <p>{pageOutOfRange ? "结果数量可能已变化，可以保留查询条件返回第一页。" : applied.query ? "只查询资料库已有原文。试试更短的词组、实际变位，或切换“同段包含全部词”。" : "已发布文章和已审核字幕会出现在这里。也可以先去短语页学实用说法。"}</p>
          <button type="button" onClick={() => {
            if (pageOutOfRange) { navigate({ page: 1 }); return; }
            setDraft(""); navigate({ query: "", contentKind: undefined, documentKind: undefined, stableKey: undefined, sourceKind: undefined, entryId: undefined, entryKind: undefined });
          }}>{pageOutOfRange ? "返回第一页" : "浏览全部用例"}</button>
        </div> : !data ? <div className="corpus-initial-placeholder" aria-hidden="true"><div /><div /><div /></div> : null}
        {data && data.items.length > 0 && pages > 1 ? <nav className="corpus-pagination" aria-label="语料分页"><button type="button" disabled={loading || data.page <= 1} onClick={() => navigate({ page: data.page - 1 })}>上一页</button><span>第 {data.page} / {pages} 页</span><button type="button" disabled={loading || data.page >= pages} onClick={() => navigate({ page: data.page + 1 })}>下一页</button></nav> : null}
      </section>
      <aside className="corpus-guide"><p className="corpus-guide__eyebrow">从知道，到会用</p><h2>把词放回<br />真实语境里。</h2><p>看看它和哪些词一起出现，前一句说了什么，下一句又怎样回应。</p><ol><li><span>01</span><div><strong>查一句</strong><p>单词或词组都可以。不同变位要按实际词形查。</p></div></li><li><span>02</span><div><strong>多看几处</strong><p>把两三条加入对照，观察不同内容里的搭配。</p></div></li><li><span>03</span><div><strong>回到原处听读</strong><p>查看原文或跳到字幕时间点，保留完整情境。</p></div></li></ol><details><summary>这里的内容与声音</summary><p>来自资料库的已发布文章与已审核字幕。译文只展示来源已有的内容；字幕片段可能跨句，需要结合前后文。“朗读”为浏览器合成声音，“到原处听”进入原播放器。</p></details></aside>
    </div>
  </div>;
}
