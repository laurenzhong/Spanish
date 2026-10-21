"use client";

import Link from "next/link";
import { useState } from "react";

import type { MediaListQuery } from "../schemas";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger, Select } from "@/src/shared/ui/primitives";

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function HiddenFields({ query }: Readonly<{ query: MediaListQuery }>) {
  return <>{query.search ? <input name="search" type="hidden" value={query.search} /> : null}{query.kind ? <input name="kind" type="hidden" value={query.kind} /> : null}{query.topic ? <input name="topic" type="hidden" value={query.topic} /> : null}</>;
}

// The controls live on the header rule instead of owning a second, mostly empty
// band above the grid: the filter trigger and the sort select share the line
// with the channel tabs and the search field, so the first card row rises by a
// whole toolbar height.
export function MediaLibraryToolbar({ query, browsing = false, onBrowse }: Readonly<{ query: MediaListQuery; browsing?: boolean; onBrowse?: () => void }>) {
  const [open, setOpen] = useState(false);
  const hasFilters = Boolean(query.region || query.cefr || query.duration);
  const selectedCount = [query.region, query.cefr, query.duration].filter(Boolean).length;

  return (
    <section className="media-library__toolbar" aria-label="媒体筛选工具">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger>
          <button aria-label={selectedCount ? `筛选，已应用 ${selectedCount} 个条件` : "筛选"} className="media-library__filter-trigger" type="button"><FilterIcon /><span>筛选</span>{selectedCount ? <b aria-hidden="true">{selectedCount}</b> : null}</button>
        </PopoverTrigger>
        <PopoverContent align="end" className="media-library__filter-panel" aria-labelledby="media-library-filters-title">
          <div className="media-library__filter-panel-head"><h2 id="media-library-filters-title">筛选内容</h2><PopoverClose aria-label="关闭筛选"><CloseIcon /></PopoverClose></div>
          <form action="/learn"><HiddenFields query={query} />{browsing ? <input name="view" type="hidden" value="browse" /> : null}<input name="sort" type="hidden" value={query.sort ?? "recently_added"} /><div className="media-library__filter-fields">
            <label><span>地区</span><Select defaultValue={query.region ?? ""} name="region"><option value="">全部地区</option><option value="es-ES">西班牙</option><option value="latin-amer">拉丁美洲</option><option value="unknown">地区未知</option></Select></label>
            <label><span>难度</span><Select defaultValue={query.cefr ?? ""} name="cefr"><option value="">全部难度</option><option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option></Select></label>
            <label><span>时长</span><Select defaultValue={query.duration ?? ""} name="duration"><option value="">全部时长</option><option value="short">5 分钟内</option><option value="medium">5–20 分钟</option><option value="long">20 分钟以上</option></Select></label>
          </div><div className="media-library__filter-actions">
            {hasFilters ? <Link className="media-library__filter-clear" href={query.kind ? `/learn?kind=${query.kind}` : "/learn"}>清除筛选</Link> : null}
            <button type="submit">应用筛选</button><PopoverClose className="media-library__filter-cancel">取消</PopoverClose>
          </div></form>
        </PopoverContent>
      </Popover>
      <form className="media-library__sort" action="/learn">
        <HiddenFields query={query} />
        {query.region ? <input name="region" type="hidden" value={query.region} /> : null}{query.cefr ? <input name="cefr" type="hidden" value={query.cefr} /> : null}{query.duration ? <input name="duration" type="hidden" value={query.duration} /> : null}
        <label htmlFor="media-sort">排序</label><Select id="media-sort" name="sort" value={browsing ? "browse" : query.sort ?? "recently_added"} onChange={(event) => {
          if (event.currentTarget.value === "browse") onBrowse?.();
          else event.currentTarget.form?.requestSubmit();
        }}><option value="recently_added">最近收录</option><option value="newest">最新发布</option><option value="recently_played">最近继续</option><option value="browse">随便看看</option></Select>
      </form>
    </section>
  );
}
