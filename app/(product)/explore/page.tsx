import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "探索",
};

const collections = [
  { marker: "01", title: "开始交流", detail: "问候、认识新朋友、自然开启话题" },
  { marker: "02", title: "表达需要", detail: "提出请求、确认信息、解决生活问题" },
  { marker: "03", title: "维持对话", detail: "回应、追问、表达兴趣和共同点" },
  { marker: "04", title: "安静学习", detail: "阅读短文、听力输入与打字练习" },
];

export default function ExplorePage() {
  return (
    <div className="page-stack">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">表达资料库</p>
          <h1>探索真实表达</h1>
          <p>从真实沟通目的出发，不按孤立的语法章节堆叠内容。</p>
        </div>
      </header>

      <section className="collection-grid" aria-label="沟通场景">
        {collections.map((collection) => (
          <article className="collection-card" key={collection.marker}>
            <span>{collection.marker}</span>
            <h2>{collection.title}</h2>
            <p>{collection.detail}</p>
          </article>
        ))}
      </section>

      <section className="coming-card" aria-labelledby="reading-title">
        <p className="eyebrow eyebrow--accent">沉浸阅读</p>
        <h2 id="reading-title">短文与故事内容包</h2>
        <p>适合不方便开口时继续理解语法、搭配和真实语境。</p>
        <span>内容整理中</span>
      </section>
    </div>
  );
}
