"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "@/src/shared/ui/motion";

import {
  nextUnansweredRecallId, reduceRecall, startRecall, summarizeRecall,
  type RecallAction, type RecallItem, type RecallMode, type RecallSession,
} from "../domain/vocabulary-recall";
import type { VocabularyShelfStatus } from "./vocabulary-shelf";

type Target = Readonly<{ item: RecallItem; tile: HTMLElement; row: HTMLElement }>;
type Props = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  statuses: Readonly<Record<string, VocabularyShelfStatus>>;
  meaningsFor: (key: string) => readonly string[];
  onActiveChange: (active: boolean) => void;
  onBegin: () => void;
}>;

const modes = [["word", "看释义写单词"], ["meaning", "看单词写释义"]] as const;
const resultLabels = { correct: "正确", accent: "重音有误", incorrect: "需要复习", pending: "待确认", unanswered: "未作答" };
const resultIcons = { correct: "✓", accent: "!", incorrect: "×", pending: "?", unanswered: "—" };

/** Portals hydrate only the selected local-marked rows; the whole shelf stays server HTML. */
export function VocabularyRecall({ containerRef, statuses, meaningsFor, onActiveChange, onBegin }: Props) {
  const [session, setSession] = useState<RecallSession | null>(null);
  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [notice, setNotice] = useState("");
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeButtons = useRef<Partial<Record<RecallMode, HTMLButtonElement>>>({});
  const answerInputs = useRef(new Map<string, HTMLInputElement>());
  const dispatch = (action: RecallAction) => setSession((current) => current ? reduceRecall(current, action) : current);

  const checkAndAdvance = (id: string) => {
    if (!session || exiting) return;
    const checked = reduceRecall(session, { type: "check", id });
    setSession(checked);
    const nextId = nextUnansweredRecallId(checked, id);
    // Focus synchronously: mode switches, retries and exit cannot leave a queued callback.
    if (nextId) answerInputs.current.get(nextId)?.focus();
  };

  const begin = (mode: RecallMode) => {
    if (session) { dispatch({ type: "switch", mode }); return; }
    let skipped = 0;
    const next: Target[] = [];
    for (const tile of containerRef.current?.querySelectorAll<HTMLElement>(".vocabulary-study__word[data-word-key]") ?? []) {
      const key = tile.dataset.wordKey ?? "";
      if (statuses[key] !== "familiar") continue;
      const meanings = meaningsFor(key).filter((meaning) => meaning.trim());
      const row = tile.parentElement;
      if (!meanings.length || !row) { skipped += 1; continue; }
      const item = { id: `recall-${next.length + 1}`, markKey: key, word: tile.dataset.word ?? "", meanings };
      next.push({ item, tile, row });
    }
    if (!next.length) {
      setNotice(skipped ? "已知词暂缺释义，补齐后才能默写。" : "当前词表还没有可练习的已知词，先把认识的词标为已知。");
      return;
    }
    onBegin();
    setTargets(next);
    setSession(startRecall(next.map((target) => target.item), mode));
    setNotice(skipped ? `已跳过 ${skipped} 个缺释义的已知词。` : "");
    onActiveChange(true);
  };

  const exit = () => {
    const mode = session?.mode ?? "word";
    const finish = () => {
      exitTimer.current = null;
      setSession(null);
      setTargets([]);
      setNotice("");
      setExiting(false);
      onActiveChange(false);
      modeButtons.current[mode]?.focus();
    };
    if (typeof window.matchMedia !== "function" || prefersReducedMotion()) finish();
    else {
      setExiting(true);
      exitTimer.current = setTimeout(finish, 460);
    }
  };

  useEffect(() => () => { if (exitTimer.current !== null) clearTimeout(exitTimer.current); }, []);

  const activeIds = session?.rounds[session.mode].ids;
  useLayoutEffect(() => {
    if (!activeIds) return;
    const ids = new Set(activeIds);
    const changed = targets.filter((target) => ids.has(target.item.id));
    const previous = changed.map((target) => target.tile.hidden);
    for (const target of changed) target.tile.hidden = true;
    return () => { changed.forEach((target, index) => { target.tile.hidden = previous[index]!; }); };
  }, [activeIds, targets]);

  const summary = session ? summarizeRecall(session) : null;
  const round = session?.rounds[session.mode];
  const ids = new Set(round?.ids);
  return <div className="vocabulary-recall" aria-label="词汇默写">
    <div className="vocabulary-recall__toolbar">
      <div className="vocabulary-recall__modes" role="group" aria-label="默写模式">
        {modes.map(([mode, label]) => <button
          key={mode} type="button" aria-pressed={session?.mode === mode} disabled={exiting}
          ref={(node) => { if (node) modeButtons.current[mode] = node; }}
          onClick={() => begin(mode)}
        >{label}</button>)}
      </div>
      {session && summary ? <div className="vocabulary-recall__actions">
        <button type="button" disabled={exiting} onClick={() => dispatch({ type: "check" })}>批改</button>
        <button type="button" disabled={exiting || !summary.checked || !summary.retry} onClick={() => dispatch({ type: "retry" })}>重练错词</button>
        <button type="button" disabled={exiting} onClick={exit}>退出默写</button>
      </div> : null}
    </div>
    {session && summary ? <>
      <p className="vocabulary-recall__help">本次 {summary.total} 个已知词 · {session.mode === "word" ? "按词表词形填写。" : "写出一个正确含义即可；未匹配的说法请对照释义确认。"} Enter 检查后跳到下一空位；空答案或待确认时留在当前词。退出或刷新后清空本次练习。</p>
      {summary.checked ? <p className="vocabulary-recall__summary" role="status">
        独立匹配 {summary.correct} · 自行确认 {summary.selfConfirmed} · 需复习 {summary.review} · 待确认 {summary.pending} · 未作答 {summary.unanswered} · 使用提示 {summary.hinted}
      </p> : null}
    </> : null}
    {notice ? <p className="vocabulary-recall__help" role="status">{notice}</p> : null}
    {session && round ? targets.filter((target) => ids.has(target.item.id)).map(({ item, row }, index) => {
      const answer = round.answers[item.id]!;
      const label = session.mode === "word" ? `第 ${index + 1} 个词的西语答案` : `${item.word} 的中文释义`;
      const reference = session.mode === "word" ? item.word : item.meanings.join("；");
      const showReference = answer.revealed || (answer.result !== null && answer.result !== "correct");
      const celebrate = answer.result === "correct" && !answer.hinted && !answer.selfConfirmed;
      const resultLabel = answer.selfConfirmed ? (answer.result === "correct" ? "自行确认正确" : "自行标为需复习")
        : celebrate ? "答对了！" : answer.result ? resultLabels[answer.result] : "";
      return createPortal(<div className="vocabulary-recall__item" data-result={answer.result ?? ""}>
        {session.mode === "meaning" ? <strong lang="es">{item.word}</strong> : null}
        <div key={`${session.mode}:${round.generation}`} className={`vocabulary-recall__roller${exiting ? " is-exiting" : ""}`}>
          <span className="vocabulary-recall__roller-front" aria-hidden="true" lang={session.mode === "word" ? "es" : "zh-CN"}>
            {session.mode === "word" ? item.word : item.meanings[0]}
          </span>
          <input className="vocabulary-recall__roller-back"
          ref={(node) => { if (node) answerInputs.current.set(item.id, node); else answerInputs.current.delete(item.id); }}
          aria-label={label} aria-describedby={`${item.id}-feedback`}
          aria-invalid={answer.result === "incorrect" || answer.result === "accent" ? true : undefined}
          lang={session.mode === "word" ? "es" : "zh-CN"}
          value={answer.value} maxLength={200} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
          disabled={exiting}
          placeholder={session.mode === "word" ? "填写西语单词" : "填写中文释义"}
          onChange={(event) => dispatch({ type: "input", id: item.id, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              checkAndAdvance(item.id);
            }
          }}
        />
        </div>
        {session.mode === "word" ? <span className="vocabulary-recall__cue">{item.meanings.join("；")}</span> : null}
        <div id={`${item.id}-feedback`} className="vocabulary-recall__feedback" aria-live="polite">
          {answer.result ? <span className={`vocabulary-recall__result${celebrate ? " is-celebrating" : ""}`}>
            <span className="vocabulary-recall__result-icon" aria-hidden="true">{resultIcons[answer.result]}</span>
            <span className="vocabulary-recall__result-label">{resultLabel}</span>
            {celebrate ? <svg className="vocabulary-recall__sparkles" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="m9 2 2.2 6.8L18 11l-6.8 2.2L9 20l-2.2-6.8L0 11l6.8-2.2L9 2Zm11 0 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Zm0 13 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
            </svg> : null}
          </span> : null}
          {answer.hinted ? <span>已使用提示</span> : null}
          {showReference ? <span className="vocabulary-recall__reference">参考：<span lang={session.mode === "word" ? "es" : "zh-CN"}>{answer.result === "accent"
            ? Array.from(reference.normalize("NFC")).map((character, characterIndex) => /[áéíóú]/iu.test(character) ? <mark key={characterIndex}>{character}</mark> : character)
            : reference}</span></span> : null}
        </div>
        <div className="vocabulary-recall__item-actions">
          {!showReference ? <button type="button" disabled={exiting} onClick={() => dispatch({ type: "reveal", id: item.id })}>查看答案</button> : null}
          {answer.result === "pending" ? <>
            <button type="button" disabled={exiting} onClick={() => dispatch({ type: "confirm", id: item.id, correct: true })}>我的意思正确</button>
            <button type="button" disabled={exiting} onClick={() => dispatch({ type: "confirm", id: item.id, correct: false })}>需要复习</button>
          </> : null}
        </div>
      </div>, row, item.id);
    }) : null}
  </div>;
}
