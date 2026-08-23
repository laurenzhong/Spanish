"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const focusContent = {
  start: { eyebrow: "开始交流", title: "问候后自然继续交流", reason: "从认识新朋友开始，练习接着分享共同点，让对话自然延续。" },
  needs: { eyebrow: "表达需要", title: "把需要说得清楚又自然", reason: "练习提出请求、确认信息和解决生活问题时最常用的表达。" },
  maintain: { eyebrow: "维持对话", title: "让对话继续往前走", reason: "练习回应、追问和表达兴趣，不让交流停在一句问候后。" },
} as const;

type LearnFocus = keyof typeof focusContent | "silent";

function readFocus(value: string | string[] | undefined): LearnFocus | null {
  const focus = Array.isArray(value) ? value[0] : value;
  return focus === "start" || focus === "needs" || focus === "maintain" || focus === "silent" ? focus : null;
}

export function LearnPageContent() {
  const [focus, setFocus] = useState<LearnFocus | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFocus(readFocus(new URLSearchParams(window.location.search).get("focus") ?? undefined));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selectedContent = focus && focus !== "silent" ? focusContent[focus] : focusContent.start;
  const isSilent = focus === "silent";

  return (
    <div className="page-stack learn-page">
      <header className="page-header learn-page__masthead">
        <div><p className="eyebrow">今天继续</p><p className="welcome-copy">Hola，准备好继续了吗？</p></div>
        <Link className="icon-button" href="/me" aria-label="打开我的进步"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></svg></Link>
      </header>

      <section className="focus-card" aria-labelledby="next-goal-title" data-focus={focus ?? "default"}>
        <div className="focus-card__halo" aria-hidden="true" />
        <div className="focus-card__main">
          <p className="eyebrow eyebrow--accent">{isSilent ? "安静学习" : selectedContent.eyebrow}</p>
          <h1 id="next-goal-title">{isSilent ? "先用安静模式理解真实表达" : selectedContent.title}</h1>
          <p className="focus-card__reason">{isSilent ? "阅读、听力和打字内容正在整理中；完成后仍需通过一次口语复核，才会进入能力画像。" : selectedContent.reason}</p>
          {isSilent ? <p className="learn-focus-note" role="status">当前方向已记录，暂时没有可开始的静默内容包。</p> : <Link className="primary-action" href="/learn/practice"><span>继续学习</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg></Link>}
        </div>
        <div className="focus-card__side" aria-label="当前学习进度">
          <div className="focus-card__side-head"><span>这组表达</span><strong>1 / 4</strong></div>
          <div className="progress-track" role="progressbar" aria-label="这组表达进度" aria-valuemin={0} aria-valuemax={4} aria-valuenow={1}><span /></div>
          <p>每句完成后都会保存，下一次打开就从这里继续。</p>
        </div>
      </section>

      <section className="evidence-card" aria-labelledby="recent-ability-title">
        <div className="evidence-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg></div>
        <div><p className="eyebrow eyebrow--accent">最近获得的能力</p><h2 id="recent-ability-title">可以独立完成简单自我介绍</h2><p>平均开口反应时间从 5.4 秒降到 3.8 秒。</p></div>
      </section>

      <aside className="gentle-note" aria-label="学习建议"><span className="gentle-note__mark" aria-hidden="true">i</span><p>每完成一句都会保存进度，随时停下也不会失去本次练习。</p></aside>
    </div>
  );
}
