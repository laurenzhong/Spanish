"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserAudioRecorder, type BrowserAudioRecorder } from "@/src/modules/providers/speech";

import type { ScenarioPracticeDetail } from "../content";

type Turn = { id: string; speaker: "user" | "temporary-character" | "condition"; text: string; modality: "speech" | "typing" | "system" };
type TurnReview = { contextualSuccess: boolean; errors: Array<{ start: number; end: number; explanation: string; affectsUnderstanding: boolean; naturalAlternative: string | null }> };
type SavedPractice = { sessionId: string; persistence?: "account" | "device"; turns: Turn[]; reviews: Record<string, TurnReview>; triggeredConditions: string[]; completed: boolean };

function storageKey(stableKey: string) { return `scenario-practice:v1:${stableKey}`; }
function makeId() { return crypto.randomUUID(); }

export function ScenarioPracticeWorkbench({ scenario, retryText = null, repetitionGoal = null }: Readonly<{ scenario: ScenarioPracticeDetail; retryText?: string | null; repetitionGoal?: string | null }>) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPractice>(() => ({ sessionId: "", turns: [], reviews: {}, triggeredConditions: [], completed: false }));
  const [hydrated, setHydrated] = useState(false);
  const [text, setText] = useState("");
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState<{ text: string; confidence: number | null } | null>(null);
  const [expressionsOpen, setExpressionsOpen] = useState(false);
  const recorder = useRef<BrowserAudioRecorder | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(storageKey(scenario.stableKey));
        if (raw) {
          const restored = JSON.parse(raw) as SavedPractice;
          const query = new URLSearchParams(window.location.search);
          setSaved(restored.completed && (query.has("retryTurnId") || query.has("repetitionId"))
            ? { sessionId: "", turns: [], reviews: {}, triggeredConditions: [], completed: false }
            : restored);
        }
      } catch { setNotice("无法读取本设备上的练习断点，你仍可开始新练习。"); }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scenario.stableKey]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(storageKey(scenario.stableKey), JSON.stringify(saved)); } catch { /* The in-memory session remains usable. */ }
  }, [hydrated, saved, scenario.stableKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [saved.turns, busy]);
  useEffect(() => () => { void recorder.current?.cancel(); }, []);

  const userTurnCount = saved.turns.filter((turn) => turn.speaker === "user").length;
  const currentTask = scenario.tasks[Math.min(userTurnCount, scenario.tasks.length - 1)]!;
  const displayedTurns = useMemo<Turn[]>(() => [
    { id: "opening", speaker: "temporary-character", modality: "system", text: scenario.openingLine },
    ...saved.turns,
  ], [saved.turns, scenario.openingLine]);

  function update(next: (current: SavedPractice) => SavedPractice) { setSaved((current) => next(current)); }

  async function ensureSession(): Promise<{ sessionId: string; persistence: "account" | "device" }> {
    if (saved.sessionId) return { sessionId: saved.sessionId, persistence: saved.persistence ?? "device" };
    const sessionId = makeId();
    let persistence: "account" | "device" = "device";
    try {
      const response = await fetch("/api/v1/scenario-practice/sessions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, clientAttemptId: makeId(), scenarioKey: scenario.stableKey, primaryModality: "typing" }) });
      if (response.ok) { const payload = await response.json() as { data?: { persistence?: "account" | "device" } }; persistence = payload.data?.persistence ?? "device"; }
    } catch { /* Device persistence remains explicit. */ }
    update((current) => ({ ...current, sessionId, persistence }));
    return { sessionId, persistence };
  }

  async function submit(message: string, modality: "speech" | "typing", confidence: number | null = null) {
    const clean = message.trim();
    if (!clean || busy || paused) return;
    setBusy(true); setNotice(null); setText(""); setTranscriptDraft(null);
    const session = await ensureSession();
    const sessionId = session.sessionId;
    const generationId = makeId();
    const userTurn: Turn = { id: makeId(), speaker: "user", text: clean, modality };
    const turnsWithUser = [...saved.turns, userTurn];
    update((current) => ({ ...current, turns: [...current.turns, userTurn] }));

    if (session.persistence === "account") {
      try {
        const persisted = await fetch(`/api/v1/scenario-practice/sessions/${sessionId}/turns`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: userTurn.id, clientAttemptId: userTurn.id, turnIndex: saved.turns.length, modality, text: clean, attemptId: userTurn.id, generationId }) });
        if (!persisted.ok) throw new Error("TURN_SYNC_FAILED");
      } catch { setNotice("原句已保存在本设备，但暂时没有同步到账号。可稍后重试本轮。"); setBusy(false); return; }
    }

    void evaluateTurn(sessionId, userTurn, turnsWithUser, confidence, session.persistence);
    try {
      const response = await fetch(`/api/v1/scenario-practice/sessions/${sessionId}/turns/${userTurn.id}/respond`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioKey: scenario.stableKey, generationId, characterTurnId: makeId(), turnIndex: saved.turns.length + 1, persist: session.persistence === "account", completedTurns: turnsWithUser.map(({ speaker, text }) => ({ speaker, text })), triggeredConditions: saved.triggeredConditions }),
      });
      if (!response.ok || !response.body) throw new Error("REPLY_UNAVAILABLE");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let reply = ""; let didFinish = false;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const frame = JSON.parse(line) as { type: string; text?: string; stableKey?: string };
          if (frame.type === "condition" && frame.text && frame.stableKey) {
            const conditionTurn: Turn = { id: makeId(), speaker: "condition", modality: "system", text: frame.text };
            update((current) => ({ ...current, turns: [...current.turns, conditionTurn], triggeredConditions: [...new Set([...current.triggeredConditions, frame.stableKey!])] }));
          }
          if (frame.type === "delta" && frame.text) reply += frame.text;
          if (frame.type === "done") didFinish = true;
          if (frame.type === "error") throw new Error("REPLY_UNAVAILABLE");
        }
      }
      if (!didFinish || !reply.trim()) throw new Error("REPLY_INCOMPLETE");
      update((current) => ({ ...current, turns: [...current.turns, { id: makeId(), speaker: "temporary-character", modality: "system", text: reply.trim() }] }));
      setHintLevel(0);
    } catch {
      setNotice("临时人物回复没有完整生成。你的原句已保留，可以重试发送或稍后继续。");
    } finally { setBusy(false); }
  }

  async function evaluateTurn(sessionId: string, turn: Turn, turns: Turn[], transcriptConfidence: number | null, persistence: "account" | "device") {
    try {
      const response = await fetch(`/api/v1/scenario-practice/sessions/${sessionId}/turns/${turn.id}/evaluate`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioKey: scenario.stableKey, generationId: makeId(), persist: persistence === "account", modality: turn.modality, hintLevel, transcriptConfidence, completedTurns: turns.map((item) => ({ turnId: item.id, speaker: item.speaker, text: item.text })) }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { data?: TurnReview };
      if (payload.data) update((current) => ({ ...current, reviews: { ...current.reviews, [turn.id]: payload.data! } }));
    } catch { /* A pending review is neutral and may be retried at completion. */ }
  }

  async function startRecording() {
    if (busy || paused || recording) return;
    try {
      recorder.current ??= createBrowserAudioRecorder();
      await recorder.current.start(); setRecording(true); setNotice("正在录音；松开按钮后转写。完整表达之前不会出现纠错。");
    } catch { setNotice("麦克风不可用，已切换为文字输入。你可以直接键入西班牙语。"); setRecording(false); }
  }

  async function stopRecording() {
    if (!recording || !recorder.current) return;
    setRecording(false); setBusy(true); setNotice("正在转写，结果确认后才会提交。");
    try {
      const audio = await recorder.current.stop();
      const form = new FormData(); form.set("audio", audio.blob, `scenario.${audio.metadata.mimeType.includes("mp4") ? "m4a" : "webm"}`); form.set("languageTag", "es-ES");
      const response = await fetch("/api/v1/transcriptions", { method: "POST", body: form, credentials: "same-origin" });
      if (!response.ok) throw new Error("TRANSCRIPTION_FAILED");
      const payload = await response.json() as { data: { text: string; confidence: number | null } };
      setTranscriptDraft({ text: payload.data.text, confidence: payload.data.confidence }); setNotice(null);
    } catch { setNotice("这段录音没有成功转写，未产生任何负面评价。请重试或改用文字。"); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (userTurnCount === 0) { setNotice("先完成至少一轮表达，再查看复盘。"); return; }
    update((current) => ({ ...current, completed: true }));
    if (saved.sessionId && saved.persistence === "account") {
      try {
        const response = await fetch(`/api/v1/scenario-practice/sessions/${saved.sessionId}/complete`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: `complete-${saved.sessionId}` }) });
        if (!response.ok) throw new Error("COMPLETE_FAILED");
      } catch {
        setNotice("练习已保存在本设备，但账号复盘暂时没有完成同步。请重试结束操作。");
        update((current) => ({ ...current, completed: false }));
        return;
      }
    }
    const repetitionId = new URLSearchParams(window.location.search).get("repetitionId");
    if (repetitionId) {
      const userTurns = saved.turns.filter((turn) => turn.speaker === "user");
      const readyReviews = userTurns.map((turn) => saved.reviews[turn.id]).filter(Boolean);
      const result = readyReviews.length !== userTurns.length
        ? "technical-failure"
        : readyReviews.some((review) => !review.contextualSuccess)
          ? "needs-work"
          : "contextual-success";
      try {
        const response = await fetch(`/api/v1/scenario-practice/due/${encodeURIComponent(repetitionId)}`, {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ completionKey: `repetition-${repetitionId}-${saved.sessionId}`, result }),
        });
        if (!response.ok) throw new Error("REPETITION_COMPLETE_FAILED");
      } catch {
        setNotice("本次表达已保留，但复现任务暂时没有同步；它仍会保持待完成，不会产生负面记录。");
      }
    }
    const sessionQuery = saved.sessionId && saved.persistence === "account" ? `?sessionId=${encodeURIComponent(saved.sessionId)}` : "";
    router.push(`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}/review${sessionQuery}`);
  }

  if (!hydrated) return <main className="scenario-workbench"><p role="status">正在恢复练习断点…</p></main>;

  return (
    <main className="scenario-workbench">
      <header className="scenario-workbench__header">
        <a href={`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}`} aria-label="返回场景详情">←</a>
        <div><strong>{scenario.title}</strong><span>{scenario.temporaryCharacter.displayName} · 临时人物</span></div>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button>
      </header>
      {scenario.fictionalContext ? <p className="scenario-fiction-notice scenario-fiction-notice--compact">虚构练习，不代表真实地点或现实安排{scenario.stableKey === "scenario.rental-conversation" ? "；房源和看房时间均为练习设定" : ""}。</p> : null}
      <section className="scenario-goal-strip" aria-live="polite"><span>当前目标 {Math.min(userTurnCount + 1, scenario.tasks.length)} / {scenario.tasks.length}</span><strong>{currentTask.prompt}</strong><button type="button" disabled={hintLevel === 3 || paused} onClick={() => setHintLevel((level) => Math.min(3, level + 1) as 1 | 2 | 3)}>提示 {hintLevel || ""}</button></section>
      <section className="scenario-transcript" aria-label="练习对话" aria-busy={busy}>
        {displayedTurns.map((turn) => (
          <article className={`scenario-turn scenario-turn--${turn.speaker}`} key={turn.id}>
            <small>{turn.speaker === "user" ? "你" : turn.speaker === "condition" ? "条件变化" : scenario.temporaryCharacter.displayName}</small>
            <p lang={turn.speaker === "condition" ? "zh-CN" : "es"}>{turn.text}</p>
          </article>
        ))}
        {busy ? <p className="scenario-typing" role="status">{scenario.temporaryCharacter.displayName} 正在回应…</p> : null}
        <div ref={endRef} />
      </section>
      {paused ? <div className="scenario-paused" role="status"><strong>练习已暂停</strong><span>对话断点已保存在本设备。</span></div> : null}
      {notice ? <p className="scenario-notice" role="status">{notice}</p> : null}
      {retryText ? <aside className="scenario-hint"><strong>重新说这一句</strong><p><span lang="es">{retryText}</span> — 保留原意，换一种更自然的表达；这会创建新尝试，不覆盖原记录。</p></aside> : null}
      {repetitionGoal ? <aside className="scenario-hint"><strong>变式复现目标</strong><p>{repetitionGoal}。请根据当前人物和条件自然完成，不必照读原句。</p></aside> : null}
      {hintLevel > 0 ? <aside className="scenario-hint" aria-live="polite"><strong>提示 {hintLevel}</strong><p>{hintLevel === 1 ? currentTask.hints.level1 : hintLevel === 2 ? currentTask.hints.level2 : currentTask.hints.level3}</p></aside> : null}
      {transcriptDraft ? <section className="scenario-transcript-confirm" aria-label="确认转写"><label>确认或编辑转写<textarea lang="es" value={transcriptDraft.text} onChange={(event) => setTranscriptDraft({ ...transcriptDraft, text: event.target.value })} /></label><div><button type="button" onClick={() => setTranscriptDraft(null)}>取消</button><button type="button" onClick={() => void submit(transcriptDraft.text, "speech", transcriptDraft.confidence)}>确认并发送</button></div></section> : null}
      {expressionsOpen ? <section className="scenario-expression-drawer" aria-label="可用表达">{scenario.expressions.map((expression) => <button type="button" key={expression.stableKey} onClick={() => { setText(expression.text); setExpressionsOpen(false); }}><strong lang="es">{expression.text}</strong><span>{expression.translation}</span></button>)}</section> : null}
      <section className="scenario-composer" aria-label="发送表达">
        <div className="scenario-composer__input"><textarea ref={textInputRef} lang="es" value={text} disabled={busy || paused} onChange={(event) => setText(event.target.value)} placeholder="用西班牙语完成你的表达…" /><button type="button" disabled={!text.trim() || busy || paused} onClick={() => void submit(text, "typing")}>发送</button></div>
        <div className="scenario-composer__tools">
          <button type="button" aria-expanded={expressionsOpen} onClick={() => setExpressionsOpen((value) => !value)}>表达</button>
          <button className={recording ? "is-recording" : ""} type="button" disabled={busy || paused} onPointerDown={() => void startRecording()} onPointerUp={() => void stopRecording()} onPointerCancel={() => void stopRecording()}>{recording ? "松开发送" : "按住说话"}</button>
          <button type="button" disabled={paused} onClick={() => textInputRef.current?.focus()}>键盘</button>
        </div>
        <button className="scenario-complete" type="button" disabled={busy || userTurnCount === 0} onClick={() => void complete()}>结束并查看复盘</button>
      </section>
    </main>
  );
}
