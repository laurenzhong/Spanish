"use client";

import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./activity-heatmap.module.css";

export type ActivityHeatmapDay = Readonly<{
  /** ISO calendar date (YYYY-MM-DD), independent of the browser time zone. */
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
}>;

type Props = Readonly<{
  /** Ascending, unique calendar dates; missing dates remain blank. */
  days: readonly ActivityHeatmapDay[];
  selectedDate?: string;
  onSelect: (date: string) => void;
  label: string;
  legend: readonly [string, string, string, string, string];
}>;

const dayMs = 86_400_000;
const timestamp = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

export function ActivityHeatmap({ days, selectedDate, onSelect, label, legend }: Props) {
  const helpId = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  if (!days.length) return null;

  const first = timestamp(days[0].date);
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const position = (date: string) => Math.round((timestamp(date) - first) / dayMs) + offset;
  const columns = Math.floor(position(days[days.length - 1].date) / 7) + 1;
  const activeDate = days.some((day) => day.date === focusedDate) ? focusedDate
    : days.some((day) => day.date === selectedDate) ? selectedDate : days[days.length - 1].date;
  const preview = days.find((day) => day.date === hoveredDate)
    ?? days.find((day) => day.date === activeDate)!;
  const months = days.filter((day, index) => index === 0 || day.date.slice(0, 7) !== days[index - 1].date.slice(0, 7));

  function move(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    let target: string | undefined;
    if (event.key === "Home") target = days[0].date;
    else if (event.key === "End") target = days[days.length - 1].date;
    else if (delta !== undefined) target = new Date(timestamp(date) + delta * dayMs).toISOString().slice(0, 10);
    else return;
    event.preventDefault();
    refs.current.get(target)?.focus();
  }

  return <div className={styles.root} role="group" aria-label={label}>
    <p id={helpId} className="sr-only">方向键移动日期，Home 和 End 跳到首尾，Enter 或空格查看当天记录。</p>
    <div className={styles.scroll}>
      <div className={styles.calendar} style={{ "--heatmap-columns": columns } as CSSProperties}>
        <div className={styles.months} aria-hidden="true">
          {months.map((day, index) => {
            const column = Math.floor(position(day.date) / 7) + 1;
            const next = months[index + 1];
            const end = next ? Math.floor(position(next.date) / 7) + 1 : columns + 1;
            return end > column ? <span key={day.date} style={{ gridColumn: `${column} / ${end}` }}>{Number(day.date.slice(5, 7))}月</span> : null;
          })}
        </div>
        <div className={styles.weekdays} aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className={styles.days}>
          {days.map((day) => <button key={day.date} type="button" className={styles.cell}
            ref={(node) => { if (node) refs.current.set(day.date, node); else refs.current.delete(day.date); }}
            data-date={day.date} data-level={day.level} aria-label={day.label}
            aria-describedby={helpId} aria-pressed={day.date === selectedDate} tabIndex={day.date === activeDate ? 0 : -1}
            style={{ gridColumn: Math.floor(position(day.date) / 7) + 1, gridRow: position(day.date) % 7 + 1 }}
            onFocus={() => setFocusedDate(day.date)} onKeyDown={(event) => move(event, day.date)}
            onMouseEnter={() => setHoveredDate(day.date)} onMouseLeave={() => setHoveredDate(null)}
            onClick={() => { setFocusedDate(day.date); onSelect(day.date); }} />)}
        </div>
      </div>
    </div>
    <div className={styles.footer}>
      <p className={styles.preview} role="status">{preview.label}</p>
      <div className={styles.legend} aria-label="活动强度图例"><span>少</span>{legend.map((text, level) => <span key={level} className={styles.swatch} data-level={level} title={text}><span className="sr-only">{text}</span></span>)}<span>多</span></div>
    </div>
  </div>;
}
