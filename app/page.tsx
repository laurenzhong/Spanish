import Link from "next/link";

export default function HomePage() {
  return (
    <main className="public-home">
      <div className="public-home__content">
        <p className="eyebrow">Sueño · 个人 Alpha</p>
        <h1>把认识的西班牙语，变成真正说得出口的表达。</h1>
        <p>
          围绕真实沟通练习听、说、读、写，系统根据你的能力证据推荐唯一下一步。
        </p>
        <Link className="primary-link" href="/login">
          开始学习
        </Link>
      </div>
    </main>
  );
}
