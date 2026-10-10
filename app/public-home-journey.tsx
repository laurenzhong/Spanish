"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";

const modes = {
  hear: { eyebrow: "先理解情境", spanish: "¿Te apetece seguir hablando después?", translation: "你愿意之后继续聊聊吗？", detail: "字幕自动跟随当前句，先听见对方为什么这样说。", word: "seguir" },
  answer: { eyebrow: "用自己的话回应", spanish: "Sí, me gustaría. Tengo un poco de tiempo.", translation: "好啊，我愿意。我有一点时间。", detail: "说完完整意思，再看哪些表达可以带到下一次对话。", word: "gustaría" },
  carry: { eyebrow: "带着新变式继续", spanish: "Podemos seguir mañana, si te viene bien.", translation: "如果你方便，我们明天可以继续。", detail: "换一个关系、地点或条件，让表达真正变成自己的能力。", word: "mañana" },
} as const;

type Mode = keyof typeof modes;
const modeKeys = Object.keys(modes) as Mode[];
const journey = [["01", "听见情境", "先听懂对方为什么这样说。", "输入"], ["02", "用自己的话回应", "把完整意思说出来，不抢答、不打断。", "输出"], ["03", "带着变式继续", "换一个关系和条件，再说一次。", "迁移"]] as const;
const waveform = [16, 30, 23, 48, 34, 66, 43, 25, 56, 74, 42, 28, 52, 31, 68, 38, 24, 46, 60, 32, 20, 44, 28, 54, 35, 22, 42, 30, 58, 36];

export default function PublicHomeJourney() {
  const [mode, setMode] = useState<Mode>("hear");
  const current = modes[mode];
  const modeIndex = modeKeys.indexOf(mode);

  return <>
    <section className="landing-journey" id="how-it-works" aria-labelledby="how-it-works-title">
      <div className="landing-section-head"><span className="landing-section-number">01</span><h2 id="how-it-works-title">每一次练习，都在为下一次真实交流做准备。</h2><p>不是做完一题就结束。听见、回应、迁移，才是把知识变成反应的完整路径。</p></div>
      <div className="landing-journey__rail">{journey.map(([number, title, detail, verb], index) => <button className={`landing-journey__step${index === modeIndex ? " is-active" : ""}`} key={number} type="button" aria-pressed={index === modeIndex} onClick={() => setMode(modeKeys[index])} onFocus={() => setMode(modeKeys[index])} onMouseEnter={() => setMode(modeKeys[index])}><div className="landing-journey__step-top"><span>{number}</span><i aria-hidden="true" /><em>{verb}</em></div><h3>{title}</h3><p>{detail}</p><div className="landing-journey__meter" aria-hidden="true"><span style={{ "--meter": `${(index + 1) * 33.333}%` } as CSSProperties} /></div></button>)}</div>
    </section>

    <section className="landing-proof" id="product-proof" aria-labelledby="product-proof-title">
      <div className="landing-proof__header"><span className="landing-section-number">02</span><h2 id="product-proof-title">不是题库，是一张可以回来的生活地图。</h2><p>从一段视频、一句问候或一个新的沟通目标开始。产品会把你带回真实可完成的下一步。</p></div>
      <div className="landing-proof__stage"><div className="landing-proof__screen"><div className="landing-proof__screen-bar"><span>媒体学习器</span><span>字幕自动跟随 · 词语可回看</span></div><div className="landing-proof__screen-content"><div className="landing-proof__video"><span>una conversación</span><i aria-hidden="true" /></div><div className="landing-proof__subtitles"><small>当前句</small><strong>{current.spanish}</strong><span>{current.translation}</span><div><b>{current.word}</b><b>hablando</b><b>después</b></div></div></div><div className="landing-proof__signal"><div><span>LIVE TRANSCRIPT</span><small>3 / 3 signals</small></div><div className="landing-proof__signal-bars" aria-hidden="true">{waveform.slice(0, 22).map((height, index) => <i key={index} style={{ "--bar-height": `${height}%`, "--bar-delay": `${index * 22}ms` } as CSSProperties} />)}</div></div></div><div className="landing-proof__notes"><span>产品在做什么</span><strong>{current.eyebrow}</strong><p>{current.detail}</p><Link href="/login?next=%2Fexplore">看看沟通目标 <span aria-hidden="true">↗</span></Link></div></div>
    </section>
  </>;
}
