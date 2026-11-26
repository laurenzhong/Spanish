"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ExploreExpressionGenerationSource } from "@/src/modules/explore/domain/explore-library";

type Option = Readonly<{ id: string; label: string; detail: string | null }>;
type Sources = Readonly<{ savedExpressions: readonly Option[]; readingHighlights: readonly Option[]; recentErrors: readonly Option[] }>;
type SourceType = "topic" | "saved-expression" | "reading" | "recent-error";
const emptySources: Sources = { savedExpressions: [], readingHighlights: [], recentErrors: [] };
const choices: readonly Readonly<{ type: SourceType; label: string; hint: string }>[] = [
  { type: "topic", label: "按主题", hint: "例如看病、邻里沟通、旅行或工作交流" },
  { type: "saved-expression", label: "用收藏表达", hint: "把主动收藏的表达放进新语境" },
  { type: "reading", label: "从阅读迁移", hint: "把自己的阅读选区变成口语任务" },
  { type: "recent-error", label: "练近期难点", hint: "只使用已确认、可信的近期问题" },
];

function id(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

export function PersonalScenarioGenerator({ onClose, onCreated, initialSource, initialLabel }: Readonly<{ onClose: () => void; onCreated?: () => void; initialSource?: ExploreExpressionGenerationSource; initialLabel?: string }>) {
  const [sourceType, setSourceType] = useState<SourceType>(initialSource?.sourceType ?? "topic");
  const [topic, setTopic] = useState("");
  const [sourceId, setSourceId] = useState(initialSource?.sourceId ?? "");
  const [sources, setSources] = useState<Sources>(emptySources);
  const [availability, setAvailability] = useState<"loading" | "available" | "unavailable" | "error">("loading");
  const [sourceRequest, setSourceRequest] = useState(0);
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [created, setCreated] = useState<{ title: string; route: string } | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const topicInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (topicInput.current ?? closeButton.current)?.focus();
  }, []);

  useEffect(() => {
    const current = new AbortController();
    const signal = AbortSignal.any([current.signal, AbortSignal.timeout(12_000)]);
    void fetch("/api/v1/scenarios", { credentials: "same-origin", signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("SOURCES_FAILED");
        return response.json() as Promise<{ data?: { generationSources?: Sources; generationAvailable?: boolean } }>;
      })
      .then(({ data }) => {
        if (signal.aborted) return;
        if (!data || typeof data.generationAvailable !== "boolean") throw new Error("SOURCES_INVALID");
        setSources(data.generationSources ?? emptySources);
        setAvailability(data.generationAvailable ? "available" : "unavailable");
      })
      .catch(() => { if (!current.signal.aborted) setAvailability("error"); });
    return () => current.abort();
  }, [sourceRequest]);
  useEffect(() => () => controller.current?.abort(), []);

  const options = sourceType === "saved-expression" ? sources.savedExpressions : sourceType === "reading" ? sources.readingHighlights : sourceType === "recent-error" ? sources.recentErrors : [];
  const ready = availability === "available" && (sourceType === "topic" ? topic.trim().length >= 2 : Boolean(sourceId));

  function selectType(next: SourceType) { setSourceType(next); setSourceId(""); setCreated(null); setStatus("idle"); idempotencyKey.current = null; }

  async function generate() {
    if (!ready || status === "generating") return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    idempotencyKey.current ??= id("generate");
    setStatus("generating"); setCreated(null);
    try {
      const source = sourceType === "topic" ? { sourceType, topic: topic.trim() } : { sourceType, sourceId };
      const response = await fetch("/api/v1/scenarios/generate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey.current }, body: JSON.stringify({ requestId: id("request"), generationId: id("generation"), cefr: "A2", locale: "es-ES", source }), signal: current.signal });
      const payload = await response.json().catch(() => null) as { data?: { title?: string; route?: string }; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data?.title || !payload.data.route) throw new Error(payload?.error?.message ?? "GENERATION_FAILED");
      if (current.signal.aborted) return;
      setCreated({ title: payload.data.title, route: payload.data.route });
      setStatus("idle");
      onCreated?.();
    } catch { if (!current.signal.aborted) setStatus("error"); }
  }

  return <section id="explore-generator" className="personal-scenario-generator" aria-labelledby="personal-scenario-generator-title" aria-busy={status === "generating"} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="personal-scenario-generator__heading"><h2 id="personal-scenario-generator-title">生成私人场景</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="关闭私人场景生成">关闭</button></div>
    <p>生成后的场景只对你可见。</p>
    <div className="personal-scenario-generator__choices" role="radiogroup" aria-label="场景生成来源">{choices.map((choice) => <label key={choice.type} className={sourceType === choice.type ? "is-selected" : ""}><input className="sr-only" type="radio" name="generation-source-type" value={choice.type} checked={sourceType === choice.type} disabled={status === "generating"} onChange={() => selectType(choice.type)} /><strong>{choice.label}</strong><small>{choice.hint}</small></label>)}</div>
    {sourceType === "topic" ? <label className="personal-scenario-generator__field"><span>练习主题</span><input ref={topicInput} value={topic} maxLength={200} disabled={status === "generating"} placeholder="例如：在药店说明症状并询问用法" onChange={(event) => { setTopic(event.target.value); idempotencyKey.current = null; setCreated(null); setStatus("idle"); }} /></label> : initialSource?.sourceType === sourceType && initialSource.sourceId === sourceId ? <div className="personal-scenario-generator__selected-source"><span>已从表达库选择</span><strong lang="es">{initialLabel}</strong></div> : options.length ? (
      <fieldset className="personal-scenario-generator__sources" disabled={status === "generating"}>
        <legend>选择一项</legend>
        <div className="personal-scenario-generator__options">
          {options.map((option) => (
            <label key={option.id}>
              <input type="radio" name="generation-source" value={option.id} checked={sourceId === option.id} onChange={() => { setSourceId(option.id); idempotencyKey.current = null; setCreated(null); setStatus("idle"); }} />
              <span><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</span>
            </label>
          ))}
        </div>
      </fieldset>
    ) : availability === "available" ? <p className="personal-scenario-generator__empty" role="status">这种来源暂时没有可用内容。你可以按主题生成，或收藏一条表达后再回来。</p> : null}
    {availability === "loading" ? <p role="status">正在读取你的可用来源…</p> : null}
    {availability === "unavailable" ? <p role="status">私人生成暂不可用，你仍可以浏览现有场景。</p> : null}
    {availability === "error" ? <p role="alert">暂时无法读取生成来源。 <button type="button" onClick={() => { setAvailability("loading"); setSourceRequest((current) => current + 1); }}>重试</button></p> : null}
    {created ? <div className="personal-scenario-generator__created" role="status"><strong>{created.title}</strong><span>私人场景已经保存，可以立即开始。</span><Link className="primary-action" href={created.route}>查看并开始</Link></div> : <div className="personal-scenario-generator__actions"><button type="button" className="primary-action" disabled={!ready || status === "generating"} onClick={() => void generate()}>{status === "generating" ? "正在生成…" : "确认生成私人场景"}</button>{status === "error" ? <span role="alert">暂时无法确认生成结果。可以用同一请求重试。</span> : null}</div>}
  </section>;
}
