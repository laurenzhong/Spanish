import Link from "next/link";

import PublicHomeJourney from "./public-home-journey";

export default function PublicHomeExperience() {
  return (
    <main className="landing-page">
      <section className="landing-hero" aria-labelledby="public-home-title">
        <header className="landing-nav">
          <Link className="landing-wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link>
          <nav aria-label="公开页面导航">
            <a href="#how-it-works">产品方式</a>
            <Link href="/login?next=%2Fread">阅读</Link>
            <Link href="/login">登录</Link>
            <Link className="landing-nav__cta" href="/login?next=%2Flearn">进入学习</Link>
          </nav>
        </header>

        <div className="landing-hero__copy">
          <h1 id="public-home-title">把认识的西语，变成真正说得出口的话。</h1>
          <p>真实情境、完整表达和新的变式，组成一次可以带走的练习。</p>
          <div className="landing-hero__actions">
            <Link className="landing-button landing-button--accent" href="/login?next=%2Flearn">进入学习 <span aria-hidden="true">↗</span></Link>
            <a className="landing-text-button" href="#how-it-works">向下探索 <span aria-hidden="true">↓</span></a>
          </div>
        </div>

        <div className="landing-console" aria-label="Sueño 产品预览" role="region">
          <div className="landing-console__bar">
            <span className="landing-console__product">Sueño <i>学习 / 资料库</i></span>
            <span className="landing-console__live"><b /> 真实产品预览</span>
            <span className="landing-console__dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div className="landing-console__real-preview">
            <div className="landing-console__real-shot">
              <picture>
                <source media="(max-width: 620px)" srcSet="/public-home/media-learning-workbench-mobile-public.png" />
                {/* A native picture keeps the mobile source from requesting the desktop fallback. */}
                <img className="landing-console__shot" src="/public-home/media-learning-workbench-public.png" alt="Sueño 媒体学习工作台公开样例：视频播放器、字幕列表和当前片段" width="1353" height="760" loading="eager" fetchPriority="high" decoding="async" />
              </picture>
            </div>
            <div className="landing-console__real-caption">
              <div><span>真实产品界面 · 脱敏样例</span><strong>媒体、字幕和当前片段在同一处。</strong></div>
              <small>先听懂，再从完整表达开始练习。</small>
            </div>
          </div>
        </div>
        <div className="landing-hero__footline"><span>真实语境 · 完整表达 · 可以迁移的下一句话</span><span>向下继续 ↓</span></div>
      </section>

      <PublicHomeJourney />

      <section className="landing-private" aria-labelledby="relationship-title">
        <div className="landing-private__copy"><span className="landing-section-number">03</span><h2 id="relationship-title">你的进步属于你，关系记忆也只在你允许时共享。</h2></div>
        <div className="landing-private__content">
          <div className="landing-chat"><div className="landing-chat__head"><span>Lucía</span><small>关系记忆 · 只在允许时共享</small></div><div className="landing-chat__message"><span>Lucía</span><p>¿Te apetece seguir hablando después?</p><small>18:42</small></div><div className="landing-chat__message is-user"><span>你</span><p>Sí, me gustaría. Tengo un poco de tiempo.</p><small>18:43</small></div></div>
          <div className="landing-private__rules"><div><b>mastery / confidence</b><span>掌握度和证据可信度分开记录。</span></div><div><b>技术失败</b><span>低置信度转写不会伪装成退步。</span></div><div><b>记忆隔离</b><span>关系内容只在你明确允许时共享。</span></div></div>
        </div>
      </section>

      <section className="landing-closing" aria-labelledby="closing-title"><div><span>开始于一句话</span><h2 id="closing-title">下一句话，从你自己的声音开始。</h2></div><Link className="landing-button landing-button--accent" href="/login?next=%2Flearn">进入学习 <span aria-hidden="true">↗</span></Link></section>
      <footer className="landing-footer"><Link className="landing-wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link><span>把话说出来</span><Link href="/login">登录</Link></footer>
    </main>
  );
}
