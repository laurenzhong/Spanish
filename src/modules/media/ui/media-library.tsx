import Link from "next/link";

import type { MediaCard } from "../domain";
import type { MediaListQuery } from "../schemas";
import { MediaCardView } from "./media-card";

export type MediaLibraryResult = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

function queryHref(query: MediaListQuery, patch: Partial<Record<keyof MediaListQuery, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...patch })) {
    if (value !== undefined && value !== "" && key !== "pageSize" && !(key === "sort" && value === "recently_added")) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `/learn?${search}` : "/learn";
}

export function MediaLibrary({ result, query, unavailable = false }: Readonly<{
  result: MediaLibraryResult;
  query: MediaListQuery;
  unavailable?: boolean;
}>) {
  const hasFilters = Boolean(query.search || query.kind || query.region || query.cefr || query.duration);
  const tabs = [[undefined, "全部"], ["video", "视频"], ["podcast", "播客"]] as const;
  return (
    <div className="page-stack media-library">
      <header className="media-library__header">
        <div><p className="eyebrow eyebrow--accent">学习</p><h1>看点、听点真实西语</h1></div>
        <form action="/learn" className="media-library__search" role="search">
          {query.kind ? <input name="kind" type="hidden" value={query.kind} /> : null}
          <label htmlFor="media-search">搜索视频和播客</label>
          <div><input defaultValue={query.search ?? ""} id="media-search" maxLength={120} name="search" placeholder="标题、节目、主题…" type="search" /><button type="submit">搜索</button></div>
        </form>
      </header>
      <nav className="media-kind-tabs" aria-label="媒体类型">
        {tabs.map(([kind, label]) => <Link aria-current={query.kind === kind || (!query.kind && !kind) ? "page" : undefined} href={queryHref(query, { cursor: undefined, kind })} key={label}>{label}</Link>)}
      </nav>
      <form action="/learn" className="media-library__filters" aria-label="筛选媒体内容">
        {query.search ? <input name="search" type="hidden" value={query.search} /> : null}
        {query.kind ? <input name="kind" type="hidden" value={query.kind} /> : null}
        <label>
          <span>地区</span>
          <select defaultValue={query.region ?? ""} name="region">
            <option value="">全部地区</option>
            <option value="es-ES">西班牙</option>
            <option value="latin-amer">拉丁美洲</option>
            <option value="unknown">地区未知</option>
          </select>
        </label>
        <label>
          <span>难度</span>
          <select defaultValue={query.cefr ?? ""} name="cefr">
            <option value="">全部难度</option>
            <option value="A2">A2</option>
            <option value="B1">B1</option>
          </select>
        </label>
        <label>
          <span>时长</span>
          <select defaultValue={query.duration ?? ""} name="duration">
            <option value="">全部时长</option>
            <option value="short">5 分钟内</option>
            <option value="medium">5–20 分钟</option>
            <option value="long">20 分钟以上</option>
          </select>
        </label>
        <label>
          <span>排序</span>
          <select defaultValue={query.sort ?? "recently_added"} name="sort">
            <option value="recently_added">最近收录</option>
            <option value="newest">最新发布</option>
            <option value="recently_played">最近继续</option>
          </select>
        </label>
        <button type="submit">应用筛选</button>
      </form>
      {unavailable ? <p className="media-library__notice" role="alert">媒体资料库暂时无法读取，请稍后重试。</p> : null}
      {result.items.length > 0 ? (
        <div className="media-grid" aria-label="视频和播客">{result.items.map((item) => <MediaCardView item={item} key={item.id} />)}</div>
      ) : (
        <section className="media-library__empty">
          <p className="eyebrow">{hasFilters ? "没有匹配内容" : "内容准备中"}</p>
          <h2>{hasFilters ? "换个筛选条件看看" : "媒体资料库正在准备中"}</h2>
          <p>{hasFilters ? "当前条件下没有可播放的已发布内容。" : "通过审核的视频和播客会直接出现在这里，不会用示例卡片冒充真实内容。"}</p>
          {hasFilters ? <Link href="/learn">清除筛选</Link> : null}
        </section>
      )}
      {result.hasMore && result.nextCursor ? <Link href={queryHref(query, { cursor: result.nextCursor })}>加载更多</Link> : null}
    </div>
  );
}
