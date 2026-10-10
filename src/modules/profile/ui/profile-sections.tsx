"use client";

import { useEffect, useState } from "react";

import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";

import { SharedMemoryPermissions } from "@/src/modules/character-network/ui/shared-memory-permissions";
import { ProviderSettingsPanel } from "@/src/modules/providers/ui/provider-settings-panel";
import { AccountDataControls } from "./account-data-controls";
import { LearningHeatmap } from "./learning-heatmap";
import { MemoryDataControls } from "./memory-data-controls";
import { ProfileOverviewPanel } from "./profile-overview-panel";
import { VoiceDataControls } from "./voice-data-controls";
import { PreferencesPanel } from "./preferences-panel";

type ProfileSectionKey = "progress" | "relationships" | "data" | "preferences";

const sections: readonly { key: ProfileSectionKey; id: string; label: string }[] = [
  { key: "progress", id: "profile-progress", label: "能力与活动" },
  { key: "relationships", id: "profile-relationships", label: "关系隐私" },
  { key: "data", id: "profile-data", label: "数据与隐私" },
  { key: "preferences", id: "preferences", label: "偏好设置" },
];

function sectionFromHash(hash: string): ProfileSectionKey {
  const match = sections.find((section) => `#${section.id}` === hash);
  return match?.key ?? "progress";
}

export function ProfileSections() {
  const [activeSection, setActiveSection] = useState<ProfileSectionKey>("progress");
  const [sectionError, setSectionError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const syncFromLocation = () => setActiveSection(sectionFromHash(window.location.hash));
    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  function selectSection(section: typeof sections[number]) {
    setActiveSection(section.key);
    setSectionError(false);
    window.history.pushState(null, "", `#${section.id}`);
  }

  function retrySection() {
    setSectionError(false);
    setRetryToken((token) => token + 1);
  }

  const errorNotice = sectionError ? (
    <div className="profile-section-warning" role="alert">
      <span>这个分区暂时无法读取最新资料，现有记录没有改变。</span>
      <button type="button" onClick={retrySection}>重试</button>
    </div>
  ) : null;

  return (
    <div className="sueno-tabs profile-sections">
      <SlideableNavigation
        className="profile-page__section-nav"
        label="我的页面分区"
        activeKey={activeSection}
        items={sections.map((section) => ({
          key: section.key,
          label: section.label,
          href: `#${section.id}`,
          current: activeSection === section.key,
        }))}
        indicatorClassName="profile-page__section-nav-indicator"
        onSelect={(item) => {
          const section = sections.find((candidate) => candidate.key === item.key);
          if (section) selectSection(section);
        }}
      />

      <section id="profile-progress" className="profile-page__group" aria-labelledby="profile-progress-title" hidden={activeSection !== "progress"}>
        <h2 id="profile-progress-title" className="sr-only">能力与活动</h2>
        {activeSection === "progress" ? <>
          {errorNotice}
          <ProfileOverviewPanel onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
          <LearningHeatmap onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
        </> : null}
      </section>

      <section id="profile-relationships" className="profile-page__group profile-page__group--privacy" aria-labelledby="profile-relationships-title" hidden={activeSection !== "relationships"}>
        <h2 id="profile-relationships-title" className="sr-only">关系隐私</h2>
        {activeSection === "relationships" ? <>
          {errorNotice}
          <SharedMemoryPermissions onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
          <MemoryDataControls onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
        </> : null}
      </section>

      <section id="profile-data" className="profile-page__group profile-page__group--privacy" aria-labelledby="profile-data-title" hidden={activeSection !== "data"}>
        <h2 id="profile-data-title" className="sr-only">数据与隐私</h2>
        {activeSection === "data" ? <>
          {errorNotice}
          <VoiceDataControls onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
          <AccountDataControls onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
        </> : null}
      </section>

      <section id="preferences" className="profile-page__group profile-page__group--privacy" aria-labelledby="preferences-section-title" hidden={activeSection !== "preferences"}>
        <h2 id="preferences-section-title" className="sr-only">偏好设置</h2>
        {activeSection === "preferences" ? <>
          {errorNotice}
          <PreferencesPanel />
          <ProviderSettingsPanel onError={() => setSectionError(true)} retryToken={retryToken} showError={false} />
        </> : null}
      </section>
    </div>
  );
}
