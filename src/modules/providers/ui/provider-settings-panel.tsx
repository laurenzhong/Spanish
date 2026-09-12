"use client";

import { useEffect, useState } from "react";

import type { ProviderCapabilityStatus, ProviderStatus } from "../provider-settings";
import type { ProviderCapability } from "../routing/provider-registry";

const capabilityLabels: Readonly<Record<ProviderCapability, string>> = {
  "scenario-generation": "场景生成",
  "scenario-roleplay": "临时人物回复",
  "scenario-evaluation": "场景评估",
  transcription: "语音转写",
  pronunciation: "发音评估",
};

const statusLabels = {
  healthy: "运行正常",
  configured: "已配置，等待观测",
  degraded: "近期调用异常",
  unavailable: "未配置",
} as const;

export function ProviderSettingsPanel() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ProviderCapability | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadProviderStatus(controller.signal)
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setError(messageForError());
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function retry() {
    setLoading(true);
    setError(null);
    try { setStatus(await loadProviderStatus()); }
    catch { setError(messageForError()); }
    finally { setLoading(false); }
  }

  async function update(capability: ProviderCapability, value: string) {
    setSaving(capability);
    setError(null);
    setAnnouncement("");
    try {
      const response = await fetch("/api/v1/me/provider-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capability, providerKey: value || null }),
      });
      if (!response.ok) throw new Error("save-failed");
      setStatus(await loadProviderStatus());
      setAnnouncement(`${capabilityLabels[capability]}设置已保存。`);
    } catch {
      setError("Provider 设置未能保存。请检查网络或选择其他可用项后重试。");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      aria-busy={loading}
      aria-labelledby="provider-settings-title"
      className="provider-settings"
      role="region"
    >
      <div className="provider-settings__heading">
        <div>
          <span className="eyebrow">模型与语音服务</span>
          <h2 id="provider-settings-title">Provider 设置</h2>
        </div>
        <span className="provider-settings__privacy">密钥仅保存在服务端</span>
      </div>
      <p className="provider-settings__intro">按能力选择服务。选择“自动”时，会优先使用运行正常的 Provider，并在安全条件下最多切换一次。</p>

      {loading && !status ? <p className="provider-settings__loading" role="status">正在读取 Provider 状态…</p> : null}
      {error ? (
        <div className="provider-settings__error" role="alert">
          <span>{error}</span>
          {!status ? <button className="button button--quiet" type="button" onClick={() => void retry()}>重新加载 Provider 状态</button> : null}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {status ? (
        <div className="provider-settings__list">
          {status.capabilities.map((item) => (
            <ProviderCapabilityCard
              item={item}
              key={item.capability}
              saving={saving === item.capability}
              onChange={(value) => update(item.capability, value)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProviderCapabilityCard({ item, saving, onChange }: Readonly<{
  item: ProviderCapabilityStatus;
  saving: boolean;
  onChange: (value: string) => Promise<void>;
}>) {
  const effective = item.providers.find((provider) => provider.key === item.effectiveProviderKey);
  return (
    <article className="provider-settings__card">
      <div className="provider-settings__card-heading">
        <div>
          <h3>{capabilityLabels[item.capability]}</h3>
          <p>{effective ? `当前使用 ${effective.label}` : "当前没有可用 Provider"}</p>
        </div>
        <span className={`provider-status provider-status--${effective?.status ?? "unavailable"}`}>
          {statusLabels[effective?.status ?? "unavailable"]}
        </span>
      </div>

      {!item.selectedProviderAvailable ? (
        <p className="provider-settings__recovery" role="status">原选择目前不可用，已临时改用可用 Provider。请选择其他服务或恢复自动选择。</p>
      ) : null}

      <label className="provider-settings__select-label" htmlFor={`provider-${item.capability}`}>
        {capabilityLabels[item.capability]} Provider
      </label>
      <select
        aria-label={`${capabilityLabels[item.capability]} Provider`}
        disabled={saving}
        id={`provider-${item.capability}`}
        onChange={(event) => void onChange(event.target.value)}
        value={item.selectedProviderKey ?? ""}
      >
        <option value="">自动选择（推荐）</option>
        {item.providers.map((provider) => (
          <option disabled={!provider.configured} key={provider.key} value={provider.key}>
            {provider.label}{provider.configured ? "" : "（未配置）"}
          </option>
        ))}
      </select>
      <div className="provider-settings__meta">
        <span>{item.canAutoSwitch ? "失败时可安全切换一次" : "当前没有已配置的备用项"}</span>
        {effective?.lastSuccessAt ? <span>最近成功：{formatTime(effective.lastSuccessAt)}</span> : null}
        {effective?.lastFailureAt ? <span>最近失败：{formatTime(effective.lastFailureAt)}</span> : null}
        {saving ? <span role="status">正在保存…</span> : null}
      </div>
    </article>
  );
}

async function loadProviderStatus(signal?: AbortSignal): Promise<ProviderStatus> {
  const response = await fetch("/api/v1/providers/status", { signal });
  if (!response.ok) throw new Error("load-failed");
  const payload = await response.json() as { data?: ProviderStatus };
  if (!payload.data || !Array.isArray(payload.data.capabilities)) throw new Error("invalid-response");
  return payload.data;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function messageForError() {
  return "暂时无法读取 Provider 状态。你的现有学习记录不会受到影响。";
}
