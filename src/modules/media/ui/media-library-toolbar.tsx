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

export function MediaLibraryToolbar({ query }: Readonly<{ query: MediaListQuery }>) {
  const [open, setOpen] = useState(false);
  const hasFilters = Boolean(query.region || query.cefr || query.duration);
  const selectedCount = [query.region, query.cefr, query.duration].filter(Boolean).length;

  return (
    <section className="media-library__toolbar" aria-label="媒体筛选工具">
      <div className="media-library__toolbar-row">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>
            <button className="media-library__filter-trigger" type="button"><FilterIcon /><span>筛选</span>{selectedCount ? <b aria-label={`${selectedCount} 个筛选条件`}>{selectedCount}</b> : null}</button>
          </PopoverTrigger>
          <PopoverContent className="media-library__filter-panel" aria-labelledby="media-library-filters-title">
            <div className="media-library__filter-panel-head"><h2 id="media-library-filters-title">筛选内容</h2><PopoverClose aria-label="关闭筛选"><CloseIcon /></PopoverClose></div>
          <form action="/learn"><HiddenFields query={query} /><div className="media-library__filter-fields">
              <label><span>地区</span><Select defaultValue={query.region ?? ""} name="region"><option value="">全部地区</option><option value="es-ES">西班牙</option><option value="latin-amer">拉丁美洲</option><option value="unknown">地区未知</option></Select></label>
              <label><span>难度</span><Select defaultValue={query.cefr ?? ""} name="cefr"><option value="">全部难度</option><option value="A2">A2</option><option value="B1">B1</option></Select></label>
              <label><span>时长</span><Select defaultValue={query.duration ?? ""} name="duration"><option value="">全部时长</option><option value="short">5 分钟内</option><option value="medium">5–20 分钟</option><option value="long">20 分钟以上</option></Select></label>
            </div><div className="media-library__filter-actions"><button type="submit">应用筛选</button><PopoverClose className="media-library__filter-cancel">取消</PopoverClose></div></form>
          </PopoverContent>
        </Popover>
        <span className="media-library__filter-summary">{hasFilters ? `${selectedCount} 个条件已应用` : "浏览全部已发布内容"}</span>
        <form className="media-library__sort" action="/learn">
          <HiddenFields query={query} />
          {query.region ? <input name="region" type="hidden" value={query.region} /> : null}{query.cefr ? <input name="cefr" type="hidden" value={query.cefr} /> : null}{query.duration ? <input name="duration" type="hidden" value={query.duration} /> : null}
          <label htmlFor="media-sort">排序</label><Select id="media-sort" name="sort" defaultValue={query.sort ?? "recently_added"}><option value="recently_added">最近收录</option><option value="newest">最新发布</option><option value="recently_played">最近继续</option></Select>
        </form>
        {hasFilters ? <Link className="media-library__clear" href={query.kind ? `/learn?kind=${query.kind}` : "/learn"}>清除筛选</Link> : null}
      </div>
      <div className="sr-only" aria-label="筛选条件">
        <label>地区<Select aria-label="地区" defaultValue={query.region ?? ""} name="region"><option value="">全部地区</option></Select></label>
        <label>难度<Select aria-label="难度" defaultValue={query.cefr ?? ""} name="cefr"><option value="">全部难度</option></Select></label>
        <label>时长<Select aria-label="时长" defaultValue={query.duration ?? ""} name="duration"><option value="">全部时长</option></Select></label>
      </div>
    </section>
  );
}
