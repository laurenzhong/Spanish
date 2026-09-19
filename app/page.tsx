import Link from "next/link";

const loopSteps = [
  ["01", "先理解情境", "听见对方为什么这样说，再决定自己的回应。"],
  ["02", "用自己的话回应", "完整表达比背出唯一答案更接近真实交流。"],
  ["03", "带着新变式继续", "把刚刚说过的意思迁移到下一个关系和场景。"],
] as const;

const conversation = [
  ["Lucía", "¿Te apetece seguir hablando después?", "18:42"],
  ["你", "Sí, me gustaría. Tengo un poco de tiempo.", "18:43"],
] as const;

const privacyNotes = [
  ["记忆隔离", "Lucía 只记住你明确允许留在关系里的内容。"],
  ["mastery / confidence", "掌握度和证据可信度分开记录，技术失败不会伪装成退步。"],
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

        <div className="public-home__hero-product" aria-label="Sueño 学习资料库界面预览">
          <div className="product-ui__bar">
            <span className="product-ui__brand">Sueño</span>
            <span className="product-ui__route">学习 / 资料库</span>
            <span className="product-ui__status"><i /> 本地演示</span>
          </div>
          <div className="product-ui__workspace">
            <aside className="product-ui__sidebar" aria-label="产品区域">
              <span className="is-active">学</span><span>读</span><span>探</span><span>聊</span>
            </aside>
            <div className="product-ui__main">
              <div className="product-ui__eyeline"><span>今天继续</span><span>A2 · 语境练习</span></div>
              <h2>问候后，自然地继续交流</h2>
              <p className="product-ui__summary">一段真实对话，先听懂，再说出自己的下一句。</p>
              <div className="product-ui__content-row">
                <div className="product-ui__poster" role="img" aria-label="街角下午的西语视频静态封面">
                  <span>街角的下午</span><small>VIDEO · 06:24</small><b aria-hidden="true">▶</b>
                </div>
                <div className="product-ui__lesson-meta">
                  <span className="product-ui__meta-label">正在学习</span>
                  <strong>问候后自然继续</strong>
                  <span>视频 · 字幕 · 词语</span>
                  <div className="product-ui__progress" aria-label="学习进度 42%"><i /></div>
                  <small>已完成 02:18</small>
                </div>
              </div>
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
        <div className="public-home__workbench" aria-label="媒体、字幕和词语学习器预览">
          <div className="proof-console__header"><span>学习工作台</span><span>媒体 · 字幕 · 词语学习器</span></div>
          <div className="proof-console__grid">
            <div className="proof-console__media">
              <div className="proof-console__frame" role="img" aria-label="西语对话视频静态画面"><span>una conversación</span><i aria-hidden="true">▶</i></div>
              <div className="proof-console__caption"><span>当前句</span><p lang="es">¿Te apetece seguir hablando después?</p><p lang="zh-CN">你愿意之后继续聊聊吗？</p></div>
            </div>
            <div className="proof-console__lexicon">
              <span className="proof-console__label">词语学习器</span>
              <strong>seguir</strong>
              <p lang="zh-CN">继续；接着</p>
              <div className="proof-console__word-list"><span>seguir</span><span>hablando</span><span>después</span></div>
              <small>点击词语，回到它出现的语境。</small>
            </div>
          </div>
          <div className="proof-console__footer"><span>字幕自动跟随当前句</span><span>双语 · 可回看</span></div>
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
          <ul className="conversation-preview__notes">
            {privacyNotes.map(([title, description]) => (
              <li key={title}><strong>{title}</strong><span>{description}</span></li>
            ))}
          </ul>
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
