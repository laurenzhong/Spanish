"use client";

import { useEffect, useState } from "react";

import { RadioGroup, RadioGroupItem, Switch } from "@/src/shared/ui/primitives";

type CorrectionMode = "balanced" | "strict";
type VoicePreference = "preferred" | "optional" | "silent";

const CORRECTION_KEY = "sueno-correction-mode";
const VOICE_KEY = "sueno-voice-preference";

function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function PreferencesPanel() {
  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>(() => {
    if (typeof window === "undefined") return "balanced";
    const value = readPreference(CORRECTION_KEY);
    return value === "strict" ? "strict" : "balanced";
  });
  const [voicePreference, setVoicePreference] = useState<VoicePreference>(() => {
    if (typeof window === "undefined") return "preferred";
    const value = readPreference(VOICE_KEY);
    return value === "optional" || value === "silent" ? value : "preferred";
  });
  const [saved, setSaved] = useState(false);
  const [learningInsightsEnabled, setLearningInsightsEnabled] = useState(true);
  const [recordAssistantLearningIntent, setRecordAssistantLearningIntent] = useState(true);
  const [learningInsightsSaving, setLearningInsightsSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/me/learning-insights-preferences", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { data?: { preferences?: { learningInsightsEnabled?: boolean; recordAssistantLearningIntent?: boolean } } };
        const preferences = payload.data?.preferences;
        if (!preferences) return;
        if (typeof preferences.learningInsightsEnabled === "boolean") setLearningInsightsEnabled(preferences.learningInsightsEnabled);
        if (typeof preferences.recordAssistantLearningIntent === "boolean") setRecordAssistantLearningIntent(preferences.recordAssistantLearningIntent);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function saveLearningInsights(next: { learningInsightsEnabled?: boolean; recordAssistantLearningIntent?: boolean }) {
    const nextValues = {
      learningInsightsEnabled: next.learningInsightsEnabled ?? learningInsightsEnabled,
      recordAssistantLearningIntent: next.recordAssistantLearningIntent ?? recordAssistantLearningIntent,
    };
    setLearningInsightsEnabled(nextValues.learningInsightsEnabled);
    setRecordAssistantLearningIntent(nextValues.recordAssistantLearningIntent);
    setLearningInsightsSaving(true);
    try {
      const response = await fetch("/api/v1/me/learning-insights-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextValues),
      });
      if (!response.ok) throw new Error("save-failed");
      setSaved(true);
    } catch {
      // Keep the local selection visible; the next load will restore the server value.
    } finally {
      setLearningInsightsSaving(false);
    }
  }

  function save(nextCorrection: CorrectionMode, nextVoice: VoicePreference) {
    setCorrectionMode(nextCorrection);
    setVoicePreference(nextVoice);
    try {
      window.localStorage.setItem(CORRECTION_KEY, nextCorrection);
      window.localStorage.setItem(VOICE_KEY, nextVoice);
    } catch {
      // Private browsing can deny storage; the in-memory selection still applies.
    }
    setSaved(true);
  }

  return (
    <section className="preferences-panel" aria-labelledby="preferences-title">
      <div className="preferences-panel__heading">
        <div><span className="eyebrow">练习体验</span><h2 id="preferences-title">偏好设置</h2></div>
        {saved ? <span className="preferences-panel__saved" role="status">已保存</span> : null}
      </div>
      <p className="preferences-panel__intro">这些设置会立即在当前设备生效，不会改变你的学习证据。</p>
      <fieldset className="preferences-panel__field">
        <legend>反馈方式</legend>
        <RadioGroup name="correction-mode" value={correctionMode} onValueChange={(value) => save(value as CorrectionMode, voicePreference)}>
          <label><RadioGroupItem value="balanced" />平衡：只突出影响理解的问题</label>
          <label><RadioGroupItem value="strict" />详细：显示更多可选修正</label>
        </RadioGroup>
      </fieldset>
      <fieldset className="preferences-panel__field" disabled={learningInsightsSaving}>
        <legend>学习轨迹洞察</legend>
        <label><Switch checked={learningInsightsEnabled} onCheckedChange={(checked) => void saveLearningInsights({ learningInsightsEnabled: checked })} />允许记录结构化学习观察，用于生成复习建议</label>
        <label><Switch checked={recordAssistantLearningIntent} disabled={!learningInsightsEnabled} onCheckedChange={(checked) => void saveLearningInsights({ recordAssistantLearningIntent: checked })} />记录 AI 助手的学习意图（不保存原问题或聊天正文）</label>
      </fieldset>
      <fieldset className="preferences-panel__field">
        <legend>语音输入</legend>
        <RadioGroup name="voice-preference" value={voicePreference} onValueChange={(value) => save(correctionMode, value as VoicePreference)}>
          <label><RadioGroupItem value="preferred" />优先使用语音</label>
          <label><RadioGroupItem value="optional" />需要时再使用</label>
          <label><RadioGroupItem value="silent" />暂时不使用语音</label>
        </RadioGroup>
      </fieldset>
    </section>
  );
}
