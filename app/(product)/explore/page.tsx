import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "探索",
};

const collections = [
  { marker: "01", title: "开始交流", detail: "问候、认识新朋友、自然开启话题", focus: "start" },
  { marker: "02", title: "表达需要", detail: "提出请求、确认信息、解决生活问题", focus: "needs" },
  { marker: "03", title: "维持对话", detail: "回应、追问、表达兴趣和共同点", focus: "maintain" },
  { marker: "04", title: "安静学习", detail: "阅读短文、听力输入与打字练习", focus: "silent" },
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
        <p>四个方向覆盖真实交流中最常用的动作。点进去会回到同一条训练路径。</p>
      </section>

      <section className="collection-list" aria-label="沟通场景">
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
      </section>

      <section className="explore-reading" aria-labelledby="reading-title">
        <div>
          <p className="eyebrow eyebrow--accent">沉浸阅读</p>
          <h2 id="reading-title">短文与故事内容包</h2>
          <p>适合不方便开口时继续理解语法、搭配和真实语境。</p>
        </div>
        <span className="status-note">内容整理中</span>
      </section>
    </div>
  );
}
