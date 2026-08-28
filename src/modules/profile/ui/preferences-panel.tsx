"use client";

import { useState } from "react";

type CorrectionMode = "balanced" | "strict";
type VoicePreference = "preferred" | "optional" | "silent";

const CORRECTION_KEY = "sueno-correction-mode";
const VOICE_KEY = "sueno-voice-preference";

export function PreferencesPanel() {
  const [correctionMode, setCorrectionMode] = useState<CorrectionMode>(() => {
    if (typeof window === "undefined") return "balanced";
    const value = window.localStorage.getItem(CORRECTION_KEY);
    return value === "strict" ? "strict" : "balanced";
  });
  const [voicePreference, setVoicePreference] = useState<VoicePreference>(() => {
    if (typeof window === "undefined") return "preferred";
    const value = window.localStorage.getItem(VOICE_KEY);
    return value === "optional" || value === "silent" ? value : "preferred";
  });
  const [saved, setSaved] = useState(false);

  function save(nextCorrection: CorrectionMode, nextVoice: VoicePreference) {
    setCorrectionMode(nextCorrection);
    setVoicePreference(nextVoice);
    window.localStorage.setItem(CORRECTION_KEY, nextCorrection);
    window.localStorage.setItem(VOICE_KEY, nextVoice);
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
        <label><input type="radio" name="correction-mode" checked={correctionMode === "balanced"} onChange={() => save("balanced", voicePreference)} />平衡：只突出影响理解的问题</label>
        <label><input type="radio" name="correction-mode" checked={correctionMode === "strict"} onChange={() => save("strict", voicePreference)} />详细：显示更多可选修正</label>
      </fieldset>
      <fieldset className="preferences-panel__field">
        <legend>语音输入</legend>
        <label><input type="radio" name="voice-preference" checked={voicePreference === "preferred"} onChange={() => save(correctionMode, "preferred")} />优先使用语音</label>
        <label><input type="radio" name="voice-preference" checked={voicePreference === "optional"} onChange={() => save(correctionMode, "optional")} />需要时再使用</label>
        <label><input type="radio" name="voice-preference" checked={voicePreference === "silent"} onChange={() => save(correctionMode, "silent")} />暂时不使用语音</label>
      </fieldset>
    </section>
  );
}
