"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { findCommonGlossaryEntry } from "@/src/modules/reading/domain/common-glossary";
import { useReadAloud } from "@/src/modules/providers/tts/use-read-aloud";
import { requestWordLookup, type MediaWordDetails } from "./request-word-lookup";
import { requestWordExplanation, type MediaWordExplanation } from "./request-word-explanation";

type Props = Readonly<{ word: string; sentence: string; onClose: () => void; onBeforeRead?: () => void }>;

// A new selection owns new requests and speech; the old selection's cleanup runs
// even when a provider ignores cancellation and eventually returns a response.
export function LexicalDrawer(props: Props) {
  return <WordPanel key={JSON.stringify([props.word, props.sentence])} {...props} />;
}

function WordPanel({ word, sentence, onClose, onBeforeRead }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const reviewed = findCommonGlossaryEntry(word);
  const [details, setDetails] = useState<MediaWordDetails | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const [explanation, setExplanation] = useState<MediaWordExplanation | null>(null);
  const [explanationState, setExplanationState] = useState<"loading" | "ready" | "error">("loading");
  const [explanationRevision, setExplanationRevision] = useState(0);
  const [readPhase, setReadPhase] = useState<"preparing" | "playing" | null>(null);
  const [readNotice, setReadNotice] = useState("");
  const { speak, stop } = useReadAloud();

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (active) setLookupState("error");
      controller.abort();
    }, 20_000);
    void requestWordLookup(word, controller.signal).then((result) => {
      if (!active || controller.signal.aborted) return;
      setDetails(result);
      setLookupState(result ? "ready" : "missing");
    }).catch(() => {
      if (active && !controller.signal.aborted) setLookupState("error");
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [word, revision]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") { stop(); setReadPhase(null); }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      stop();
    };
  }, [stop]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (active) setExplanationState("error");
      controller.abort();
    }, 30_000);
    // Let synchronous cleanup (including StrictMode replay) cancel before fetch,
    // so a discarded selection never starts a second billable generation.
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return requestWordExplanation(word, sentence, controller.signal);
    }).then((result) => {
      if (!active || controller.signal.aborted) return;
      setExplanation(result); setExplanationState("ready");
    }).catch(() => {
      if (active && !controller.signal.aborted) setExplanationState("error");
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [word, sentence, explanationRevision]);

  function toggleRead() {
    if (readPhase) { stop(); setReadPhase(null); return; }
    onBeforeRead?.();
    setReadPhase("preparing"); setReadNotice("");
    speak("media-word", word, () => { setReadPhase(null); setReadNotice("当前浏览器不支持音频播放。"); }, {
      onStart: () => setReadPhase("playing"), onEnd: () => setReadPhase(null),
      onError: (message) => { setReadPhase(null); setReadNotice(message); },
    });
  }

  const meanings = details?.meanings.length ? details.meanings : reviewed?.meanings ?? [];
  const notes = details?.usageNotes ?? [];
  const forms = details?.forms.length ? details.forms : reviewed?.forms ?? [];
  const collocations = details?.collocations.length ? details.collocations : reviewed?.collocations ?? [];
  return <aside aria-labelledby="lexical-drawer-title" className="lexical-drawer" role="dialog">
    <div className="lexical-drawer__handle" aria-hidden="true" />
    <header><div><p className="eyebrow">当前词语</p><h2 id="lexical-drawer-title">词句上下文</h2></div>
      <button aria-label="关闭词句上下文" onClick={onClose} ref={closeRef} type="button">关闭</button></header>
    <div className="lexical-drawer__word"><strong lang="es">{word}</strong>
      <button type="button" title="合成音" onClick={toggleRead} aria-pressed={Boolean(readPhase)} aria-busy={readPhase === "preparing" || undefined}>{readPhase ? "停止朗读" : "朗读单词"}</button></div>
    {readPhase ? <p className="lexical-drawer__muted" role="status">{readPhase === "preparing" ? "正在准备合成音…" : "正在朗读 · 合成音"}</p> : null}
    {readNotice ? <p role="status">{readNotice}</p> : null}
    {reviewed && reviewed.headword.toLocaleLowerCase("es") !== word.toLocaleLowerCase("es") ? <p className="lexical-drawer__muted">词典原形：<b lang="es">{reviewed.headword}</b></p> : null}
    {(details?.partOfSpeech ?? reviewed?.partOfSpeech) ? <p className="lexical-drawer__muted">{details?.partOfSpeech ?? reviewed?.partOfSpeech}</p> : null}
    {meanings.length ? <ul className="lexical-drawer__meanings">{meanings.map((item) => <li key={item.meaning}><strong>{item.meaning}</strong>{item.usage ? <p>{item.usage}</p> : null}</li>)}</ul> : null}
    {lookupState === "loading" ? <p role="status" className="lexical-drawer__muted">正在查词…</p> : null}
    {lookupState === "error" ? <div role="status"><p>词典暂时不可用{meanings.length ? "，已保留词表释义。" : "，可以重试或查看语境解释。"}</p><button type="button" onClick={() => { setLookupState("loading"); setRevision((value) => value + 1); }}>重试查词</button></div> : null}
    {notes.length ? <section><h3>词表用法</h3>{notes.map((note) => <p key={note}>{note}</p>)}</section> : null}
    {collocations.length ? <section><h3>常用搭配</h3><p lang="es">{collocations.join(" · ")}</p></section> : null}
    {forms.length ? <details><summary>常见变位 / 形式</summary><p lang="es">{forms.join(" · ")}</p></details> : null}
    <section className="lexical-drawer__context"><h3>字幕原句</h3><p lang="es">{sentence}</p></section>
    <section>
      {explanationState === "loading" ? <p role="status">正在生成解析…</p> : null}
      {explanationState === "error" ? <p role="status">语境解释未完成，请重试。</p> : null}
      {explanationState === "error" ? <button type="button" onClick={() => { setExplanationState("loading"); setExplanationRevision((value) => value + 1); }}>重试语境解释</button> : null}
      {explanation ? <dl aria-label="AI 语境解释" aria-live="polite" className="media-word-explanation"><dt>这句中的含义</dt><dd>{explanation.contextualMeaning}</dd><dt>词义</dt><dd>{explanation.meaning}</dd><dt>例句 · AI 生成</dt><dd lang="es">{explanation.example}</dd></dl> : null}
    </section>
    <Link href={`/read/corpus?q=${encodeURIComponent(word)}&match=surface`} target="_blank" rel="noopener noreferrer">查看语料用法</Link>
  </aside>;
}
