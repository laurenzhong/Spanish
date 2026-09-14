"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { MediaListQuery } from "../schemas";

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function HiddenFields({ query }: Readonly<{ query: MediaListQuery }>) {
  return <>{query.search ? <input name="search" type="hidden" value={query.search} /> : null}{query.kind ? <input name="kind" type="hidden" value={query.kind} /> : null}</>;
}

export function MediaLibraryToolbar({ query }: Readonly<{ query: MediaListQuery }>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasFilters = Boolean(query.region || query.cefr || query.duration);
  const selectedCount = [query.region, query.cefr, query.duration].filter(Boolean).length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <section className="media-library__toolbar" aria-label="媒体筛选工具">
      <div className="media-library__toolbar-row">
        <button ref={triggerRef} className="media-library__filter-trigger" type="button" aria-expanded={open} aria-controls="media-library-filters" onClick={() => setOpen((current) => !current)}><FilterIcon /><span>筛选</span>{selectedCount ? <b aria-label={`${selectedCount} 个筛选条件`}>{selectedCount}</b> : null}</button>
        <span className="media-library__filter-summary">{hasFilters ? `${selectedCount} 个条件已应用` : "浏览全部已发布内容"}</span>
        <form className="media-library__sort" action="/learn">
          <HiddenFields query={query} />
          {query.region ? <input name="region" type="hidden" value={query.region} /> : null}{query.cefr ? <input name="cefr" type="hidden" value={query.cefr} /> : null}{query.duration ? <input name="duration" type="hidden" value={query.duration} /> : null}
          <label htmlFor="media-sort">排序</label><select id="media-sort" name="sort" defaultValue={query.sort ?? "recently_added"}><option value="recently_added">最近收录</option><option value="newest">最新发布</option><option value="recently_played">最近继续</option></select>
        </form>
        {hasFilters ? <Link className="media-library__clear" href={query.kind ? `/learn?kind=${query.kind}` : "/learn"}>清除筛选</Link> : null}
      </div>
      {open ? (
        <div ref={dialogRef} id="media-library-filters" className="media-library__filter-panel" role="dialog" aria-modal="false" aria-labelledby="media-library-filters-title" tabIndex={-1}>
          <div className="media-library__filter-panel-head"><h2 id="media-library-filters-title">筛选内容</h2><button type="button" aria-label="关闭筛选" onClick={close}><CloseIcon /></button></div>
          <form action="/learn"><HiddenFields query={query} /><div className="media-library__filter-fields">
            <label><span>地区</span><select defaultValue={query.region ?? ""} name="region"><option value="">全部地区</option><option value="es-ES">西班牙</option><option value="latin-amer">拉丁美洲</option><option value="unknown">地区未知</option></select></label>
            <label><span>难度</span><select defaultValue={query.cefr ?? ""} name="cefr"><option value="">全部难度</option><option value="A2">A2</option><option value="B1">B1</option></select></label>
            <label><span>时长</span><select defaultValue={query.duration ?? ""} name="duration"><option value="">全部时长</option><option value="short">5 分钟内</option><option value="medium">5–20 分钟</option><option value="long">20 分钟以上</option></select></label>
          </div><div className="media-library__filter-actions"><button type="submit">应用筛选</button><button type="button" className="media-library__filter-cancel" onClick={close}>取消</button></div></form>
        </div>
      ) : null}
    </section>
  );
}
