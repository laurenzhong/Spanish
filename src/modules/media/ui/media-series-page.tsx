"use client";

import Link from "next/link";

import { MediaCardView } from "./media-card";
import { useMediaSeriesEpisodes } from "./use-media-series-episodes";
import "./media-series.css";

export function MediaSeriesPage({ seriesKey }: Readonly<{ seriesKey: string }>) {
  return <SeriesPage key={seriesKey} seriesKey={seriesKey} />;
}

export function MediaSeriesReadNotice({ error, retry }: Readonly<{ error: "unavailable" | "cursor-invalid" | "timeout" | "failed"; retry: () => void }>) {
  return <div className="media-series__notice" role="alert">
    <p>{error === "unavailable" ? "这个系列当前不可用。" : error === "cursor-invalid" ? "系列已更新，请重新读取列表。" : error === "timeout" ? "读取超时，请重试。" : "暂时无法读取单集，请重试。"}</p>
    <button type="button" onClick={retry}>{error === "cursor-invalid" ? "重新读取" : "重试"}</button>
  </div>;
}

function SeriesPage({ seriesKey }: Readonly<{ seriesKey: string }>) {
  const state = useMediaSeriesEpisodes(seriesKey);
  return <section className="media-series-page">
    <Link className="media-series__back" href="/learn">返回资料库</Link>
    {state.data ? <header className="media-series-page__header">
      <p className="media-series__eyebrow">{state.data.series.kind === "video" ? "视频系列" : "播客节目"}</p>
      <h1>{state.data.series.title}</h1>
      {state.data.series.summary ? <p>{state.data.series.summary}</p> : null}
      <p className="media-series__count">本站已收录 {state.data.series.episodeCount} 集</p>
    </header> : null}
    {state.status === "loading" ? <p role="status" className="media-series__notice">正在读取系列…</p> : null}
    {state.error ? <MediaSeriesReadNotice error={state.error} retry={state.retry} /> : null}
    {state.data && state.status !== "error" ? <>
      {state.data.items.length ? <div className="media-series-page__grid" aria-busy={state.status === "loading"}>
        {state.data.items.map((item) => <MediaCardView key={item.id} item={item} />)}
      </div> : <p className="media-series__notice">暂无可播放的单集。</p>}
      <nav className="media-series__pagination" aria-label="系列分页">
        <button type="button" disabled={state.pageNumber === 1 || state.status === "loading"} onClick={state.previousPage}>上一页</button>
        <span>第 {state.pageNumber} 页</span>
        <button type="button" disabled={!state.data.hasMore || state.status === "loading"} onClick={state.nextPage}>下一页</button>
      </nav>
    </> : null}
  </section>;
}
