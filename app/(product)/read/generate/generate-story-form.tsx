"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateStoryForm() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controllerRef.current) return;
    // Read the native form at submission so a value already typed before the
    // page hydrates, or filled by Safari, is included.
    const form = new FormData(event.currentTarget);
    const prompt = (form.get("prompt")?.toString() ?? "").trim();
    if (!prompt) {
      setStatus("error");
      setError("先写下你想读的主题或提示词。");
      return;
    }
    if (prompt.length > 500) {
      setStatus("error");
      setError("主题或提示词不能超过 500 个字符。");
      return;
    }
    const keywords = (form.get("keywords")?.toString() ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (keywords.length > 8 || keywords.some((value) => value.length > 40)) {
      setStatus("error");
      setError("关键词最多 8 个，每个不超过 40 个字符。");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/v1/read/generated-stories", {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ prompt, cefr: form.get("cefr"), length: form.get("length"), format: form.get("story-format"), keywords }),
      });
      const payload = (await response.json()) as { data?: { id?: unknown }; error?: { message?: unknown } };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "生成文章暂时不可用，请稍后重试。");
      if (typeof payload.data?.id !== "string") throw new Error("生成结果格式无效，请稍后重试。");
      router.push(`/read/article/${encodeURIComponent(payload.data.id)}`);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "生成文章暂时不可用，请稍后重试。");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus("idle");
  }

  return (
    <section className="read-generate" aria-labelledby="generate-story-heading">
      <div className="read-generate__topbar">
        <Link className="text-link" href="/read">← 返回阅读</Link>
        <span aria-hidden="true">阅读 / Generate Story</span>
      </div>
      <div className="read-generate__body">
        <p className="read-generate__eyebrow">阅读工具</p>
        <h1 id="generate-story-heading">Generate Story</h1>
        <p className="read-generate__intro">为今天的阅读练习定制一篇西语文章，生成后会自动保存到你的 My Texts。</p>
        <form className="read-generate__form" method="post" onSubmit={submit} onChange={() => { if (error) setError(null); }}>
          <label htmlFor="story-prompt">主题或提示词</label>
          <textarea id="story-prompt" name="prompt" placeholder="例如：在社区花园认识新朋友" maxLength={500} required />
          <div className="read-generate__field-grid">
            <div>
              <label htmlFor="story-cefr">难度</label>
              <select id="story-cefr" name="cefr" defaultValue="B1">
                {(["A1", "A2", "B1", "B2"] as const).map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="story-length">长度</label>
              <select id="story-length" name="length" defaultValue="medium">
                <option value="short">短 · 300–450 词</option>
                <option value="medium">中 · 700–900 词</option>
                <option value="long">长 · 1,200–1,500 词</option>
              </select>
            </div>
          </div>
          <fieldset>
            <legend>体裁</legend>
            <div className="read-generate__format-options">
              {([{ value: "story", label: "故事" }, { value: "dialogue", label: "对话" }, { value: "guide", label: "指南" }] as const).map((option) => (
                <label key={option.value}>
                  <input type="radio" name="story-format" value={option.value} defaultChecked={option.value === "story"} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="story-keywords">关键词（可选）</label>
          <input id="story-keywords" name="keywords" placeholder="café, amistad" />
          {error ? <p className="read-generate__error" role="alert">{error}</p> : null}
          <div className="read-generate__actions">
            <button className="primary-action" type="submit" disabled={status === "loading"}>{status === "loading" ? "正在生成…" : "Generate Story"}</button>
            {status === "loading" ? <button className="secondary-action" type="button" onClick={cancel}>取消生成</button> : null}
          </div>
        </form>
        <p className="read-generate__privacy">AI draft · 仅你可见 · 不计入口语评分</p>
      </div>
    </section>
  );
}
