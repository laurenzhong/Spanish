import type { Metadata } from "next";

import { ProfileOverviewPanel } from "@/src/modules/profile/ui/profile-overview-panel";
import { LearningHeatmap } from "@/src/modules/profile/ui/learning-heatmap";
import { SharedMemoryPermissions } from "@/src/modules/character-network/ui/shared-memory-permissions";
import { MemoryDataControls } from "@/src/modules/profile/ui/memory-data-controls";
import { VoiceDataControls } from "@/src/modules/profile/ui/voice-data-controls";
import { AccountDataControls } from "@/src/modules/profile/ui/account-data-controls";

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
          <p>画像会区分掌握程度与证据可信度，不用学习时长制造虚假进步。</p>
        </div>
      </header>

      <nav className="profile-page__section-nav" aria-label="我的页面分区">
        <a href="#profile-progress">能力与活动</a>
        <a href="#profile-relationships">关系隐私</a>
        <a href="#profile-data">数据与隐私</a>
      </nav>

      <section id="profile-progress" className="profile-page__group" aria-labelledby="profile-progress-title">
        <h2 id="profile-progress-title" className="sr-only">能力与活动</h2>
        <ProfileOverviewPanel />
        <LearningHeatmap />
      </section>

      <section id="profile-relationships" className="profile-page__group profile-page__group--privacy" aria-labelledby="profile-relationships-title">
        <h2 id="profile-relationships-title" className="sr-only">关系隐私</h2>
        <SharedMemoryPermissions />
        <MemoryDataControls />
      </section>

      <section id="profile-data" className="profile-page__group profile-page__group--privacy" aria-labelledby="profile-data-title">
        <h2 id="profile-data-title" className="sr-only">数据与隐私</h2>
        <VoiceDataControls />
        <AccountDataControls />
      </section>
    </div>
  );
}
