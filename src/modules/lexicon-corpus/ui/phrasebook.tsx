"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { phrasebookEntries } from "../content/phrasebook-v3";
import { matchesPhrasebookSearch, phraseTopics, type PhrasebookEntry, type PhraseTopic } from "../domain/phrasebook";
import { useReadAloud } from "@/src/modules/providers/tts/use-read-aloud";

function Icon({ name }: Readonly<{ name: "sound" | "bookmark" | "arrow" | "search" | "eye" | "close" }>) {
  const paths: Record<typeof name, ReactNode> = {
    sound: <><path d="m11 5-6 4H2v6h3l6 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
    arrow: <path d="m5 12 14 0m-6-6 6 6-6 6" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const savedEvent = "sueno:phrasebook-saved";
const subscribeSaved = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(savedEvent, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(savedEvent, listener); };
};

function useSavedPhrases(userId: string) {
  const key = `sueno:phrasebook:v1:${userId}`;
  const snapshot = useCallback(() => { try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; } }, [key]);
  const raw = useSyncExternalStore(subscribeSaved, snapshot, () => "[]");
  const saved = useMemo((): string[] => {
    try {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && phrasebookEntries.some((entry) => entry.id === id)) : [];
    } catch { return []; }
  }, [raw]);
  const toggle = (id: string) => {
    try {
      localStorage.setItem(key, JSON.stringify(saved.includes(id) ? saved.filter((value) => value !== id) : [...saved, id]));
      window.dispatchEvent(new Event(savedEvent));
      return true;
    } catch { return false; }
  };
  return { saved, toggle };
}

function PhraseDetails({ entry, renderSpeechButton }: Readonly<{ entry: PhrasebookEntry; renderSpeechButton: (id: string, text: string, label: string) => ReactNode }>) {
  return <div className="phrasebook-detail" id={`detail-${entry.id}`}>
    <div className="phrasebook-detail__dialogue">
      <h4>放进对话里</h4>
      <p className="phrasebook-detail__situation">{entry.situation}</p>
      <ol>{entry.dialogue.map((line, index) => <li key={line.es}>
        <span className="phrasebook-detail__speaker" aria-label={index ? "乙" : "甲"}>{index ? "B" : "A"}</span>
        <div className="phrasebook-detail__turn"><div className="phrasebook-detail__spoken"><p lang="es">{line.es}</p>{renderSpeechButton(`dialogue:${entry.id}:${index}`, line.es, `对话第${index + 1}句`)}</div><p>{line.zh}</p></div>
      </li>)}</ol>
      <p className="phrasebook-detail__example-note">原创情境示例</p>
    </div>
    <div className="phrasebook-detail__usage">
      <h4>用得自然一点</h4><p>{entry.note}</p>
      <h4>换成自己的话</h4><p className="phrasebook-detail__pattern" lang="es">{entry.pattern}</p>
      <p lang="es">{entry.replacement.es}</p><p className="phrasebook-detail__translation">{entry.replacement.zh}</p>
      <details><summary>也可以这样说</summary>{entry.alternatives.map((line) => <div className="phrasebook-detail__alternative" key={line.es}><p lang="es">{line.es}</p><p>{line.zh}</p></div>)}</details>
    </div>
  </div>;
}

type Practice = { entries: PhrasebookEntry[]; index: number; revealed: boolean; revisit: string[] };

export function Phrasebook({ userId, initialSearch = "" }: Readonly<{ userId: string; initialSearch?: string }>) {
  const [topic, setTopic] = useState<PhraseTopic | "all" | "saved">("all");
  const [search, setSearch] = useState(initialSearch);
  const [hideSpanish, setHideSpanish] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(phrasebookEntries[0].id);
  const [message, setMessage] = useState("");
  const [practice, setPractice] = useState<Practice | null>(null);
  const { saved, toggle } = useSavedPhrases(userId);
  const speech = useReadAloud();
  const { speakingId, stop } = speech;
  const practiceTitle = useRef<HTMLHeadingElement>(null);
  const practiceButton = useRef<HTMLButtonElement>(null);
  const wasPracticing = useRef(false);
  const practiceIndex = practice?.index;
  useEffect(() => {
    if (practiceIndex !== undefined) {
      practiceTitle.current?.focus({ preventScroll: true });
      wasPracticing.current = true;
    } else if (wasPracticing.current) {
      practiceButton.current?.focus({ preventScroll: true });
      wasPracticing.current = false;
    }
  }, [practiceIndex]);

  const visible = phrasebookEntries.filter((entry) => (topic === "all" || (topic === "saved" ? saved.includes(entry.id) : entry.topic === topic)) && matchesPhrasebookSearch(entry, search));
  const activeTopic = phraseTopics.find((item) => item.id === topic);
  const speakingEntryIsVisible = visible.some((entry) => speech.speakingId === entry.id || speech.speakingId?.startsWith(`dialogue:${entry.id}:`));
  useEffect(() => {
    if (!practice && speakingId && !speakingEntryIsVisible) stop();
  }, [practice, speakingEntryIsVisible, speakingId, stop]);

  function reset() { speech.stop(); setTopic("all"); setSearch(""); setRevealed([]); }
  function changeTopic(value: typeof topic) { speech.stop(); setTopic(value); setPractice(null); setRevealed([]); }
  function readText(id: string, text: string) {
    if (speech.speakingId === id) { speech.stop(); return; }
    setMessage("");
    speech.speak(id, text, () => setMessage("当前浏览器不支持朗读，你仍可以查看对话和用法。"));
  }
  function read(entry: PhrasebookEntry) { readText(entry.id, entry.expression); }
  function speechButton(id: string, text: string, label: string) {
    const speaking = speech.speakingId === id;
    return <button className="phrasebook-speak" type="button" aria-label={`${speaking ? "停止朗读" : "朗读"}${label}`} aria-pressed={speaking} onClick={() => readText(id, text)}><Icon name="sound" />{speaking ? "停止" : "朗读"}</button>;
  }
  function practiceSpeechButton(entry: PhrasebookEntry, kind: "reference" | "core") {
    const id = `practice-${kind}:${entry.id}`;
    const label = kind === "reference" ? "参考表达" : "核心表达";
    return speechButton(id, kind === "reference" ? entry.replacement.es : entry.expression, label);
  }
  function startPractice() {
    speech.stop();
    // Sample up to five of the currently visible entries, without duplicates.
    const entries = [...visible];
    for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
    setPractice({ entries: entries.slice(0, 5), index: 0, revealed: false, revisit: [] });
  }
  function closePractice() { speech.stop(); setPractice(null); }
  function nextPractice(revisit: boolean) {
    if (!practice) return;
    speech.stop();
    setPractice({ ...practice, index: practice.index + 1, revealed: false, revisit: revisit ? [...practice.revisit, practice.entries[practice.index].id] : practice.revisit });
  }

  return <section className="phrasebook" aria-label="实用短语手册">
    <header className="phrasebook-header">
      <div><p className="phrasebook-eyebrow">PALABRAS QUE CONECTAN</p><div className="phrasebook-header__title"><h1>短语</h1><p>让想说的话，顺口说出来。</p></div><p>不只记住意思，也知道什么时候说、怎么接下去。</p></div>
      <div className="phrasebook-header__stamp"><strong>{phrasebookEntries.length}</strong><span>实用表达<br />{phraseTopics.length} 个日常交际主题</span></div>
    </header>
    <div className="phrasebook-workspace">
      <aside className="phrasebook-sidebar">
        <p className="phrasebook-sidebar__label">你想表达什么？</p>
        <nav aria-label="短语交际主题">
          <button type="button" aria-pressed={topic === "all"} onClick={() => changeTopic("all")}><span>全部表达</span><span>{phrasebookEntries.length}</span></button>
          {phraseTopics.map((item, index) => <button type="button" aria-pressed={topic === item.id} onClick={() => changeTopic(item.id)} key={item.id}><span><small>{String(index + 1).padStart(2, "0")}</small>{item.title}</span><span>{phrasebookEntries.filter((entry) => entry.topic === item.id).length}</span></button>)}
          <button className="phrasebook-sidebar__saved" type="button" aria-pressed={topic === "saved"} onClick={() => changeTopic("saved")}><span><Icon name="bookmark" />我的收藏</span><span>{saved.length}</span></button>
        </nav>
        <div className="phrasebook-sidebar__note"><span>从看懂，到会用</span><p>先读一段对话，再遮住西语。下次遇到类似场景，试着用一句。</p><p>以西班牙日常用语为主；地区和语气差异见用法提示。</p></div>
      </aside>
      <div className="phrasebook-main">
        <div className="phrasebook-toolbar">
          <label className="phrasebook-search"><Icon name="search" /><span className="sr-only">搜索短语</span><input type="search" value={search} maxLength={120} placeholder="搜西语、中文，或你想说的事…" onChange={(event) => { speech.stop(); setSearch(event.target.value); }} />{search ? <button type="button" aria-label="清空搜索" onClick={() => setSearch("")}><Icon name="close" /></button> : null}</label>
          <button className="phrasebook-primary" type="button" ref={practiceButton} disabled={!visible.length || Boolean(practice)} onClick={startPractice}>情境自测<Icon name="arrow" /></button>
        </div>
        <div className="phrasebook-feedback" role="status" aria-live="polite">{message || speech.errorMessage}</div>
        {practice ? <section className="phrasebook-practice" aria-label="情境自测" onKeyDown={(event) => { if (event.key === "Escape") closePractice(); }}>
          <div className="phrasebook-practice__top"><span>想一想，你会怎么说？</span><button type="button" onClick={closePractice}>退出自测<Icon name="close" /></button></div>
          {practice.index < practice.entries.length ? <div key={practice.index}>
            <p className="phrasebook-eyebrow">{String(practice.index + 1).padStart(2, "0")} / {String(practice.entries.length).padStart(2, "0")}</p>
            <h2 tabIndex={-1} ref={practiceTitle}>{practice.entries[practice.index].prompt}</h2>
            <p className="phrasebook-practice__hint">在心里组织一句，或轻声说出来。无需录音，也不用照着标准句回答。</p>
            {practice.revealed ? <div className="phrasebook-practice__answer"><div className="phrasebook-practice__answer-label"><span>一种自然的说法</span>{practiceSpeechButton(practice.entries[practice.index], "reference")}</div><p lang="es">{practice.entries[practice.index].replacement.es}</p><p>{practice.entries[practice.index].replacement.zh}</p><details onToggle={(event) => { if (!event.currentTarget.open && speech.speakingId === `practice-core:${practice.entries[practice.index].id}`) speech.stop(); }}><summary>回看本条核心表达与用法</summary><div className="phrasebook-practice__spoken"><p lang="es">{practice.entries[practice.index].expression}</p>{practiceSpeechButton(practice.entries[practice.index], "core")}</div><p>{practice.entries[practice.index].note}</p></details></div> : <button className="phrasebook-primary" type="button" onClick={() => setPractice({ ...practice, revealed: true })}>查看参考表达<Icon name="eye" /></button>}
            {practice.revealed ? <div className="phrasebook-practice__actions"><button type="button" onClick={() => nextPractice(true)}>还想再练</button><button className="phrasebook-primary" type="button" onClick={() => nextPractice(false)}>想到说法了<Icon name="arrow" /></button></div> : null}
          </div> : <div className="phrasebook-practice__complete"><p className="phrasebook-eyebrow">HASTA LA PRÓXIMA</p><h2 ref={practiceTitle} tabIndex={-1}>给表达一个真实的使用机会</h2><p>这一轮回想了 {practice.entries.length} 个情境。{practice.revisit.length ? `你想再练其中 ${practice.revisit.length} 条。` : "下次聊天时，试着用上其中一句。"}</p>{practice.revisit.length ? <button className="phrasebook-primary" type="button" onClick={() => setPractice({ entries: practice.entries.filter((entry) => practice.revisit.includes(entry.id)), index: 0, revealed: false, revisit: [] })}>再练刚才的表达<Icon name="arrow" /></button> : null}<button type="button" onClick={closePractice}>返回表达库</button></div>}
          <p className="phrasebook-practice__disclaimer">这是自我回想，不计入能力评分；自然的其他说法同样可以。</p>
        </section> : <>
          <div className="phrasebook-results"><p><strong>{topic === "saved" ? "我的收藏" : activeTopic?.title ?? "全部表达"}</strong><span>{visible.length} 条{activeTopic ? ` · ${activeTopic.description}` : " · 为真实交流准备"}</span></p><button type="button" aria-pressed={hideSpanish} onClick={() => { speech.stop(); setHideSpanish(!hideSpanish); setRevealed([]); }}><Icon name="eye" />{hideSpanish ? "显示西语" : "遮住西语"}</button></div>
          {!visible.length ? <div className="phrasebook-empty"><Icon name={topic === "saved" && !search ? "bookmark" : "search"} /><h2>{topic === "saved" && !search ? "把想用的表达留在这里" : "换个说法试试"}</h2><p>{topic === "saved" && !search ? "点一下表达旁的书签，就能收进自己的口语备忘录。" : "试试“没听懂”“约时间”，或直接搜索西语。也可以清除当前筛选。"}</p><button className="phrasebook-primary" type="button" onClick={reset}>查看全部表达<Icon name="arrow" /></button></div> : phraseTopics.map((group, groupIndex) => {
            const entries = visible.filter((entry) => entry.topic === group.id);
            if (!entries.length) return null;
            return <section className="phrasebook-group" key={group.id} aria-label={group.title}>
              <div className="phrasebook-group__heading"><span>{String(groupIndex + 1).padStart(2, "0")}</span><h2>{group.label}</h2><span>{group.description}</span></div>
              <div className="phrasebook-entries">{entries.map((entry) => {
                const hidden = hideSpanish && !revealed.includes(entry.id);
                const open = expanded === entry.id && !hidden;
                return <article className="phrasebook-entry" key={entry.id} data-open={open}>
                  <div className="phrasebook-entry__row">
                    <div className="phrasebook-entry__body">{hidden ? <><p className="phrasebook-entry__recall">{entry.meaning}</p><button className="phrasebook-entry__reveal" type="button" onClick={() => setRevealed([...revealed, entry.id])}>揭晓表达<Icon name="eye" /></button></> : <><h3 lang="es"><button type="button" aria-expanded={open} aria-controls={open ? `detail-${entry.id}` : undefined} onClick={() => { speech.stop(); setExpanded(open ? null : entry.id); }}>{entry.expression}</button></h3><p>{entry.meaning}</p></>}</div>
                    <div className="phrasebook-entry__actions">{!hidden ? <button type="button" aria-label={`${speech.speakingId === entry.id ? "停止朗读" : "朗读"} ${entry.expression}`} aria-pressed={speech.speakingId === entry.id} onClick={() => read(entry)}><Icon name="sound" /></button> : null}<button type="button" aria-label={`${saved.includes(entry.id) ? "取消收藏" : "收藏"} ${hidden ? entry.meaning : entry.expression}`} aria-pressed={saved.includes(entry.id)} onClick={() => { setMessage(toggle(entry.id) ? saved.includes(entry.id) ? "已移出收藏。" : "已收藏，保存在当前浏览器。" : "当前浏览器无法保存收藏，请检查存储设置后重试。"); }}><Icon name="bookmark" /></button></div>
                    <div className="phrasebook-entry__meta"><span>{entry.register}</span><span>{entry.level}</span>{!hidden ? <button type="button" aria-expanded={open} aria-controls={open ? `detail-${entry.id}` : undefined} onClick={() => { speech.stop(); setExpanded(open ? null : entry.id); }}>{open ? "收起" : "怎么用"}<span aria-hidden="true">{open ? "−" : "+"}</span></button> : null}</div>
                  </div>
                  {open ? <PhraseDetails entry={entry} renderSpeechButton={speechButton} /> : null}
                </article>;
              })}</div>
            </section>;
          })}
        </>}
        <footer className="phrasebook-footer"><span>少记一点，用好一点。</span><p>收藏仅保存在当前浏览器，按账号区分，不会同步到其他设备。浏览、朗读与自测不改变能力评分。</p></footer>
      </div>
    </div>
  </section>;
}
