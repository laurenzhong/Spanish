import Link from "next/link";

import type { MediaCard } from "../domain";
import type { MediaListQuery } from "../schemas";
import { MediaCardView } from "./media-card";
import { MediaLibraryToolbar } from "./media-library-toolbar";

export type MediaLibraryResult = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

function queryHref(query: MediaListQuery, patch: Partial<Record<keyof MediaListQuery, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...patch })) {
    if (value !== undefined && value !== "" && key !== "pageSize" && !(key === "sort" && value === "recently_added")) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/learn?${search}` : "/learn";
}

export function MediaLibrary({ result, query, unavailable = false }: Readonly<{ result: MediaLibraryResult; query: MediaListQuery; unavailable?: boolean }>) {
  const hasFilters = Boolean(query.search || query.kind || query.region || query.cefr || query.duration);
  const tabs = [[undefined, "全部"], ["video", "视频"], ["podcast", "播客"]] as const;
  return (
    <div className="page-stack media-library" data-testid="media-library">
      <header className="media-library__topbar">
        <Link className="media-library__wordmark" href="/learn" aria-label="Sueño 学习首页">Sue<span>ñ</span>o</Link>
        <nav className="media-library__topnav" aria-label="学习频道">
          {tabs.map(([kind, label]) => <Link aria-current={query.kind === kind || (!query.kind && !kind) ? "page" : undefined} href={queryHref(query, { cursor: undefined, kind })} key={label}>{label}</Link>)}
        </nav>
        <form action="/learn" className="media-library__search" role="search">
          {query.kind ? <input name="kind" type="hidden" value={query.kind} /> : null}
          <label htmlFor="media-search">搜索视频和播客</label>
          <div><input defaultValue={query.search ?? ""} id="media-search" maxLength={120} name="search" placeholder="搜索西语内容" type="search" /><button aria-label="提交搜索" type="submit"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 5 5" /></svg></button></div>
        </form>
      </header>
      <h1 className="sr-only">学习媒体库</h1>
      <MediaLibraryToolbar query={query} />
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
      {result.hasMore && result.nextCursor ? <Link className="media-library__load-more" href={queryHref(query, { cursor: result.nextCursor })}>加载更多</Link> : null}
    </div>
  );
}
