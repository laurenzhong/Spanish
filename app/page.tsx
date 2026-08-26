import Link from "next/link";

import { ThemeToggle } from "@/src/shared/ui/theme-toggle";

const scenarios = [
  { title: "开口练习", description: "从一句真实会用的表达开始。", href: "/login?next=%2Flearn%2Fpractice" },
  { title: "沉浸阅读", description: "读生活、工作和文化里的西语。", href: "#reading" },
  { title: "持续对话", description: "和 Lucía 形成共同经历。", href: "/login?next=%2Fchat%2Flucia" },
] as const;

const steps = [
  ["01", "先理解情境", "听见对方为什么这样说，再决定自己的回应。"],
  ["02", "用自己的话回应", "完整表达比背出唯一答案更接近真实交流。"],
  ["03", "带着新变式继续", "把刚刚说过的意思迁移到下一个关系和场景。"],
] as const;

const faqs = [
  ["需要先选课程或学习时长吗？", "不需要。Sueño 会给你一个真实的下一步，其他调整入口会在需要时出现。"],
  ["说错时会立刻被打断吗？", "不会。你先把完整意思说完，系统再根据语境成功和可复用证据给出反馈。"],
  ["我的对话和学习数据会怎样使用？", "学习证据、关系记忆和账户数据分开保存，并提供可查看、撤回和删除的隐私控制。"],
] as const;

export default function HomePage() {
  return (
    <main className="public-home">
      <header className="public-home__nav">
        <Link className="public-home__wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link>
        <nav aria-label="公开页面导航">
          <a className="public-home__text-link" href="#how-it-works">产品方式</a>
          <a className="public-home__text-link" href="#reading">阅读</a>
          <ThemeToggle compact />
          <Link className="public-home__login" href="/login">登录</Link>
          <Link className="primary-link public-home__nav-cta" href="/login">进入学习</Link>
        </nav>
      </header>

      <section className="public-home__hero" aria-labelledby="public-home-title">
        <div className="public-home__hero-copy">
          <p className="eyebrow">SPEAK WITH CONTEXT</p>
          <h1 id="public-home-title">把认识的西语，变成真正说得出口的话。</h1>
          <p>通过真实情境、完整表达和新的变式，练习在生活里自然回应。没有抢答式纠错，也没有虚假的分数。</p>
          <Link className="primary-link" href="/login">开始第一次练习 <span aria-hidden="true">→</span></Link>
        </div>
        <div className="public-home__hero-art" aria-label="Sueño 的听说连接方式" role="img"><span>habla</span><span>escucha</span><span>conecta</span></div>
      </section>

      <section className="public-home__scenario-strip" aria-label="Sueño 的三类使用场景">
        {scenarios.map((scenario) => <Link className="public-home__scenario" href={scenario.href} key={scenario.title}><strong>{scenario.title}</strong><span>{scenario.description}</span></Link>)}
      </section>

      <section className="public-home__section" id="how-it-works" aria-labelledby="how-it-works-title">
        <div className="public-home__section-heading"><p className="eyebrow">A QUIET LOOP</p><h2 id="how-it-works-title">每一次练习，都在为下一次真实交流做准备。</h2><p>把理解、回应和迁移放在同一个小循环里，逐渐建立能独立调用的能力。</p></div>
        <ol className="public-home__steps">{steps.map(([number, title, description]) => <li key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></li>)}</ol>
      </section>

      <section className="public-home__product-slice" id="reading" aria-labelledby="product-slice-title">
        <div><p className="eyebrow">A REAL PLACE TO PRACTICE</p><h2 id="product-slice-title">不是题库，是一张可以回来的生活地图。</h2><p>从一段文章、一句问候或一个新的沟通目标开始。每个入口都会把你带回真实可完成的下一步。</p><Link className="secondary-action" href="/login?next=%2Fexplore">看看沟通目标 <span aria-hidden="true">→</span></Link></div>
        <div className="public-home__mini-workbench" aria-label="学习工作台预览"><div className="mini-workbench__top"><span>今天继续</span><i aria-hidden="true" /></div><strong>问候后自然继续交流</strong><p>练习接着分享共同点，让对话自然延续。</p><div className="mini-workbench__bottom"><span>继续学习</span><span>语境 · A2</span></div></div>
      </section>

      <section className="public-home__trust" aria-labelledby="trust-title"><div><p className="eyebrow">PRIVATE BY DEFAULT</p><h2 id="trust-title">你的进步属于你，关系记忆也只在你允许时共享。</h2></div><p>能力掌握度和可信度分开记录；低置信度转写、技术失败和打字输入不会伪装成负面口语证据。你可以随时查看、撤回或删除自己的数据。</p></section>

      <section className="public-home__faq" aria-labelledby="faq-title"><div className="public-home__section-heading"><p className="eyebrow">FAQ</p><h2 id="faq-title">开始之前，先把边界说清楚。</h2></div><div className="public-home__faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

      <footer className="public-home__footer"><Link className="public-home__wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link><span>把话说出来</span><Link href="/login">开始第一次练习</Link></footer>
    </main>
  );
}
