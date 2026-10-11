"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserAudioRecorder, type BrowserAudioRecorder } from "@/src/modules/providers/speech";

import type { ScenarioPracticeDetail } from "../content";
import { scenarioPracticeHeartbeatSessionId, useScenarioPracticeActivityHeartbeat } from "../activity";

type Turn = { id: string; speaker: "user" | "temporary-character" | "condition"; text: string; modality: "speech" | "typing" | "system" };
type TurnReview = { contextualSuccess: boolean; errors: Array<{ start: number; end: number; explanation: string; affectsUnderstanding: boolean; naturalAlternative: string | null }> };
type SavedPractice = { sessionId: string; persistence?: "account" | "device"; turns: Turn[]; reviews: Record<string, TurnReview>; triggeredConditions: string[]; completed: boolean };

function storageKey(stableKey: string) { return `scenario-practice:v1:${stableKey}`; }
function makeId() { return crypto.randomUUID(); }
function MicrophoneIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></svg>; }
function BackIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>; }
function LightbulbIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M8.2 14.8A6 6 0 1 1 15.8 15c-.9.7-1.5 1.8-1.7 3H9.9c-.2-1.2-.8-2.3-1.7-3.2Z" /></svg>; }
function SendIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3.2-7.2L14 12l-6.8-.8L4 4Z" /><path d="M7.2 12H14" /></svg>; }
function KeyboardIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 14h8M16 14h2" /></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>; }
function InfoIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7.5v.01" /></svg>; }
function CheckIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4.2 4.2L19 6.5" /></svg>; }

export function ScenarioPracticeWorkbench({ scenario, retryText = null, repetitionGoal = null }: Readonly<{ scenario: ScenarioPracticeDetail; retryText?: string | null; repetitionGoal?: string | null }>) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPractice>(() => ({ sessionId: "", turns: [], reviews: {}, triggeredConditions: [], completed: false }));
  const [hydrated, setHydrated] = useState(false);
  const [text, setText] = useState("");
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);
  const [inputMode, setInputMode] = useState<"typing" | "speech">("typing");
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState<{ text: string; confidence: number | null } | null>(null);
  const [expressionsOpen, setExpressionsOpen] = useState(false);
  const recorder = useRef<BrowserAudioRecorder | null>(null);
  const recordingGestureActive = useRef(false);
  const recorderStarted = useRef(false);
  const workbenchRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const expressionsToggleRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => { if (typeof endRef.current?.scrollIntoView === "function") endRef.current.scrollIntoView({ block: "nearest" }); }, [saved.turns, busy]);
  useEffect(() => () => { void recorder.current?.cancel(); }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const workbench = workbenchRef.current;
    if (!viewport || !workbench) return;
    const syncViewport = () => workbench.style.setProperty("--scenario-visible-height", `${Math.round(viewport.height)}px`);
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      workbench.style.removeProperty("--scenario-visible-height");
    };
  }, [hydrated]);

  useEffect(() => {
    if (!expressionsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      expressionsToggleRef.current?.focus();
      setExpressionsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expressionsOpen]);

  // Learning activity only for an account-persisted, unfinished session: a
  // device-only practice has no practice_sessions row to attach events to.
  useScenarioPracticeActivityHeartbeat(
    scenarioPracticeHeartbeatSessionId(saved, { hydrated }),
  );

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
    if (!clean || busy) return;
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
    if (busy || recording) return;
    try {
      recorder.current ??= createBrowserAudioRecorder(() => {
        recordingGestureActive.current = false;
        recorderStarted.current = false;
        setRecording(false);
        setBusy(false);
        setNotice("录音因页面切换或麦克风中断而取消，未送去转写，也不会产生负面评价。你可以重新录音或改用文字。");
      });
      await recorder.current.start();
      recorderStarted.current = true;
      if (!recordingGestureActive.current) {
        recorderStarted.current = false;
        await recorder.current.cancel();
        setRecording(false);
        setNotice("录音已取消，未送去转写。你可以重新按住录音或改用文字。");
        return;
      }
      setRecording(true);
      setNotice("正在录音；松开按钮后转写。完整表达之前不会出现纠错。");
    } catch { setNotice("麦克风不可用，已切换为文字输入。你可以直接键入西班牙语。"); setRecording(false); setInputMode("typing"); }
  }

  async function cancelRecording() {
    recordingGestureActive.current = false;
    if (!recorderStarted.current || !recorder.current) return;
    recorderStarted.current = false;
    setRecording(false);
    await recorder.current.cancel();
    setNotice("录音已取消，未送去转写。你可以重新按住录音或改用文字。");
  }

  async function stopRecording() {
    recordingGestureActive.current = false;
    if (!recorderStarted.current || !recorder.current) return;
    recorderStarted.current = false;
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
    if (userTurnCount < 2) return;
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

  function chooseExpression(expressionText: string) {
    setText(expressionText);
    setExpressionsOpen(false);
    window.requestAnimationFrame(() => textInputRef.current?.focus());
  }

  if (!hydrated) return <main className="scenario-workbench"><p role="status">正在恢复练习断点…</p></main>;

  return (
    <main className="scenario-workbench" ref={workbenchRef}>
      <header className="scenario-workbench__header">
        <button type="button" aria-label="返回场景详情" title="返回场景详情" onClick={() => router.push(`/explore/scenarios/${encodeURIComponent(scenario.stableKey)}`)}><BackIcon /></button>
        <div className="scenario-workbench__title">
          <span className="scenario-workbench__eyebrow">场景实战</span>
          <h1>{scenario.title}</h1>
          <span>{scenario.temporaryCharacter.displayName} · 临时人物</span>
        </div>
        <div className="scenario-workbench__progress" aria-label={`已完成 ${Math.min(userTurnCount, scenario.tasks.length)} / ${scenario.tasks.length} 轮`}>
          <strong>{Math.min(userTurnCount, scenario.tasks.length)}</strong><span>/ {scenario.tasks.length} 轮</span>
        </div>
      </header>
      {scenario.fictionalContext ? <p className="scenario-fiction-notice scenario-fiction-notice--compact"><InfoIcon /><span>虚构练习，不代表真实地点或现实安排{scenario.stableKey === "scenario.rental-conversation" ? "；房源和看房时间均为练习设定" : ""}。</span></p> : null}
      <section className="scenario-goal-strip" aria-labelledby="scenario-current-goal">
        <div className="scenario-goal-strip__copy">
          <span className="scenario-goal-strip__eyebrow">当前目标 · {Math.min(userTurnCount + 1, scenario.tasks.length)}/{scenario.tasks.length}</span>
          <strong id="scenario-current-goal" aria-live="polite">{currentTask.prompt}</strong>
          <span className="scenario-goal-strip__progress" role="progressbar" aria-label="练习目标进度" aria-valuemin={0} aria-valuemax={scenario.tasks.length} aria-valuenow={Math.min(userTurnCount, scenario.tasks.length)}><span style={{ width: `${Math.min(100, Math.round((userTurnCount / scenario.tasks.length) * 100))}%` }} /></span>
        </div>
        <button type="button" aria-label="提示" title={hintLevel === 3 ? "已查看全部提示" : "获取下一条提示"} disabled={hintLevel === 3} onClick={() => setHintLevel((level) => Math.min(3, level + 1) as 1 | 2 | 3)}><LightbulbIcon /><span>提示{hintLevel ? ` ${hintLevel}` : ""}</span></button>
      </section>
      <section className="scenario-transcript" aria-label="练习对话" aria-busy={busy}>
        {displayedTurns.map((turn) => (
          <article className={`scenario-turn scenario-turn--${turn.speaker}`} key={turn.id}>
            <div className="scenario-turn__meta"><span className="scenario-turn__avatar" aria-hidden="true">{turn.speaker === "user" ? "你" : turn.speaker === "condition" ? "!" : scenario.temporaryCharacter.displayName.slice(0, 1)}</span><small>{turn.speaker === "user" ? "你" : turn.speaker === "condition" ? "条件变化" : scenario.temporaryCharacter.displayName}</small></div>
            <p lang={turn.speaker === "condition" ? "zh-CN" : "es"}>{turn.text}</p>
          </article>
        ))}
        {busy ? <p className="scenario-typing" role="status" aria-live="polite"><span className="scenario-typing__dots" aria-hidden="true"><i /><i /><i /></span><span>{scenario.temporaryCharacter.displayName} 正在回应…</span></p> : null}
        <div ref={endRef} />
      </section>
      {notice ? <p className="scenario-notice" role="status" aria-live="polite"><InfoIcon /><span>{notice}</span></p> : null}
      {retryText ? <aside className="scenario-hint"><strong>重新说这一句</strong><p><span lang="es">{retryText}</span> — 保留原意，换一种更自然的表达；这会创建新尝试，不覆盖原记录。</p></aside> : null}
      {repetitionGoal ? <aside className="scenario-hint"><strong>变式复现目标</strong><p>{repetitionGoal}。请根据当前人物和条件自然完成，不必照读原句。</p></aside> : null}
      {hintLevel > 0 ? <aside className="scenario-hint" aria-live="polite"><strong>提示 {hintLevel}</strong><p>{hintLevel === 1 ? currentTask.hints.level1 : hintLevel === 2 ? currentTask.hints.level2 : currentTask.hints.level3}</p></aside> : null}
      {transcriptDraft ? <section className="scenario-transcript-confirm" aria-labelledby="scenario-transcript-confirm-title"><div className="scenario-transcript-confirm__heading"><span className="scenario-transcript-confirm__eyebrow">转写待确认</span><strong id="scenario-transcript-confirm-title">确认或编辑后再发送</strong><p>低置信度转写不会自动提交，也不会产生负面评价。</p></div><label htmlFor="scenario-transcript-text">转写内容<textarea id="scenario-transcript-text" lang="es" value={transcriptDraft.text} onChange={(event) => setTranscriptDraft({ ...transcriptDraft, text: event.target.value })} /></label><div><button type="button" onClick={() => setTranscriptDraft(null)}>取消</button><button className="scenario-transcript-confirm__primary" type="button" onClick={() => void submit(transcriptDraft.text, "speech", transcriptDraft.confidence)}>确认并发送</button></div></section> : null}
      {expressionsOpen ? <section id="scenario-expression-drawer" className="scenario-expression-drawer" role="region" aria-labelledby="scenario-expression-drawer-title"><div className="scenario-expression-drawer__heading"><div><span className="scenario-expression-drawer__eyebrow">快速填入</span><h2 id="scenario-expression-drawer-title">常用表达</h2></div><button type="button" className="scenario-expression-drawer__close" aria-label="关闭常用表达" title="关闭常用表达" onClick={() => { expressionsToggleRef.current?.focus(); setExpressionsOpen(false); }}><CloseIcon /></button></div><div className="scenario-expression-drawer__list">{scenario.expressions.map((expression) => <button type="button" key={expression.stableKey} onClick={() => chooseExpression(expression.text)}><strong lang="es">{expression.text}</strong><span>{expression.translation}</span></button>)}</div></section> : null}
      <section className="scenario-composer" aria-labelledby="scenario-composer-title" data-input-mode={inputMode}>
        <div className="scenario-composer__heading"><div><span className="scenario-composer__eyebrow">轮到你</span><h2 id="scenario-composer-title">用西班牙语回应</h2></div><span className="scenario-composer__status" aria-live="polite">{busy ? "正在处理…" : inputMode === "speech" ? "按住录音，松开后确认转写" : "Enter 发送 · Shift + Enter 换行"}</span></div>
        {inputMode === "typing" ? <div className="scenario-composer__input"><div className="scenario-composer__field"><label className="sr-only" htmlFor="scenario-response">用西班牙语完成你的表达</label><textarea id="scenario-response" ref={textInputRef} lang="es" value={text} disabled={busy} aria-describedby="scenario-composer-title" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(text, "typing"); } }} placeholder="用西班牙语完成你的表达…" /><button className="scenario-composer__mode" type="button" aria-label="切换到语音输入" title="切换到语音输入" disabled={busy} onClick={() => setInputMode("speech")}><MicrophoneIcon /><span className="sr-only">切换到语音输入</span></button></div><button className="scenario-composer__send" type="button" aria-label="发送" disabled={!text.trim() || busy} onClick={() => void submit(text, "typing")}><SendIcon /><span>发送</span></button></div> : <div className="scenario-composer__voice"><div className="scenario-composer__voice-copy"><span className="scenario-composer__eyebrow">语音输入</span><span>{recording ? "正在录音…松开后确认" : "按住说话，完整表达后松开"}</span></div><button className={`scenario-composer__record ${recording ? "is-recording" : ""}`} type="button" aria-label={recording ? "松开发送" : "按住说话"} aria-pressed={recording} disabled={busy} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => { recordingGestureActive.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); void startRecording(); }} onPointerUp={() => void stopRecording()} onPointerCancel={() => void cancelRecording()} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) { event.preventDefault(); recordingGestureActive.current = true; void startRecording(); } }} onKeyUp={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void stopRecording(); } }} onBlur={() => { if (recording) void cancelRecording(); }}><MicrophoneIcon /><span>{recording ? "松开发送" : "按住说话"}</span></button><button className="scenario-composer__keyboard" type="button" disabled={busy} onClick={() => { setInputMode("typing"); window.requestAnimationFrame(() => textInputRef.current?.focus()); }}><KeyboardIcon /><span>切换到文字输入</span></button></div>}
        <div className="scenario-composer__secondary"><button ref={expressionsToggleRef} type="button" aria-label="常用表达" aria-expanded={expressionsOpen} aria-controls="scenario-expression-drawer" onClick={() => setExpressionsOpen((value) => !value)}>常用表达 <span aria-hidden="true">{scenario.expressions.length}</span></button>{userTurnCount >= 2 ? <button className="scenario-complete" type="button" disabled={busy} onClick={() => void complete()}><CheckIcon /><span>完成练习</span></button> : null}</div>
      </section>
    </main>
  );
}
