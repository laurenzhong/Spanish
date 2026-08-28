import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "帮助与反馈" };

export default function HelpPage() {
  return (
    <div className="page-stack help-page">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">需要一点帮助？</p>
          <h1>帮助与反馈</h1>
          <p>遇到问题时先看看这里；如果仍未解决，欢迎把页面和操作步骤发给我们。</p>
        </div>
      </header>

      <section className="help-page__grid" aria-label="帮助主题">
        <article className="help-page__card">
          <span className="eyebrow">账户</span>
          <h2>修改头像和显示名</h2>
          <p>打开左下角头像，选择“编辑个人资料”。公开 UID 不会因改名或换头像而改变。</p>
          <Link className="button button--quiet" href="/me/profile">打开个人资料</Link>
        </article>
        <article className="help-page__card">
          <span className="eyebrow">学习</span>
          <h2>学习记录和隐私</h2>
          <p>“我的进步”展示能力证据；关系记忆、语音数据和账户删除入口都在隐私分区。</p>
          <Link className="button button--quiet" href="/me">查看我的进步</Link>
        </article>
        <article className="help-page__card">
          <span className="eyebrow">反馈</span>
          <h2>告诉我们哪里需要改进</h2>
          <p>请附上复现步骤、浏览器或设备，以及出现问题的大致时间。不要发送验证码或私密对话原文。</p>
          <a className="button button--primary" href="mailto:feedback@sueno.example?subject=Sue%C3%B1o%20%E5%8F%8D%E9%A6%88">发送反馈邮件</a>
        </article>
      </section>
    </div>
  );
}
