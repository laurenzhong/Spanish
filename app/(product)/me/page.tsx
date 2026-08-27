import type { Metadata } from "next";

import { ProfileSections } from "@/src/modules/profile/ui/profile-sections";

export const metadata: Metadata = {
  title: "我的",
};

export default function ProfilePage() {
  return (
    <div className="page-stack profile-page">
      <header className="page-header page-header--simple">
        <div>
          <p className="eyebrow">真实能力</p>
          <h1>我的进步</h1>
          <p>先看你已经能做什么，再决定下一步如何继续。掌握度与证据可信度分开计算。</p>
        </div>
        <span className="profile-page__range" aria-label="当前统计时间范围">最近 28 天 <span aria-hidden="true">⌄</span></span>
      </header>

      <ProfileSections />
    </div>
  );
}
