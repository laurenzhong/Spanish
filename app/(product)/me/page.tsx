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

      <ProfileOverviewPanel />
      <LearningHeatmap />
      <SharedMemoryPermissions />
      <MemoryDataControls />
      <VoiceDataControls />
      <AccountDataControls />
    </div>
  );
}
