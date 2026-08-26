import Link from "next/link";

import { ThemeToggle } from "@/src/shared/ui/theme-toggle";

export default function HomePage() {
  return (
    <main className="public-home">
      <header className="public-home__nav">
        <Link className="public-home__wordmark" href="/" aria-label="Sueño 首页">
          Sue<span>ñ</span>o
        </Link>
        <nav aria-label="公开页面导航">
          <ThemeToggle compact />
          <Link className="public-home__login" href="/login">
            登录
          </Link>
          <Link className="primary-link public-home__nav-cta" href="/login">
            进入学习
          </Link>
        </nav>
      </header>
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
