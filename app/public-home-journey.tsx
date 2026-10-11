"use client";

import { useState } from "react";

/**
 * The practice loop, as one small interactive strip. It is the only thing on the
 * public home a visitor can poke at besides the recording, so it stays compact:
 * three steps, each revealing the sentence it works on instead of a paragraph
 * claiming the method.
 */
const steps = {
  hear: {
    label: "听见情境",
    hint: "先听懂对方为什么这样说",
    eyebrow: "先理解情境",
    spanish: "¿Te apetece seguir hablando después?",
    translation: "你愿意之后继续聊聊吗？",
    detail: "字幕跟着当前句走，陌生表达就地查、就地存。",
    words: ["seguir", "después"],
  },
  answer: {
    label: "用自己的话回应",
    hint: "说完整意思，不抢答、不打断",
    eyebrow: "用自己的话回应",
    spanish: "Sí, me gustaría. Tengo un poco de tiempo.",
    translation: "好啊，我愿意。我有一点时间。",
    detail: "说完完整意思再回看：哪些表达可以带到下一次。",
    words: ["me gustaría", "un poco de"],
  },
  carry: {
    label: "带着变式继续",
    hint: "换一个关系、地点或条件再说一次",
    eyebrow: "带着新变式继续",
    spanish: "Podemos seguir mañana, si te viene bien.",
    translation: "如果你方便，我们明天可以继续。",
    detail: "同一句话换个条件，才真的变成你自己的反应。",
    words: ["mañana", "si te viene bien"],
  },
} as const;

type StepKey = keyof typeof steps;
const keys = Object.keys(steps) as StepKey[];

export default function PublicHomeJourney() {
  const [active, setActive] = useState<StepKey>("hear");
  const current = steps[active];

  return (
    <section className="landing-loop" id="how-it-works" aria-labelledby="how-it-works-title">
      <div className="landing-section-head">
        <h2 id="how-it-works-title">一次练习的闭环</h2>
        <p>听见、回应、换一个条件再说一次。点一步看它在做什么。</p>
      </div>

      <div className="landing-loop__body">
        <div className="landing-loop__steps" role="group" aria-label="练习步骤">
          {keys.map((key, index) => (
            <button
              className={`landing-loop__step${key === active ? " is-active" : ""}`}
              type="button"
              key={key}
              aria-pressed={key === active}
              onClick={() => setActive(key)}
              onFocus={() => setActive(key)}
              onPointerEnter={() => setActive(key)}
            >
              <span className="landing-loop__index">{`0${index + 1}`}</span>
              <strong>{steps[key].label}</strong>
              <small>{steps[key].hint}</small>
            </button>
          ))}
        </div>

        <div className="landing-loop__sample" aria-live="polite">
          <p className="landing-loop__eyebrow">{current.eyebrow}</p>
          <p className="landing-loop__es" lang="es">{current.spanish}</p>
          <p className="landing-loop__zh">{current.translation}</p>
          <p className="landing-loop__detail">{current.detail}</p>
          <div className="landing-loop__words">
            {current.words.map((word) => <b key={word} lang="es">{word}</b>)}
          </div>
        </div>
      </div>
    </section>
  );
}
