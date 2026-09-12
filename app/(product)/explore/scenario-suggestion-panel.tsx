"use client";

import { useRef, useState } from "react";

import { scenarioSuggestionResponseSchema, type ScenarioSuggestionResponse } from "@/src/modules/explore/schemas/scenario-suggestion";
import type { ScenarioSuggestionMode } from "@/src/modules/explore/domain/scenario-suggestion";
import { PersonalScenarioGenerator } from "./personal-scenario-generator";

type SuggestionData = ScenarioSuggestionResponse["data"];

const choices: readonly Readonly<{
  mode: ScenarioSuggestionMode;
  title: string;
  icon: "target" | "compass" | "shuffle";
}>[] = [
  { mode: "best_fit", title: "适合我的", icon: "target" },
  { mode: "discover", title: "探索新场景", icon: "compass" },
  { mode: "random", title: "随机来一个", icon: "shuffle" },
];

function ChoiceIcon({ name }: Readonly<{ name: (typeof choices)[number]["icon"] }>) {
  if (name === "target") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M22 12h-3" /></svg>;
  if (name === "compass") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h2.5c4 0 6.5 10 10.5 10h3M17 4l3 3-3 3M4 17h2.5c1.2 0 2.3-.9 3.3-2.2M14.2 9.1C15.1 7.9 16 7 17 7h3M17 14l3 3-3 3" /></svg>;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function ScenarioSuggestionPanel({ onTopicSelected }: Readonly<{ onTopicSelected: (topic: string) => void }>) {
  const [activeMode, setActiveMode] = useState<ScenarioSuggestionMode | null>(null);
  const [data, setData] = useState<SuggestionData | null>(null);
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [loadingMode, setLoadingMode] = useState<ScenarioSuggestionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const suggestionSessionId = useRef(makeId("suggestion"));
  const requestSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const generatorTrigger = useRef<HTMLButtonElement | null>(null);

  function closeGenerator() {
    setGeneratorOpen(false);
    window.requestAnimationFrame(() => generatorTrigger.current?.focus());
  }

  async function requestSuggestion(mode: ScenarioSuggestionMode, keepSession: boolean) {
    controller.current?.abort();
    const currentController = new AbortController();
    controller.current = currentController;
    const sequence = ++requestSequence.current;
    const nextExcluded = keepSession ? excluded : [];
    if (!keepSession) {
      suggestionSessionId.current = makeId("suggestion");
      setExcluded([]);
    }
    setActiveMode(mode);
    setLoadingMode(mode);
    setError(null);
    try {
      const response = await fetch("/api/v1/explore/scenario-suggestions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          suggestionSessionId: suggestionSessionId.current,
          requestId: makeId("request"),
          excludedScenarioIds: nextExcluded,
        }),
        signal: currentController.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("SCENARIO_SUGGESTION_FAILED");
      const parsed = scenarioSuggestionResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("SCENARIO_SUGGESTION_INVALID");
      if (sequence !== requestSequence.current) return;
      setData(parsed.data.data);
      if (parsed.data.data.scenario) {
        setExcluded([...nextExcluded, parsed.data.data.scenario.stableKey].slice(0, 5));
      }
    } catch {
      if (currentController.signal.aborted || sequence !== requestSequence.current) return;
      setError("暂时无法选择场景，可以重试或直接搜索。");
    } finally {
      if (sequence === requestSequence.current) setLoadingMode(null);
    }
  }

  return (
    <section className="scenario-suggestion" aria-label="场景建议" aria-busy={loadingMode !== null}>
      <div className="scenario-suggestion__choices">
        {choices.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            aria-pressed={activeMode === choice.mode}
            disabled={loadingMode === choice.mode}
            onClick={() => void requestSuggestion(choice.mode, false)}
          >
            <span className="scenario-suggestion__icon"><ChoiceIcon name={choice.icon} /></span>
            <strong>{loadingMode === choice.mode ? "正在选择…" : choice.title}</strong>
          </button>
        ))}
      </div>

      {data?.scenario ? (
        <article className="scenario-suggestion__result" aria-live="polite">
          <div className="scenario-suggestion__result-copy">
            <div className="scenario-suggestion__meta"><span>{data.scenario.cefr}</span><span>{data.scenario.categoryLabel}</span><span>{data.scenario.role}</span></div>
            <h3>{data.scenario.title}</h3>
            <strong className="scenario-suggestion__goal">{data.scenario.communicationGoal}</strong>
            {data.reasons[0] ? <p className="scenario-suggestion__reason">{data.reasons[0].text}</p> : null}
          </div>
          <div className="scenario-suggestion__actions">
            <a className="primary-action" href={data.scenario.route}>开始练习</a>
            <button type="button" disabled={!data.canSwap || loadingMode !== null} onClick={() => activeMode && void requestSuggestion(activeMode, true)}>换一个</button>
          </div>
        </article>
      ) : data?.fallback ? (
        <div className="scenario-suggestion__empty" role="status">
          <strong>{data.limitReached ? "这一轮已经看完" : "暂时没有合适的现成场景"}</strong>
          <div>{data.fallback.topicChips.map((topic) => <button type="button" key={topic} onClick={() => onTopicSelected(topic)}>{topic}</button>)}</div>
          {data.fallback.canGeneratePersonalScenario ? <button ref={generatorTrigger} type="button" className="scenario-suggestion__generate" aria-expanded={generatorOpen} onClick={() => setGeneratorOpen(true)}>生成私人场景</button> : <small>私人生成服务尚未配置，现有搜索和主题筛选仍可使用。</small>}
        </div>
      ) : null}

      {generatorOpen ? <PersonalScenarioGenerator onClose={closeGenerator} /> : null}

      {error ? <p className="scenario-suggestion__error" role="alert">{error} <button type="button" onClick={() => activeMode && void requestSuggestion(activeMode, excluded.length > 0)}>重试</button></p> : null}
    </section>
  );
}
