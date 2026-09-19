import Link from "next/link";

import { ThemeToggle } from "@/src/shared/ui/theme-toggle";

const loopSteps = [
  ["01", "先理解情境", "听见对方为什么这样说，再决定自己的回应。"],
  ["02", "用自己的话回应", "完整表达比背出唯一答案更接近真实交流。"],
  ["03", "带着新变式继续", "把刚刚说过的意思迁移到下一个关系和场景。"],
] as const;

const conversation = [
  ["Lucía", "¿Te apetece seguir hablando después?", "18:42"],
  ["你", "Sí, me gustaría. Tengo un poco de tiempo.", "18:43"],
] as const;

export default function HomePage() {
  return (
    <main className="public-home">
      <header className="public-home__nav">
        <Link className="public-home__wordmark" href="/" aria-label="Sueño 首页">
          Sue<span>ñ</span>o
        </Link>
        <nav aria-label="公开页面导航">
          <a className="public-home__text-link" href="#how-it-works">产品方式</a>
          <a className="public-home__text-link" href="#product-proof">阅读</a>
          <ThemeToggle compact />
          <Link className="public-home__login" href="/login">登录</Link>
          <Link className="primary-link public-home__nav-cta" href="/login">进入学习</Link>
        </nav>
      </header>

      <section className="public-home__hero" aria-labelledby="public-home-title">
        <div className="public-home__hero-copy">
          <h1 id="public-home-title">把认识的西语，变成真正说得出口的话。</h1>
          <p>通过真实情境、完整表达和新的变式，练习在生活里自然回应。</p>
          <div className="public-home__hero-actions">
            <Link className="primary-link" href="/login">进入学习 <span aria-hidden="true">→</span></Link>
            <a className="public-home__quiet-link" href="#how-it-works">了解产品方式 <span aria-hidden="true">↓</span></a>
          </div>
        </div>

        <div className="public-home__hero-product" aria-label="Sueño 学习工作台预览">
          <div className="product-preview__chrome">
            <span className="product-preview__brand">Sueño</span>
            <span className="product-preview__context">学习 · 今天</span>
            <span className="product-preview__window-dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div className="product-preview__body">
            <div className="product-preview__rail" aria-hidden="true">
              <span className="is-active" />
              <span />
              <span />
              <span />
            </div>
            <div className="product-preview__content">
              <div className="product-preview__eyeline"><span>今天继续</span><span>语境 · A2</span></div>
              <strong>问候后自然继续交流</strong>
              <p>听见一个真实的下一步，再用自己的话回应。</p>
              <div className="product-preview__media">
                <div className="product-preview__media-art"><span>habla</span><span>escucha</span><span>conecta</span></div>
                <div className="product-preview__media-copy"><span>街角的下午</span><small>视频 · 06:24</small></div>
              </div>
              <div className="product-preview__progress"><span /></div>
            </div>
          </div>
        </div>
      </section>

      <section className="public-home__statement" aria-label="Sueño 的核心方式">
        <p>真实语境。完整表达。可以迁移的下一句话。</p>
        <span aria-hidden="true">↘</span>
      </section>

      <section className="public-home__section public-home__loop" id="how-it-works" aria-labelledby="how-it-works-title">
        <div className="public-home__section-heading">
          <p className="public-home__section-index">01 / 产品方式</p>
          <h2 id="how-it-works-title">每一次练习，都在为下一次真实交流做准备。</h2>
          <p>把理解、回应和迁移放在同一个小循环里，逐渐建立能独立调用的能力。</p>
        </div>
        <ol className="public-home__steps">
          {loopSteps.map(([number, title, description]) => (
            <li key={number}>
              <span className="public-home__step-number">{number}</span>
              <div><h3>{title}</h3><p>{description}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="public-home__proof" id="product-proof" aria-labelledby="product-proof-title">
        <div className="public-home__proof-copy">
          <p className="public-home__section-index">02 / 产品证明</p>
          <h2 id="product-proof-title">不是题库，是一张可以回来的生活地图。</h2>
          <p>从一段视频、一句问候或一个新的沟通目标开始。每个入口都会把你带回真实可完成的下一步。</p>
          <Link className="public-home__quiet-link public-home__proof-link" href="/login?next=%2Fexplore">看看沟通目标 <span aria-hidden="true">→</span></Link>
        </div>
        <div className="public-home__workbench" aria-label="字幕与语境学习器预览">
          <div className="workbench__topline"><span>视频学习器</span><span>正在播放 · 02:18</span></div>
          <div className="workbench__screen">
            <div className="workbench__video"><span>una conversación</span><i aria-hidden="true" /></div>
            <div className="workbench__transcript">
              <small>当前句</small>
              <p lang="es">¿Te apetece seguir hablando después?</p>
              <p lang="zh-CN">你愿意之后继续聊聊吗？</p>
              <div className="workbench__word-line"><span>seguir</span><span>hablando</span><span>después</span></div>
            </div>
          </div>
          <div className="workbench__footer"><span>点击词语查看语境</span><span>字幕 · 双语</span></div>
        </div>
      </section>

      <section className="public-home__relationship" aria-labelledby="relationship-title">
        <div className="public-home__relationship-copy">
          <p className="public-home__section-index">03 / 关系与隐私</p>
          <h2 id="relationship-title">你的进步属于你，关系记忆也只在你允许时共享。</h2>
        </div>
        <div className="public-home__conversation" aria-label="Lucía 对话预览">
          {conversation.map(([speaker, text, time], index) => (
            <div className={`conversation-preview__row${index === 1 ? " conversation-preview__row--user" : ""}`} key={time}>
              <span>{speaker}</span><p>{text}</p><small>{time}</small>
            </div>
          ))}
          <div className="conversation-preview__privacy"><span aria-hidden="true">✓</span><p>能力掌握度与可信度分开记录。技术失败不会伪装成退步。</p></div>
        </div>
      </section>

      <section className="public-home__closing" aria-labelledby="closing-title">
        <h2 id="closing-title">下一句话，从你自己的声音开始。</h2>
        <Link className="primary-link" href="/login">开始第一次练习 <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="public-home__footer">
        <Link className="public-home__wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link>
        <span>把话说出来</span>
        <Link href="/login">进入学习</Link>
      </footer>
    </main>
  );
}
