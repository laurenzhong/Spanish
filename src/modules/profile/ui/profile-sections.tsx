"use client";

import { useEffect, useState } from "react";

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
    window.history.pushState(null, "", `#${section.id}`);
  }

  return (
    <>
      <nav className="profile-page__section-nav" aria-label="我的页面分区">
        {sections.map((section) => (
          <a
            aria-current={activeSection === section.key ? "page" : undefined}
            aria-controls={section.id}
            className={activeSection === section.key ? "is-active" : undefined}
            href={`#${section.id}`}
            key={section.key}
            onClick={(event) => {
              event.preventDefault();
              selectSection(section);
            }}
          >
            {section.label}
          </a>
        ))}
      </nav>

      <section id="profile-progress" className="profile-page__group" aria-labelledby="profile-progress-title" hidden={activeSection !== "progress"}>
        <h2 id="profile-progress-title" className="sr-only">能力与活动</h2>
        <ProfileOverviewPanel />
        <LearningHeatmap />
      </section>

      <section id="profile-relationships" className="profile-page__group profile-page__group--privacy" aria-labelledby="profile-relationships-title" hidden={activeSection !== "relationships"}>
        <h2 id="profile-relationships-title" className="sr-only">关系隐私</h2>
        <SharedMemoryPermissions />
        <MemoryDataControls />
      </section>

      <section id="profile-data" className="profile-page__group profile-page__group--privacy" aria-labelledby="profile-data-title" hidden={activeSection !== "data"}>
        <h2 id="profile-data-title" className="sr-only">数据与隐私</h2>
        <VoiceDataControls />
        <AccountDataControls />
      </section>

      <section id="preferences" className="profile-page__group profile-page__group--privacy" aria-labelledby="preferences-section-title" hidden={activeSection !== "preferences"}>
        <h2 id="preferences-section-title" className="sr-only">偏好设置</h2>
        <PreferencesPanel />
        <ProviderSettingsPanel />
      </section>
    </>
  );
}
