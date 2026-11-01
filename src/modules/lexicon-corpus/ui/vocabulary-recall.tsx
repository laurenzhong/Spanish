"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "@/src/shared/ui/motion";
import { Button, Input, ToggleGroup, ToggleGroupItem } from "@/src/shared/ui/primitives";

import {
  nextUnansweredRecallId, reduceRecall, startRecall, summarizeRecall,
  type RecallAction, type RecallItem, type RecallMode, type RecallSession,
} from "../domain/vocabulary-recall";
import type { VocabularyShelfStatus } from "./vocabulary-shelf";
import { selectRecallKeys, summarizeRecallQueue, type RecallQueue } from "../domain/vocabulary-recall-queue";
import { useVocabularyRecallProgress, type VocabularyRecallProgressEntry } from "./use-vocabulary-recall-progress";

type Target = Readonly<{ item: RecallItem; tile: HTMLElement; row: HTMLElement }>;
type Props = Readonly<{
  storageScope: string;
  marksReady: boolean;
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
export function VocabularyRecall({ storageScope, marksReady, containerRef, statuses, meaningsFor, onActiveChange, onBegin }: Props) {
  const progress = useVocabularyRecallProgress(storageScope);
  const [queue, setQueue] = useState<RecallQueue>("learning");
  const [batchSize, setBatchSize] = useState(10);
  const [now, setNow] = useState(() => Date.now());
  const [session, setSession] = useState<RecallSession | null>(null);
  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [notice, setNotice] = useState("");
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeButtons = useRef<Partial<Record<RecallMode, HTMLButtonElement>>>({});
  const answerInputs = useRef(new Map<string, HTMLInputElement>());
  const revisions = useRef(new Map<string, number>());
  const submitted = useRef(new Map<string, string>());
  const epoch = useRef<string | null>(null);
  const saving = useRef(false);
  const busy = exiting || progress.pending || progress.loading || Boolean(progress.error);
  const progressKey = (word: string, mode: RecallMode) => JSON.stringify([word, mode]);

  useEffect(() => {
    for (const entry of progress.lastSavedEntries) revisions.current.set(progressKey(entry.word, entry.mode), entry.expectedRevision + 1);
  }, [progress.acknowledgedAttemptId, progress.lastSavedEntries]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const persist = (next: RecallSession, onlyId?: string) => {
    const round = next.rounds[next.mode];
    const entries: VocabularyRecallProgressEntry[] = [];
    for (const item of next.items) {
      if (!round.ids.includes(item.id) || (onlyId && item.id !== onlyId)) continue;
      const answer = round.answers[item.id]!;
      if (!answer.result || answer.result === "unanswered") continue;
      const key = progressKey(item.markKey, next.mode);
      const signature = JSON.stringify([answer.result, answer.hinted, answer.selfConfirmed]);
      if (submitted.current.get(key) === signature) continue;
      entries.push({ word: item.markKey, mode: next.mode, result: answer.result, hinted: answer.hinted, selfConfirmed: answer.selfConfirmed, expectedRevision: revisions.current.get(key) ?? 0 });
      submitted.current.set(key, signature);
    }
    if (entries.length && epoch.current) {
      saving.current = true;
      void progress.save(entries, epoch.current).finally(() => { saving.current = false; });
    }
  };
  const dispatch = (action: RecallAction) => {
    if (!session || busy || saving.current) return;
    const next = reduceRecall(session, action);
    setSession(next);
    if (action.type === "check" || action.type === "confirm" || action.type === "reveal") persist(next, "id" in action ? action.id : undefined);
  };

  const checkAndAdvance = (id: string) => {
    if (!session || busy || saving.current) return;
    const checked = reduceRecall(session, { type: "check", id });
    setSession(checked);
    const nextId = nextUnansweredRecallId(checked, id);
    // Focus synchronously: mode switches, retries and exit cannot leave a queued callback.
    if (nextId) answerInputs.current.get(nextId)?.focus();
    persist(checked, id);
  };

  const begin = (mode: RecallMode) => {
    if (busy || saving.current || !marksReady) return;
    if (session) { dispatch({ type: "switch", mode }); return; }
    let skipped = 0;
    const next: Target[] = [];
    for (const tile of containerRef.current?.querySelectorAll<HTMLElement>(".vocabulary-study__word[data-word-key]") ?? []) {
      const key = tile.dataset.wordKey ?? "";
      if (statuses[key] !== "familiar") continue;
      const meanings = meaningsFor(key).filter((meaning) => meaning.trim());
      const row = tile.parentElement;
      if (!meanings.length || !row) { skipped += 1; continue; }
      if (next.some((target) => target.item.markKey === key)) continue;
      const item = { id: `recall-${next.length + 1}`, markKey: key, word: tile.dataset.word ?? "", meanings };
      next.push({ item, tile, row });
    }
    if (!next.length) {
      setNotice(skipped ? "已知词暂缺释义，补齐后才能默写。" : "当前词表还没有可练习的已知词，先把认识的词标为已知。");
      return;
    }
    const keys = next.map((target) => target.item.markKey);
    const selected = {
      word: selectRecallKeys(keys, progress.progress, "word", queue, batchSize, Date.now()),
      meaning: selectRecallKeys(keys, progress.progress, "meaning", queue, batchSize, Date.now()),
    };
    if (!selected[mode].length) {
      setNotice(queue === "review" ? "当前没有到期的复习词。想提前练习可选“全部自测”。" : "当前词表的首次待练已完成，已通过的词会在到期后进入复习。");
      return;
    }
    onBegin();
    const selectedTargets = next.filter((target) => selected.word.includes(target.item.markKey) || selected.meaning.includes(target.item.markKey));
    revisions.current = new Map(progress.progress.map((item) => [progressKey(item.word, item.mode), item.revision]));
    submitted.current.clear();
    epoch.current = progress.epoch;
    setTargets(selectedTargets);
    setSession(startRecall(selectedTargets.map((target) => target.item), mode, selected));
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
  const markedKeys = Object.keys(statuses).filter((key) => statuses[key] === "familiar" && meaningsFor(key).length > 0);
  const counts = { word: summarizeRecallQueue(markedKeys, progress.progress, "word", now), meaning: summarizeRecallQueue(markedKeys, progress.progress, "meaning", now) };
  return <div className="vocabulary-recall" aria-label="词汇默写">
    {!session ? <div className="vocabulary-recall__toolbar">
      <div role="group" aria-label="练习范围"><ToggleGroup value={queue} onValueChange={(value) => { if (value === "learning" || value === "review" || value === "all") { setQueue(value); setNotice(""); } }}>
        <ToggleGroupItem value="learning">首次待练</ToggleGroupItem>
        <ToggleGroupItem value="review">到期复习</ToggleGroupItem>
        <ToggleGroupItem value="all">全部自测</ToggleGroupItem>
      </ToggleGroup></div>
      <div role="group" aria-label="每组词数"><ToggleGroup value={String(batchSize)} onValueChange={(value) => { if (value === "10" || value === "20") setBatchSize(Number(value)); }}>
        <ToggleGroupItem value="10">10 个</ToggleGroupItem>
        <ToggleGroupItem value="20">20 个</ToggleGroupItem>
      </ToggleGroup></div>
    </div> : null}
    <div className="vocabulary-recall__toolbar">
      <div role="group" aria-label="默写模式"><ToggleGroup className="vocabulary-recall__modes" value={session?.mode} onValueChange={(value) => { if (value === "word" || value === "meaning") begin(value); }}>
        {modes.map(([mode, label]) => <ToggleGroupItem
          key={mode} value={mode} type="button" disabled={busy || !marksReady}
          ref={(node) => { if (node) modeButtons.current[mode] = node; }}
        >{label}</ToggleGroupItem>)}
      </ToggleGroup></div>
      {session && summary ? <div className="vocabulary-recall__actions">
        <Button size="sm" type="button" disabled={busy} onClick={() => dispatch({ type: "check" })}>批改</Button>
        <Button size="sm" variant="secondary" type="button" disabled={busy || !summary.checked || !summary.retry} onClick={() => dispatch({ type: "retry" })}>重练错词</Button>
        <Button size="sm" variant="quiet" type="button" disabled={exiting || progress.pending} onClick={exit}>退出默写</Button>
      </div> : null}
    </div>
    {!progress.loading && !progress.error ? <p className="vocabulary-recall__help" aria-label="账号默写进度">
      写单词：首次待练 {counts.word.learning} · 复习 {counts.word.review}（到期 {counts.word.due}）；写释义：首次待练 {counts.meaning.learning} · 复习 {counts.meaning.review}（到期 {counts.meaning.due}）
    </p> : null}
    {progress.loading ? <p className="vocabulary-recall__help" role="status">正在读取默写进度…</p> : null}
    {progress.pending ? <p className="vocabulary-recall__help" role="status">正在保存默写进度…</p> : null}
    {progress.error ? <div className="vocabulary-recall__help" role="alert">{progress.error}
      <Button size="sm" disabled={progress.pending || (progress.conflict && Boolean(session))} onClick={progress.retry}>重试同步</Button>
    </div> : null}
    {session && summary ? <>
      <p className="vocabulary-recall__help">本次 {summary.total} 个已知词 · {session.mode === "word" ? "按词表词形填写。" : "写出一个正确含义即可；未匹配的说法请对照释义确认。"} Enter 检查后跳到下一空位；空答案或待确认时留在当前词。独立答对转入复习，已保存进度退出后保留。看过答案的词本轮继续练习。</p>
      {!summary.total ? <p className="vocabulary-recall__help">这个方向当前没有待练词，请退出后选择其他练习范围。</p> : null}
      {summary.checked ? <p className="vocabulary-recall__summary" role="status">
        独立匹配 {summary.correct} · 自行确认 {summary.selfConfirmed} · 需复习 {summary.review} · 待确认 {summary.pending} · 未作答 {summary.unanswered} · 使用提示 {summary.hinted}
      </p> : null}
    </> : null}
    {notice ? <p className="vocabulary-recall__help" role="status">{notice}</p> : null}
    {session && round ? targets.filter((target) => ids.has(target.item.id)).map(({ item, row }, index) => {
      const answer = round.answers[item.id]!;
      const label = session.mode === "word" ? `第 ${index + 1} 个词的西语答案` : `${item.word} 的中文释义`;
      const reference = session.mode === "word" ? item.word : item.meanings.join("；");
      const showReference = answer.revealed || (answer.result !== null && answer.result !== "correct" && answer.result !== "unanswered");
      const celebrate = answer.result === "correct" && !answer.hinted && !answer.selfConfirmed;
      const resultLabel = answer.selfConfirmed ? (answer.result === "correct" ? "自行确认正确" : "自行标为需复习")
        : celebrate ? "答对了！" : answer.result ? resultLabels[answer.result] : "";
      return createPortal(<div className="vocabulary-recall__item" data-result={answer.result ?? ""}>
        {session.mode === "meaning" ? <strong lang="es">{item.word}</strong> : null}
        <div key={`${session.mode}:${round.generation}`} className={`vocabulary-recall__roller${exiting ? " is-exiting" : ""}`}>
          <span className="vocabulary-recall__roller-front" aria-hidden="true" lang={session.mode === "word" ? "es" : "zh-CN"}>
            {session.mode === "word" ? item.word : item.meanings[0]}
          </span>
          <Input className="vocabulary-recall__roller-back"
          ref={(node) => { if (node) answerInputs.current.set(item.id, node); else answerInputs.current.delete(item.id); }}
          aria-label={label} aria-describedby={`${item.id}-feedback`}
          aria-invalid={answer.result === "incorrect" || answer.result === "accent" ? true : undefined}
          lang={session.mode === "word" ? "es" : "zh-CN"}
          value={answer.value} maxLength={200} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
          readOnly={busy}
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
          {!showReference && answer.result !== "correct" ? <Button size="sm" type="button" disabled={busy} onClick={() => dispatch({ type: "reveal", id: item.id })}>查看答案</Button> : null}
          {answer.result === "pending" ? <>
            <Button size="sm" type="button" disabled={busy} onClick={() => dispatch({ type: "confirm", id: item.id, correct: true })}>我的意思正确</Button>
            <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => dispatch({ type: "confirm", id: item.id, correct: false })}>需要复习</Button>
          </> : null}
        </div>
      </div>, row, item.id);
    }) : null}
  </div>;
}
