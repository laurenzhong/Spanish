"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export function PersonalScenarioGenerator({ onClose }: Readonly<{ onClose: () => void }>) {
  const [sourceType, setSourceType] = useState<SourceType>("topic");
  const [topic, setTopic] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sources, setSources] = useState<Sources>(emptySources);
  const [loadingSources, setLoadingSources] = useState(true);
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [created, setCreated] = useState<{ title: string; route: string } | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const current = new AbortController(); controller.current = current;
    void fetch("/api/v1/scenarios", { credentials: "same-origin", signal: current.signal })
      .then(async (response) => { if (!response.ok) throw new Error("SOURCES_FAILED"); return response.json() as Promise<{ data?: { generationSources?: Sources } }>; })
      .then((payload) => { if (!current.signal.aborted) setSources(payload.data?.generationSources ?? emptySources); })
      .catch(() => undefined)
      .finally(() => { if (!current.signal.aborted) setLoadingSources(false); });
    return () => current.abort();
  }, []);
  useEffect(() => () => controller.current?.abort(), []);

  const options = useMemo(() => sourceType === "saved-expression" ? sources.savedExpressions : sourceType === "reading" ? sources.readingHighlights : sourceType === "recent-error" ? sources.recentErrors : [], [sourceType, sources]);
  const ready = sourceType === "topic" ? topic.trim().length >= 2 : Boolean(sourceId);

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
      setCreated({ title: payload.data.title, route: payload.data.route }); setStatus("idle");
    } catch { if (!current.signal.aborted) setStatus("error"); }
  }

  return <section className="personal-scenario-generator" aria-labelledby="personal-scenario-generator-title" aria-busy={status === "generating"}>
    <div className="personal-scenario-generator__heading"><div><p className="eyebrow">私人生成</p><h3 id="personal-scenario-generator-title">你想从哪里开始？</h3></div><button type="button" onClick={onClose} aria-label="关闭私人场景生成">关闭</button></div>
    <p>内容只对你可见。生成前不会产生费用；点击确认后才调用生成服务。</p>
    <div className="personal-scenario-generator__choices" role="radiogroup" aria-label="场景生成来源">{choices.map((choice) => <button key={choice.type} type="button" role="radio" aria-checked={sourceType === choice.type} className={sourceType === choice.type ? "is-selected" : ""} onClick={() => selectType(choice.type)}><strong>{choice.label}</strong><small>{choice.hint}</small></button>)}</div>
    {sourceType === "topic" ? <label className="personal-scenario-generator__field"><span>练习主题</span><input value={topic} maxLength={200} placeholder="例如：在药店说明症状并询问用法" onChange={(event) => { setTopic(event.target.value); idempotencyKey.current = null; }} /></label> : loadingSources ? <p role="status">正在读取你的可用来源…</p> : options.length ? <fieldset className="personal-scenario-generator__sources"><legend>选择一项</legend>{options.map((option) => <label key={option.id}><input type="radio" name="generation-source" value={option.id} checked={sourceId === option.id} onChange={() => { setSourceId(option.id); idempotencyKey.current = null; }} /><span><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</span></label>)}</fieldset> : <p className="personal-scenario-generator__empty" role="status">这种来源暂时没有可用内容。你可以先选择“按主题”，或收藏一条表达后再回来。</p>}
    {created ? <div className="personal-scenario-generator__created" role="status"><strong>{created.title}</strong><span>私人场景已经保存，可以立即开始。</span><a className="primary-action" href={created.route}>查看并开始</a></div> : <div className="personal-scenario-generator__actions"><button type="button" className="primary-action" disabled={!ready || status === "generating"} onClick={() => void generate()}>{status === "generating" ? "正在生成…" : "确认生成私人场景"}</button>{status === "error" ? <span role="alert">生成没有完成，未保存半成品。可以用同一请求安全重试。</span> : null}</div>}
  </section>;
}
