import type { Metadata } from "next";
import Link from "next/link";

import { ProfileSections } from "@/src/modules/profile/ui/profile-sections";
import { isContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import { getCurrentUser } from "@/src/shared/auth/server";

export const metadata: Metadata = {
  title: "我的",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const showContentWorkflow = Boolean(user && isContentWorkflowOwner(user.id));
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

      {showContentWorkflow ? <Link className="profile-page__owner-workflow" href="/me/content-workflow"><span>所有者工具</span><strong>内容工作流</strong><small>复核自动采集候选、记录双维度审核并显式发布。</small></Link> : null}

      <ProfileSections />
    </div>
  );
}
