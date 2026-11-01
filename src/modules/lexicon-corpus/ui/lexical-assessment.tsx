"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, RadioGroup, RadioGroupItem } from "@/src/shared/ui/primitives";

type Assessment = Readonly<{ id: string; assessmentKey: string; version: number; promptType: "choice" | "judgement" | "cloze" | "recall"; prompt: string; options: readonly string[]; sourceReference: Record<string, unknown>; contentVersion: number }>;
type AttemptResult = Readonly<{ passed: boolean; score: 0 | 1; normalizedAnswer: string; duplicate: boolean; evidence: "recorded" | "duplicate" }>;

export function LexicalAssessment({ assessmentKey }: Readonly<{ assessmentKey: string }>) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "submitting">("loading");
  const [submitError, setSubmitError] = useState(false);
  const attemptKeyRef = useRef<{ answer: string; key: string } | null>(null);
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
    if (!answer.trim() || state !== "ready" || !assessment) return;
    setState("submitting");
    setSubmitError(false);
    try {
      const previous = attemptKeyRef.current;
      const idempotencyKey = previous?.answer === answer ? previous.key : crypto.randomUUID();
      attemptKeyRef.current = { answer, key: idempotencyKey };
      const response = await fetch(`/api/v1/lexicon/assessments/${encodeURIComponent(assessmentKey)}/attempts`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ answer }) });
      if (!response.ok) throw new Error("ASSESSMENT_SUBMIT_FAILED");
      const payload = await response.json() as { data?: AttemptResult };
      setResult(payload.data ?? null); setState("ready");
    } catch { setSubmitError(true); setState("ready"); }
  }

  if (state === "loading") return <section className="lexical-assessment"><p>文字考察加载中…</p></section>;
  if (state === "empty") return <section className="lexical-assessment lexical-assessment--empty"><h2>文字考察</h2><p>当前还没有可用的文字考察。</p></section>;
  if (state === "error") return <section className="lexical-assessment lexical-assessment--empty"><h2>文字考察</h2><p>文字考察暂时不可用，请稍后再试。</p></section>;
  if (!assessment) return null;
  const isChoice = assessment.promptType === "choice" || assessment.promptType === "judgement";
  return <section className="lexical-assessment" aria-label="文字考察"><div className="lexical-assessment__heading"><h2>文字考察</h2><span>{assessment.promptType === "choice" ? "选择" : assessment.promptType === "judgement" ? "判断" : assessment.promptType === "cloze" ? "填空" : "回忆"}</span></div><p>{assessment.prompt}</p><form onSubmit={submit}>
    {isChoice && assessment.options.length > 0 ? <fieldset className="lexical-assessment__options"><legend>选择一个答案</legend><RadioGroup name={`assessment-${assessment.id}`} value={answer} onValueChange={(value) => { setAnswer(value); setResult(null); }}>{assessment.options.map((option) => <label key={option}><RadioGroupItem value={option} /> <span>{option}</span></label>)}</RadioGroup></fieldset> : <Input value={answer} onChange={(event) => { setAnswer(event.target.value); setResult(null); }} aria-label="你的答案" autoComplete="off" maxLength={500} />}
    <Button type="submit" disabled={state === "submitting" || !answer.trim()} loading={state === "submitting"}>{state === "submitting" ? "提交中…" : "提交答案"}</Button></form>{submitError ? <p className="lexical-assessment__result is-failed" role="alert">提交失败，答案没有被记录，请重试。</p> : null}{result ? <p className={result.passed ? "lexical-assessment__result is-passed" : "lexical-assessment__result is-failed"} role="status">{result.passed ? "答案通过" : "这次未通过，可以回看语料后再试。"}{result.duplicate ? "（已记录过）" : ""}</p> : null}</section>;
}
