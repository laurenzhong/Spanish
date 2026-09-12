"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import contentBundle from "@/content/bundles/alpha-core-v2.json";
import {
  createBrowserTrainingCheckpointStore,
  restoreTrainingCheckpoint,
  TRAINING_SUPPORTED_CONTENT_BUNDLE_VERSIONS,
} from "@/src/modules/training/checkpoints";
import { getLearningPrimaryAction, type DueRepetitionActionInput } from "@/src/modules/recommendation";

const focusContent = {
  start: { eyebrow: "开始交流", title: "问候后自然继续交流", reason: "从认识新朋友开始，练习接着分享共同点，让对话自然延续。" },
  needs: { eyebrow: "表达需要", title: "把需要说得清楚又自然", reason: "练习提出请求、确认信息和解决生活问题时最常用的表达。" },
  maintain: { eyebrow: "维持对话", title: "让对话继续往前走", reason: "练习回应、追问和表达兴趣，不让交流停在一句问候后。" },
} as const;

type LearnFocus = keyof typeof focusContent | "silent";

type LearnProgress = Readonly<{
  expressionIndex: number;
  totalExpressions: number;
  status: string;
}>;

type LearnTimelineNode = Readonly<{
  key: string;
  label: string;
  detail: string;
  status: "completed" | "current" | "locked";
}>;

function readFocus(value: string | string[] | undefined): LearnFocus | null {
  const focus = Array.isArray(value) ? value[0] : value;
  return focus === "start" || focus === "needs" || focus === "maintain" || focus === "silent" ? focus : null;
}

function readGoal(value: string | string[] | undefined): string | null {
  const goal = Array.isArray(value) ? value[0] : value;
  if (!goal) return null;
  return contentBundle.goals.some((item) => item.stableKey === goal) ? goal : null;
}

const defaultExpressions = contentBundle.expressions.slice(0, 4);

function expressionsForGoal(goalKey: string | null) {
  if (!goalKey) return defaultExpressions;
  const matching = contentBundle.expressions.filter((expression) => expression.goalKey === goalKey);
  return matching.length > 0 ? matching : defaultExpressions;
}

function focusForGoal(goalKey: string | null): Exclude<LearnFocus, "silent"> {
  if (goalKey?.includes("need")) return "needs";
  if (goalKey?.includes("relationship")) return "maintain";
  return "start";
}

export function LearnPageContent({ userId = "local-user", dueRepetition = null }: Readonly<{ userId?: string; dueRepetition?: DueRepetitionActionInput | null }>) {
  const [focus, setFocus] = useState<LearnFocus | null>(null);
  const [goalKey, setGoalKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<LearnProgress | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedGoal = readGoal(params.get("goal") ?? undefined);
      const requestedFocus = readFocus(params.get("focus") ?? undefined);
      setGoalKey((current) => current ?? requestedGoal);
      setFocus((current) => current ?? requestedFocus);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const store = createBrowserTrainingCheckpointStore(userId);
    let active = true;
    void restoreTrainingCheckpoint(store, {
      contentBundleKey: "alpha.core",
      contentBundleVersions: TRAINING_SUPPORTED_CONTENT_BUNDLE_VERSIONS,
    }).then((checkpoint) => {
      if (!active || !checkpoint) return;
      const requestedGoal = readGoal(
        new URLSearchParams(window.location.search).get("goal") ?? undefined,
      );
      const activeGoalKey = goalKey ?? requestedGoal;
      if (activeGoalKey && checkpoint.goalKey !== activeGoalKey) return;
      const scopedExpressions = expressionsForGoal(activeGoalKey);
      const expressionIndex = Math.max(
        0,
        scopedExpressions.findIndex((expression) =>
          checkpoint.contentKey?.startsWith(expression.stableKey),
        ),
      );
      setProgress({
        expressionIndex,
        status: checkpoint.status,
        totalExpressions: scopedExpressions.length,
      });
      setFocus((current) => current ?? (activeGoalKey ? null : focusForGoal(checkpoint.goalKey)));
    });
    return () => {
      active = false;
    };
  }, [goalKey, userId]);

  const selectedGoal = goalKey ? contentBundle.goals.find((goal) => goal.stableKey === goalKey) ?? null : null;
  const selectedContent = selectedGoal
    ? { eyebrow: "目标练习", title: selectedGoal.title["zh-CN"], reason: selectedGoal.description["zh-CN"] }
    : focus && focus !== "silent" ? focusContent[focus] : focusContent.start;
  const isSilent = focus === "silent";
  const hasProgress = progress !== null;
  const baseTitle = hasProgress || selectedGoal
    ? selectedContent.title
    : isSilent
      ? "先用安静模式理解真实表达"
      : focus && focus !== "start"
        ? selectedContent.title
        : "从一句真实表达开始";
  const practiceHref = goalKey ? `/learn/practice?goal=${encodeURIComponent(goalKey)}` : "/learn/practice";
  const action = getLearningPrimaryAction({
    hasStableBreakpoint: hasProgress,
    dueRepetition,
    practiceHref,
    practiceTitle: baseTitle,
    practiceReason: hasProgress ? `${selectedContent.reason} 从第 ${(progress?.expressionIndex ?? 0) + 1} 句接着说。` : selectedContent.reason,
  });
  const isDueRepetition = action.kind === "due-repetition";
  const title = action.title;
  const feedbackVisible = progress?.status === "showing-feedback" || progress?.status === "completed";
  const timeline: readonly LearnTimelineNode[] = [
    { key: "listen", label: "听懂情境", detail: "先听一遍，抓住语气和关键信息。", status: hasProgress ? "completed" : "current" },
    { key: "express", label: "自己表达", detail: "用你自己的话回应，不需要先选模式或时长。", status: hasProgress ? (feedbackVisible ? "completed" : "current") : "locked" },
    { key: "vary", label: "换一种说法", detail: "完成当前步骤后解锁，保留真实交际意图。", status: feedbackVisible ? "current" : "locked" },
  ];

  return (
    <div className="page-stack learn-page">
      <header className="page-header learn-page__masthead">
        <div><p className="eyebrow">今天继续</p><p className="welcome-copy">Hola，准备好继续了吗？</p></div>
        <Link className="icon-button" href="/me" aria-label="打开我的进步"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></svg></Link>
      </header>

      <section className="focus-card" aria-labelledby="next-goal-title" data-focus={focus ?? "default"} data-has-progress={hasProgress} data-testid="learn-focus-card">
        <div className="focus-card__halo" aria-hidden="true" />
        <div className="focus-card__main">
          <p className="eyebrow eyebrow--accent">{isSilent ? "安静学习" : hasProgress ? "继续上次练习" : isDueRepetition ? "到期复现" : selectedContent.eyebrow}</p>
          <h1 id="next-goal-title">{title}</h1>
          <p className="focus-card__reason">{isSilent ? "阅读、听力和打字内容正在整理中；完成后仍需通过一次口语复核，才会进入能力画像。" : action.reason}</p>
          {!isSilent && !isDueRepetition ? <div className="learn-timeline" aria-label="学习任务时间线" data-testid="learn-timeline">
            <div className="learn-timeline__heading"><span>当前沟通目标</span><span>{hasProgress ? `第 ${(progress?.expressionIndex ?? 0) + 1} / ${progress?.totalExpressions ?? 4} 句` : "从第 1 句开始"}</span></div>
            <ol>
              {timeline.map((node) => <li className={`learn-timeline__node learn-timeline__node--${node.status}`} key={node.key}>
                <span className="learn-timeline__marker" aria-hidden="true">{node.status === "completed" ? "✓" : node.status === "current" ? "•" : ""}</span>
                <div><strong>{node.label}</strong><span>{node.status === "completed" ? "已完成" : node.status === "current" ? "当前步骤" : "完成当前步骤后解锁"}</span><p>{node.detail}</p></div>
              </li>)}
            </ol>
          </div> : null}
        {isSilent ? <p className="learn-focus-note" role="status">当前方向已记录，暂时没有可开始的静默内容包。</p> : <Link className="primary-action" data-testid="learn-primary-action" href={action.href}><span>{action.label}</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg></Link>}
        </div>
        {hasProgress ? <aside className="focus-card__side learn-detail-rail" aria-label="学习详情" data-testid="learn-detail-rail"><div className="learn-detail-rail__section"><span className="learn-detail-rail__label">这组表达</span><strong>{(progress?.expressionIndex ?? 0) + 1} / {progress?.totalExpressions}</strong><div className="progress-track" role="progressbar" aria-label="这组表达进度" aria-valuemin={0} aria-valuemax={progress?.totalExpressions} aria-valuenow={(progress?.expressionIndex ?? 0) + 1}><span style={{ width: `${(((progress?.expressionIndex ?? 0) + 1) / (progress?.totalExpressions || 1)) * 100}%` }} /></div><p>每句完成后都会保存，下一次打开就从这里继续。</p></div><div className="learn-detail-rail__section"><span className="learn-detail-rail__label">本次规则</span><p>完整表达前不纠错；技术失败不会产生负面能力记录。</p></div><div className="learn-detail-rail__section learn-detail-rail__section--privacy"><span aria-hidden="true">⌁</span><p><strong>录音隐私</strong>普通录音评估完成后删除。</p></div></aside> : null}
      </section>

      <section className="learn-support" aria-label="继续探索">
        <article className="learn-support__card learn-support__card--empty"><span className="eyebrow">阅读库</span><strong>读一篇文章</strong><small>文章库正在准备中，稍后会在这里出现。</small></article>
        <Link className="learn-support__card" href="/chat/lucia"><span className="eyebrow">关系练习</span><strong>和 Lucía 聊几句</strong><small>从最近话题自然继续</small></Link>
        <Link className="learn-support__card" href="/explore"><span className="eyebrow">沟通目标</span><strong>探索新的表达</strong><small>找到下一种说法</small></Link>
      </section>
      <Link className="learn-history-link" href="/explore/history">查看练习历史 →</Link>

      {!hasProgress ? <section className="learn-empty-progress" aria-label="学习进度为空"><strong>{isDueRepetition ? "完成这次复现后，会形成新的独立证据。" : "完成第一次练习后，这里会显示你的真实进步。"}</strong><span>{isDueRepetition ? "原始练习和历史证据会继续保留。" : "现在没有可展示的口语证据或稳定断点。"}</span></section> : null}

      <aside className="gentle-note" aria-label="学习建议"><span className="gentle-note__mark" aria-hidden="true">i</span><p>每完成一句都会保存进度，随时停下也不会失去本次练习。</p></aside>
    </div>
  );
}
