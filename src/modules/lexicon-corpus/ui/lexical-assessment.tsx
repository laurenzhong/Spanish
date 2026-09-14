"use client";

import { useEffect, useState } from "react";

type Assessment = Readonly<{ id: string; assessmentKey: string; version: number; promptType: "choice" | "judgement" | "cloze" | "recall"; prompt: string; options: readonly string[]; sourceReference: Record<string, unknown>; contentVersion: number }>;
type AttemptResult = Readonly<{ passed: boolean; score: 0 | 1; normalizedAnswer: string; duplicate: boolean; evidence: "recorded" | "duplicate" }>;

export function LexicalAssessment({ assessmentKey }: Readonly<{ assessmentKey: string }>) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "submitting">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/lexicon/assessments/${encodeURIComponent(assessmentKey)}`, { credentials: "same-origin", signal: controller.signal }).then(async (response) => {
      if (response.status === 404) { setState("empty"); return; }
      if (!response.ok) throw new Error("ASSESSMENT_UNAVAILABLE");
      const payload = await response.json() as { data?: Assessment };
      if (!payload.data) throw new Error("ASSESSMENT_INVALID");
      setAssessment(payload.data); setState("ready");
    }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setState("error"); });
    return () => controller.abort();
  }, [assessmentKey]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!answer.trim() || state !== "ready") return;
    setState("submitting");
    try {
      const response = await fetch(`/api/v1/lexicon/assessments/${encodeURIComponent(assessmentKey)}/attempts`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ answer }) });
      if (!response.ok) throw new Error("ASSESSMENT_SUBMIT_FAILED");
      const payload = await response.json() as { data?: AttemptResult };
      setResult(payload.data ?? null); setState("ready");
    } catch { setState("error"); }
  }

  if (state === "loading") return <section className="lexical-assessment"><p>文字考察加载中…</p></section>;
  if (state === "empty") return <section className="lexical-assessment lexical-assessment--empty"><h2>文字考察</h2><p>当前还没有可用的文字考察。</p></section>;
  if (state === "error") return <section className="lexical-assessment lexical-assessment--empty"><h2>文字考察</h2><p>文字考察暂时不可用，请稍后再试。</p></section>;
  if (!assessment) return null;
  return <section className="lexical-assessment" aria-label="文字考察"><div className="lexical-assessment__heading"><h2>文字考察</h2><span>{assessment.promptType === "recall" ? "回忆" : "填空"}</span></div><p>{assessment.prompt}</p><form onSubmit={submit}><input value={answer} onChange={(event) => setAnswer(event.target.value)} aria-label="你的答案" autoComplete="off" maxLength={500} /><button type="submit" disabled={state === "submitting" || !answer.trim()}>{state === "submitting" ? "提交中…" : "提交答案"}</button></form>{result ? <p className={result.passed ? "lexical-assessment__result is-passed" : "lexical-assessment__result is-failed"} role="status">{result.passed ? "答案通过" : "这次未通过，可以稍后再试。"}{result.duplicate ? "（已记录过）" : ""}</p> : null}</section>;
}
