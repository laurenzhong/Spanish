"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  completeContentPackActivity,
  createContentPackProgress,
  isContentPackComplete,
  parseContentPackProgress,
  type ContentPackActivity,
  type ContentPackProgress,
  type ContentPackProjection,
} from "../domain";
import { createBrowserTextToSpeech } from "@/src/modules/providers/tts";

const progressKeyPrefix = "content-pack-progress:v1:";

type ContentPackExperienceProps = Readonly<{
  pack: ContentPackProjection;
}>;

function storageKey(pack: ContentPackProjection): string {
  return `${progressKeyPrefix}${pack.id}`;
}

function activityLabel(activity: ContentPackActivity): string {
  switch (activity.activityType) {
    case "listening":
      return "先听全文";
    case "reading":
      return "看懂一段";
    case "typing":
      return "写下回复";
    case "speaking":
      return "准备开口";
    case "transfer":
      return "换个情境";
    case "shadowing":
      return "跟读一遍";
  }
}

function localized(value: Readonly<Record<string, string>>, locale: string): string {
  return value[locale] ?? value["zh-CN"] ?? Object.values(value)[0] ?? "";
}

export function ContentPackExperience({ pack }: ContentPackExperienceProps) {
  const [progress, setProgress] = useState<ContentPackProgress>(() => createContentPackProgress(pack));
  const [expandedSegments, setExpandedSegments] = useState<ReadonlySet<number>>(new Set());
  const tts = useMemo(() => createBrowserTextToSpeech(), []);
  const [speakingActivityId, setSpeakingActivityId] = useState<string | null>(null);
  const [speechFallback, setSpeechFallback] = useState(false);
  const didHydrate = useRef(false);

  useEffect(() => () => tts.stop(), [tts]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey(pack));
      if (saved) {
        const parsed = parseContentPackProgress(pack, JSON.parse(saved));
        // Restore after the first client render so the server markup stays stable.
        queueMicrotask(() => setProgress(parsed));
      }
    } catch {
      // Corrupt or unavailable storage falls back to the in-memory progress.
    }
    didHydrate.current = true;
  }, [pack]);

  useEffect(() => {
    if (!didHydrate.current) return;
    try {
      window.localStorage.setItem(storageKey(pack), JSON.stringify(progress));
    } catch {
      // Progress remains usable for this session when storage is unavailable.
    }
  }, [pack, progress]);

  const fullText = useMemo(() => pack.segments.map((segment) => segment.text).join(" "), [pack.segments]);
  const completedCount = progress.completedActivityIds.length;

  const complete = useCallback(
    (activityId: string) => setProgress((current) => completeContentPackActivity(current, pack, activityId)),
    [pack],
  );

  const speak = useCallback(
    async (activity: ContentPackActivity, text: string) => {
      if (!tts?.isSupported) {
        setSpeechFallback(true);
        complete(activity.id);
        return;
      }
      setSpeakingActivityId(activity.id);
      setSpeechFallback(false);
      try {
        await tts.speak(text, { languageTag: "es-ES", rate: 0.88 });
        complete(activity.id);
      } catch {
        setSpeechFallback(true);
        complete(activity.id);
      } finally {
        setSpeakingActivityId(null);
      }
    },
    [complete, tts],
  );

  const toggleSegment = useCallback(
    (segmentPosition: number, activity: ContentPackActivity) => {
      setExpandedSegments((current) => {
        const next = new Set(current);
        if (next.has(segmentPosition)) next.delete(segmentPosition);
        else {
          next.add(segmentPosition);
          complete(activity.id);
        }
        return next;
      });
    },
    [complete],
  );

  return (
    <div className="page-stack content-pack-page">
      <header className="page-header page-header--simple content-pack-page__header">
        <div>
          <p className="eyebrow eyebrow--accent">沉浸内容包 · {pack.cefr}</p>
          <h1>{localized(pack.title, "zh-CN")}</h1>
          <p>{localized(pack.summary, "zh-CN")}</p>
        </div>
        <Link className="text-link" href="/explore">
          返回探索
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
        </Link>
      </header>

      <section className="content-pack-progress" aria-label="内容包进度">
        <div>
          <span className="eyebrow">当前进度</span>
          <strong>{completedCount}/{pack.activities.length} 个步骤</strong>
        </div>
        <div className="content-pack-progress__track" aria-hidden="true">
          <span style={{ width: `${Math.round((completedCount / pack.activities.length) * 100)}%` }} />
        </div>
        {isContentPackComplete(progress, pack) ? <p>这一包完成了。你可以去练习，把表达说出来。</p> : null}
      </section>

      {speechFallback ? (
        <aside className="content-pack-notice" role="status">
          <strong>浏览器暂时无法朗读。</strong>
          <span>你仍然可以展开西语文本，完成阅读和口语复核。</span>
        </aside>
      ) : null}

      <section className="content-pack-activities" aria-label="学习步骤">
        {pack.activities.map((activity) => {
          const completed = progress.completedActivityIds.includes(activity.id);
          const instruction = localized(activity.instructions, "zh-CN");

          if (activity.activityType === "listening") {
            return (
              <article className={`content-pack-step${completed ? " is-complete" : ""}`} key={activity.id}>
                <div className="content-pack-step__heading">
                  <span className="content-pack-step__number">{activity.position + 1}</span>
                  <div><span className="eyebrow">{activityLabel(activity)}</span><h2>先听懂整体发生了什么</h2></div>
                  {completed ? <span className="content-pack-step__done">已完成</span> : null}
                </div>
                <p>{instruction}</p>
                <button className="primary-link content-pack-speak" type="button" onClick={() => void speak(activity, fullText)} disabled={speakingActivityId === activity.id}>
                  {speakingActivityId === activity.id ? "正在朗读" : "播放全文"}
                </button>
              </article>
            );
          }

          if (activity.activityType === "reading") {
            const segment = pack.segments.find((candidate) => candidate.position === activity.segmentPosition);
            if (!segment) return null;
            const expanded = expandedSegments.has(segment.position);
            return (
              <article className={`content-pack-step${completed ? " is-complete" : ""}`} key={activity.id}>
                <div className="content-pack-step__heading">
                  <span className="content-pack-step__number">{activity.position + 1}</span>
                  <div><span className="eyebrow">{activityLabel(activity)}</span><h2>回到第 {segment.position + 1} 段</h2></div>
                  {completed ? <span className="content-pack-step__done">已完成</span> : null}
                </div>
                <p>{instruction}</p>
                <button className="secondary-action content-pack-expand" type="button" aria-expanded={expanded} onClick={() => toggleSegment(segment.position, activity)}>
                  {expanded ? "收起文本" : "展开西语和中文"}
                </button>
                {expanded ? (
                  <div className="content-pack-segment" data-testid={`segment-${segment.position}`}>
                    <p lang="es">{segment.text}</p>
                    <p>{localized(segment.translations, "zh-CN")}</p>
                    <div className="content-pack-chunks" aria-label="意群提示">
                      {segment.chunks.map((chunk) => (
                        <span className={chunk.stressed ? "is-stressed" : ""} key={`${segment.id}:${chunk.text}`}>
                          {chunk.text}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          }

          if (activity.activityType === "typing" || activity.activityType === "transfer") {
            const minimum = typeof activity.configuration.minimumCharacters === "number" ? activity.configuration.minimumCharacters : 1;
            const canComplete = progress.draftReply.trim().length >= minimum;
            return (
              <article className={`content-pack-step${completed ? " is-complete" : ""}`} key={activity.id}>
                <div className="content-pack-step__heading">
                  <span className="content-pack-step__number">{activity.position + 1}</span>
                  <div><span className="eyebrow">{activityLabel(activity)}</span><h2>{activity.activityType === "typing" ? "写一句你会说的话" : "换成你的真实情境"}</h2></div>
                  {completed ? <span className="content-pack-step__done">已完成</span> : null}
                </div>
                <p>{instruction}</p>
                <textarea aria-label={activity.activityType === "typing" ? "你的回复" : "你的迁移回复"} value={progress.draftReply} onChange={(event) => setProgress((current) => ({ ...current, draftReply: event.target.value }))} placeholder="用自己的话写一句，不需要匹配唯一答案。" />
                <button className="secondary-action" type="button" disabled={!canComplete} onClick={() => complete(activity.id)}>
                  {canComplete ? "完成这一步" : `再写 ${minimum - progress.draftReply.trim().length} 个字`}
                </button>
              </article>
            );
          }

          if (activity.activityType === "speaking") {
            return (
              <article className={`content-pack-step${completed ? " is-complete" : ""}`} key={activity.id}>
                <div className="content-pack-step__heading">
                  <span className="content-pack-step__number">{activity.position + 1}</span>
                  <div><span className="eyebrow">{activityLabel(activity)}</span><h2>把刚才的意思说出来</h2></div>
                  {completed ? <span className="content-pack-step__done">已完成</span> : null}
                </div>
                <p>{instruction}</p>
                <Link className="primary-link" href="/learn/practice" onClick={() => complete(activity.id)}>进入口语复核</Link>
                <small className="content-pack-step__note">这里会进入现有口语训练流程，内容包本身不会直接写入能力证据。</small>
              </article>
            );
          }

          return null;
        })}
      </section>
    </div>
  );
}
