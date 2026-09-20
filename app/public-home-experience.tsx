"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";

const modes = {
  hear: {
    label: "听见",
    eyebrow: "先理解情境",
    title: "问候后，自然地继续交流",
    spanish: "¿Te apetece seguir hablando después?",
    translation: "你愿意之后继续聊聊吗？",
    detail: "字幕自动跟随当前句，先听见对方为什么这样说。",
    word: "seguir",
    meaning: "继续；接着",
  },
  answer: {
    label: "回应",
    eyebrow: "用自己的话回应",
    title: "完整表达，不背唯一答案",
    spanish: "Sí, me gustaría. Tengo un poco de tiempo.",
    translation: "好啊，我愿意。我有一点时间。",
    detail: "说完完整意思，再看哪些表达可以带到下一次对话。",
    word: "gustaría",
    meaning: "想要；愿意",
  },
  carry: {
    label: "迁移",
    eyebrow: "带着新变式继续",
    title: "把刚刚说过的意思带走",
    spanish: "Podemos seguir mañana, si te viene bien.",
    translation: "如果你方便，我们明天可以继续。",
    detail: "换一个关系、地点或条件，让表达真正变成自己的能力。",
    word: "mañana",
    meaning: "明天",
  },
} as const;

type Mode = keyof typeof modes;

const modeKeys = Object.keys(modes) as Mode[];

const journey = [
  ["01", "听见情境", "先听懂对方为什么这样说。", "输入"],
  ["02", "用自己的话回应", "把完整意思说出来，不抢答、不打断。", "输出"],
  ["03", "带着变式继续", "换一个关系和条件，再说一次。", "迁移"],
] as const;

const waveform = [16, 30, 23, 48, 34, 66, 43, 25, 56, 74, 42, 28, 52, 31, 68, 38, 24, 46, 60, 32, 20, 44, 28, 54, 35, 22, 42, 30, 58, 36];

export default function PublicHomeExperience() {
  const [mode, setMode] = useState<Mode>("hear");
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(42);
  const current = modes[mode];

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setProgress((value) => value >= 96 ? 18 : value + 1);
    }, 140);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const modeIndex = modeKeys.indexOf(mode);

  return (
    <main className="landing-page">
      <section className="landing-hero" aria-labelledby="public-home-title">
        <div className="landing-hero__grid" aria-hidden="true" />
        <header className="landing-nav">
          <Link className="landing-wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link>
          <nav aria-label="公开页面导航">
            <a href="#how-it-works">产品方式</a>
            <a href="#product-proof">产品体验</a>
            <Link href="/login">登录</Link>
            <Link className="landing-nav__cta" href="/login">进入学习</Link>
          </nav>
        </header>

        <div className="landing-hero__copy">
          <h1 id="public-home-title">把认识的西语，变成真正说得出口的话。</h1>
          <p>真实情境、完整表达和新的变式，组成一次可以带走的练习。</p>
          <div className="landing-hero__actions">
            <Link className="landing-button landing-button--accent" href="/login">开始第一次练习 <span aria-hidden="true">↗</span></Link>
            <a className="landing-text-button" href="#how-it-works">向下探索 <span aria-hidden="true">↓</span></a>
          </div>
        </div>

        <div className={`landing-console landing-console--${mode}`} aria-label="Sueño 产品演示">
          <div className="landing-console__bar">
            <span className="landing-console__product">Sueño <i>学习 / 资料库</i></span>
            <span className="landing-console__live"><b /> 本地演示</span>
            <span className="landing-console__dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div className="landing-console__body">
            <div className="landing-console__main">
              <div className="landing-console__meta"><span>{current.eyebrow}</span><small>A2 · 语境练习</small></div>
              <div className="landing-console__headline"><h2 key={mode}>{current.title}</h2><span>动态练习 / 0{modeIndex + 1}</span></div>
              <div className="landing-console__transcript">
                <p key={`${mode}-es`} lang="es">{current.spanish}</p>
                <p key={`${mode}-zh`} lang="zh-CN">{current.translation}</p>
                <div className="landing-console__word-row" key={`${mode}-word`}><span>{current.word}</span><small>{current.meaning}</small></div>
              </div>
              <div className="landing-console__controls">
                <div className="landing-console__modes" role="tablist" aria-label="练习阶段">
                  {(Object.entries(modes) as [Mode, (typeof modes)[Mode]][]).map(([key, value]) => (
                    <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}>{value.label}</button>
                  ))}
                </div>
                <button className={`landing-console__play${isPlaying ? " is-playing" : ""}`} type="button" aria-label={isPlaying ? "暂停演示" : "播放演示"} onClick={() => setIsPlaying((value) => !value)}>
                  <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
                </button>
              </div>
              <div className="landing-console__timeline" aria-label={`演示进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="landing-console__aside">
              <div className="landing-console__scene" aria-hidden="true">
                <span>una conversación</span>
                <div className="landing-console__scene-ring"><i>▶</i></div>
                <small>街角的下午 · 06:24</small>
              </div>
              <div className="landing-console__aside-copy"><span>正在学习</span><strong>{current.word}</strong><small>{current.detail}</small></div>
              <div className="landing-console__wave" aria-hidden="true">
                {waveform.map((height, index) => <i key={index} style={{ "--bar-height": `${height}%`, "--bar-delay": `${index * 24}ms` } as CSSProperties} />)}
              </div>
            </div>
          </div>
        </div>
        <div className="landing-hero__footline"><span>真实语境 · 完整表达 · 可以迁移的下一句话</span><span>SCROLL TO SPEAK ↓</span></div>
      </section>

      <section className="landing-journey" id="how-it-works" aria-labelledby="how-it-works-title">
        <div className="landing-section-head">
          <span className="landing-section-number">01</span>
          <h2 id="how-it-works-title">每一次练习，都在为下一次真实交流做准备。</h2>
          <p>不是做完一题就结束。听见、回应、迁移，才是把知识变成反应的完整路径。</p>
        </div>
        <div className="landing-journey__rail">
          {journey.map(([number, title, detail, verb], index) => (
            <article className={`landing-journey__step${index === modeIndex ? " is-active" : ""}`} key={number} onMouseEnter={() => setMode(modeKeys[index])}>
              <div className="landing-journey__step-top"><span>{number}</span><i aria-hidden="true" /><em>{verb}</em></div>
              <h3>{title}</h3>
              <p>{detail}</p>
              <div className="landing-journey__meter" aria-hidden="true"><span style={{ "--meter": `${(index + 1) * 33.333}%` } as CSSProperties} /></div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-proof" id="product-proof" aria-labelledby="product-proof-title">
        <div className="landing-proof__header">
          <span className="landing-section-number">02</span>
          <h2 id="product-proof-title">不是题库，是一张可以回来的生活地图。</h2>
          <p>从一段视频、一句问候或一个新的沟通目标开始。产品会把你带回真实可完成的下一步。</p>
        </div>
        <div className="landing-proof__stage">
          <div className="landing-proof__screen">
            <div className="landing-proof__screen-bar"><span>媒体学习器</span><span>字幕自动跟随 · 词语可回看</span></div>
            <div className="landing-proof__screen-content">
              <div className="landing-proof__video"><span>una conversación</span><i aria-hidden="true" /></div>
              <div className="landing-proof__subtitles"><small>当前句</small><strong>{current.spanish}</strong><span>{current.translation}</span><div><b>{current.word}</b><b>hablando</b><b>después</b></div></div>
            </div>
            <div className="landing-proof__signal"><div><span>LIVE TRANSCRIPT</span><small>3 / 3 signals</small></div><div className="landing-proof__signal-bars" aria-hidden="true">{waveform.slice(0, 22).map((height, index) => <i key={index} style={{ "--bar-height": `${height}%`, "--bar-delay": `${index * 22}ms` } as CSSProperties} />)}</div></div>
          </div>
          <div className="landing-proof__notes"><span>产品在做什么</span><strong>{current.eyebrow}</strong><p>{current.detail}</p><Link href="/login?next=%2Fexplore">看看沟通目标 <span aria-hidden="true">↗</span></Link></div>
        </div>
      </section>

      <section className="landing-private" aria-labelledby="relationship-title">
        <div className="landing-private__copy"><span className="landing-section-number">03</span><h2 id="relationship-title">你的进步属于你，关系记忆也只在你允许时共享。</h2></div>
        <div className="landing-private__content">
          <div className="landing-chat"><div className="landing-chat__head"><span>Lucía</span><small>关系记忆 · 只在允许时共享</small></div><div className="landing-chat__message"><span>Lucía</span><p>¿Te apetece seguir hablando después?</p><small>18:42</small></div><div className="landing-chat__message is-user"><span>你</span><p>Sí, me gustaría. Tengo un poco de tiempo.</p><small>18:43</small></div></div>
          <div className="landing-private__rules"><div><b>mastery / confidence</b><span>掌握度和证据可信度分开记录。</span></div><div><b>技术失败</b><span>低置信度转写不会伪装成退步。</span></div><div><b>记忆隔离</b><span>关系内容只在你明确允许时共享。</span></div></div>
        </div>
      </section>

      <section className="landing-closing" aria-labelledby="closing-title"><div><span>开始于一句话</span><h2 id="closing-title">下一句话，从你自己的声音开始。</h2></div><Link className="landing-button landing-button--accent" href="/login">进入学习 <span aria-hidden="true">↗</span></Link></section>
      <footer className="landing-footer"><Link className="landing-wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link><span>把话说出来</span><Link href="/login">登录</Link></footer>
    </main>
  );
}
