import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "学习",
};

export default function LearnPage() {
  return (
    <div className="page-stack learn-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">今天</p>
          <p className="welcome-copy">Hola，准备好继续了吗？</p>
        </div>
        <span className="quiet-badge">个人 Alpha</span>
      </header>

      <section className="focus-card" aria-labelledby="next-goal-title">
        <div className="focus-card__halo" aria-hidden="true" />
        <p className="eyebrow eyebrow--accent">接下来最值得练习</p>
        <h1 id="next-goal-title">问候后自然继续交流</h1>
        <p className="focus-card__reason">
          你已经会基本问候，下一步练习如何接着分享共同点，让对话自然延续。
        </p>
        <Link className="primary-action" href="/learn/practice">
          继续学习
          <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="evidence-card" aria-labelledby="recent-ability-title">
        <div className="evidence-icon" aria-hidden="true">
          ✓
        </div>
        <div>
          <p className="eyebrow eyebrow--accent">本周获得的能力</p>
          <h2 id="recent-ability-title">可以独立完成简单自我介绍</h2>
          <p>平均开口反应时间从 5.4 秒降到 3.8 秒。</p>
        </div>
      </section>

      <aside className="gentle-note" aria-label="学习建议">
        <span aria-hidden="true">◌</span>
        <p>每完成一句都会保存进度，随时停下也不会失去本次练习。</p>
      </aside>
    </div>
  );
}
