"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildLearningHeatmap,
  learningHeatmapSchema,
  type HeatmapDay,
  type LearningHeatmap,
} from "@/src/modules/profile/domain";
import { SurfaceState } from "@/src/shared/ui/surface-state";

function emptyHeatmap(): LearningHeatmap {
  return buildLearningHeatmap([]);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

function formatDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

function intensity(durationMinutes: number): number {
  if (durationMinutes === 0) return 0;
  if (durationMinutes <= 10) return 1;
  if (durationMinutes <= 25) return 2;
  if (durationMinutes <= 45) return 3;
  return 4;
}

async function fetchHeatmap(): Promise<LearningHeatmap> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6_000);
  let response: Response;
  try {
    response = await fetch("/api/v1/profile/heatmap", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("heatmap-request-failed");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("heatmap-response-invalid");
  }
  return learningHeatmapSchema.parse(payload.data);
}

function dayLabel(day: HeatmapDay): string {
  return `${formatDate(day.date)}，${day.durationMinutes > 0 ? `有效学习 ${formatMinutes(day.durationMinutes)}` : "没有有效学习记录"}`;
}

function DayDetail({ day }: Readonly<{ day: HeatmapDay }>) {
  return (
    <div className="learning-heatmap__detail" data-testid="heatmap-day-detail">
      <div>
        <p className="eyebrow eyebrow--accent">当天记录</p>
        <h3>{formatDate(day.date)}</h3>
      </div>
      <div className="learning-heatmap__detail-metrics">
        <div><span>有效学习</span><strong>{formatMinutes(day.durationMinutes)}</strong></div>
        <div><span>独立表达</span><strong>{day.independentExpressionCount || "—"}</strong></div>
        <div><span>训练场景</span><strong>{day.sessionCount || "—"}</strong></div>
      </div>
      <div className="learning-heatmap__detail-list">
        <span>场景</span>
        <p>{day.sceneLabels.length > 0 ? day.sceneLabels.join("、") : "暂无场景记录"}</p>
        <span>获得能力</span>
        <p>{day.skillLabels.length > 0 ? day.skillLabels.join("、") : "完成可追溯表达后会显示"}</p>
      </div>
    </div>
  );
}

type LearningHeatmapProps = Readonly<{
  onError?: () => void;
  retryToken?: number;
  showError?: boolean;
}>;

export function LearningHeatmap({ onError, retryToken = 0, showError = true }: LearningHeatmapProps = {}) {
  const [heatmap, setHeatmap] = useState<LearningHeatmap>(emptyHeatmap);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function loadHeatmap() {
    setLoading(true);
    setError(false);
    try {
      setHeatmap(await fetchHeatmap());
    } catch {
      setError(true);
      onError?.();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchHeatmap()
      .then((nextHeatmap) => {
        if (!active) return;
        setHeatmap(nextHeatmap);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        onError?.();
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onError, retryToken]);

  const selectedDay = useMemo(() => {
    const date = selectedDate ?? heatmap.range.to;
    return heatmap.days.find((day) => day.date === date) ?? heatmap.days.at(-1);
  }, [heatmap.days, heatmap.range.to, selectedDate]);

  const visibleDays = useMemo(() => heatmap.days.slice(-84), [heatmap.days]);

  if (loading) {
    return (
      <section className="learning-heatmap profile-dashboard__section" data-testid="learning-heatmap-loading">
        <SurfaceState state="loading" description="正在读取学习活动。" />
      </section>
    );
  }

  return (
    <section className="learning-heatmap profile-dashboard__section" data-testid="learning-heatmap" aria-labelledby="learning-heatmap-title">
      {error && showError ? (
        <div className="profile-data-warning" role="alert">
          <span>暂时无法读取学习活动，当前只显示空状态。</span>
          <button onClick={() => void loadHeatmap()} type="button">重试</button>
        </div>
      ) : null}
      <div className="section-heading learning-heatmap__heading">
        <div>
          <p className="eyebrow eyebrow--accent">有效学习</p>
          <h2 id="learning-heatmap-title">最近 12 周活动</h2>
          <p>只记录前台且有近期活动的有效学习时间，不参与能力评分，也不惩罚中断。</p>
        </div>
        <div className="learning-heatmap__totals" aria-label="学习活动摘要">
          <strong>{heatmap.totals.activeDays}</strong>
          <span>有记录的天数 · {formatMinutes(heatmap.totals.totalMinutes)}</span>
        </div>
      </div>

      {heatmap.totals.activeDays === 0 ? (
        error ? (
          // A failed read used to fall through to the empty state above, so a
          // network or 503 looked exactly like "you have never learned". Say
          // which one it is, even when the section renders its own notice.
          <div className="learning-heatmap__empty" data-testid="learning-heatmap-unavailable">
            <strong>暂时无法读取学习活动</strong>
            <span>这次没有取到你的活动记录，因此这里无法显示；这不代表你没有学习。</span>
            <button onClick={() => void loadHeatmap()} type="button">重试</button>
          </div>
        ) : (
          <div className="learning-heatmap__empty" data-testid="learning-heatmap-empty">
            <strong>还没有有效学习记录</strong>
            <span>这里只统计被记录下来的有效学习：在前台完成、且有实际表达或活动的练习。学习时长不参与能力评分，也不惩罚中断。</span>
          </div>
        )
      ) : <>
      <div className="learning-heatmap__scroll" role="group" aria-label="最近 12 周学习活动">
        <div className="learning-heatmap__weekdays" aria-hidden="true">
          <span>一</span><span>三</span><span>五</span>
        </div>
        <div className="learning-heatmap__grid">
          {visibleDays.map((day) => {
            const level = intensity(day.durationMinutes);
            return (
              <button
                aria-label={dayLabel(day)}
                aria-pressed={selectedDay?.date === day.date}
                className={`learning-heatmap__cell learning-heatmap__cell--level-${level}`}
                data-date={day.date}
                data-level={level}
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                title={dayLabel(day)}
                type="button"
              />
            );
          })}
        </div>
      </div>

      <div className="learning-heatmap__legend" aria-label="有效学习时长图例">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i aria-label={level === 0 ? "没有记录" : `${level} 级学习时长`} className={`learning-heatmap__cell learning-heatmap__cell--level-${level}`} key={level} />
        ))}
        <span>多</span>
      </div>

      {selectedDay ? <DayDetail day={selectedDay} /> : null}
      </>}
    </section>
  );
}
