import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "探索",
};

const collections = [
  { marker: "01", title: "开始交流", detail: "问候、认识新朋友、自然开启话题", focus: "start" },
  { marker: "02", title: "表达需要", detail: "提出请求、确认信息、解决生活问题", focus: "needs" },
  { marker: "03", title: "维持对话", detail: "回应、追问、表达兴趣和共同点", focus: "maintain" },
  { marker: "04", title: "修复沟通", detail: "请求重复、放慢语速，重新接上对话", focus: "repair" },
  { marker: "05", title: "安静学习", detail: "阅读短文、听力输入与打字练习", focus: "silent" },
];

const contentPacks = [
  {
    title: "咖啡馆里的新朋友",
    summary: "在校园咖啡馆听一段初次认识的对话，理解问候、兴趣和继续交流。",
    level: "A2",
    format: "听 · 读 · 说",
  },
];

export default function ExplorePage() {
  return (
    <div className="page-stack explore-page">
      <header className="page-header page-header--simple explore-page__header">
        <div>
          <p className="eyebrow">表达资料库</p>
          <h1>探索真实表达</h1>
          <p>从真实沟通目的出发，不按孤立的语法章节堆叠内容。</p>
        </div>
        <Link className="text-link" href="/learn">
          回到今天
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </Link>
      </header>

      <section className="explore-intro" aria-label="资料库说明">
        <div>
          <p className="eyebrow eyebrow--accent">从哪里开始</p>
          <h2>先找到你现在最想说的话。</h2>
        </div>
          <p>五个方向覆盖真实交流中最常用的动作。点进去会回到同一条训练路径。</p>
      </section>

      <section className="explore-goals" aria-labelledby="explore-goals-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow--accent">沟通目标</p>
            <h2 id="explore-goals-title">把交流拆成可以练习的动作</h2>
          </div>
          <span>共 5 个方向</span>
        </div>
        <div className="collection-list" aria-label="沟通场景">
        {collections.map((collection) => (
          <Link className="collection-row" href={`/learn?focus=${collection.focus}`} key={collection.marker}>
            <span className="collection-row__marker">{collection.marker}</span>
            <span className="collection-row__body">
              <strong>{collection.title}</strong>
              <span>{collection.detail}</span>
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
        </div>
      </section>

      <section className="explore-packs" aria-labelledby="content-packs-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow--accent">沉浸内容包</p>
            <h2 id="content-packs-title">从一段完整场景里继续理解</h2>
          </div>
          <span>听 · 读 · 说</span>
        </div>
        <div className="explore-pack-grid">
          {contentPacks.map((pack) => (
            <article className="explore-pack-card" data-status="draft" key={pack.title}>
              <div className="explore-pack-card__art" aria-hidden="true">
                <span>CAFÉ</span>
                <strong>Madrid</strong>
              </div>
              <div className="explore-pack-card__body">
                <div className="explore-pack-card__meta">
                  <span>{pack.level}</span>
                  <span>{pack.format}</span>
                </div>
                <h3>{pack.title}</h3>
                <p>{pack.summary}</p>
                <div className="explore-pack-card__footer">
                  <span className="status-note" role="status">内容整理中</span>
                  <span>完成审核后开放</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="explore-packs__empty" role="status">
          <span aria-hidden="true">○</span>
          <p>新的内容包正在审核，先从今天的沟通目标开始。</p>
          <Link className="text-link" href="/learn">回到今天 <span aria-hidden="true">→</span></Link>
        </div>
      </section>
    </div>
  );
}
