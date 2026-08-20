import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "我的",
};

const skillAxes = ["听懂", "反应", "清晰", "语流", "准确", "语用", "迁移", "互动"];

export default function ProfilePage() {
  return (
    <div className="page-stack">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">真实能力</p>
          <h1>我的进步</h1>
          <p>画像会区分掌握程度与证据可信度，不用学习时长制造虚假进步。</p>
        </div>
      </header>

      <section className="profile-grid">
        <article className="skill-card" aria-labelledby="skill-map-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow eyebrow--accent">八维能力</p>
              <h2 id="skill-map-title">正在建立你的基线</h2>
            </div>
            <span>数据不足</span>
          </div>
          <div className="skill-wheel" aria-label="八维能力数据尚不足">
            <div className="skill-wheel__center">完成诊断后显示</div>
          </div>
          <div className="skill-labels" aria-hidden="true">
            {skillAxes.map((axis) => (
              <span key={axis}>{axis}</span>
            ))}
          </div>
        </article>

        <article className="ability-proof" aria-labelledby="ability-proof-title">
          <p className="eyebrow eyebrow--accent">最近证据</p>
          <h2 id="ability-proof-title">可以独立完成简单自我介绍</h2>
          <p>已通过自由表达验证；发音与语流仍会随着新口语样本继续更新。</p>
        </article>
      </section>
    </div>
  );
}
