"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ScenarioPracticeExpression } from "../content";
import { createReadAloud } from "@/src/modules/providers/tts";
import { speechCapabilityErrorCode } from "@/src/modules/providers/speech";
import { SaveExpressionButton } from "./save-expression-button";

export type ScenarioExpressionGoal = Readonly<{
  position: number;
  prompt: string;
}>;

type ScenarioExpressionListProps = Readonly<{
  expressions: readonly ScenarioPracticeExpression[];
  goalsByExpression: Readonly<Record<string, readonly ScenarioExpressionGoal[]>>;
  version: number;
  allowSave: boolean;
  languageTag: string;
}>;

/**
 * Keeps the expression controls on the client while the scenario detail stays
 * server-rendered. Shared read-aloud uses the selected MiniMax female voice and does
 * not create a practice attempt or learning evidence.
 */
export function ScenarioExpressionList({
  expressions,
  goalsByExpression,
  version,
  allowSave,
  languageTag,
}: ScenarioExpressionListProps) {
  const tts = useMemo(() => createReadAloud(), []);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [speechStarted, setSpeechStarted] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => () => {
    attemptRef.current += 1;
    tts.stop();
  }, [tts]);

  const speak = useCallback(async (expression: ScenarioPracticeExpression) => {
    const key = expression.stableKey;

    if (speakingKey === key) {
      attemptRef.current += 1;
      tts.stop();
      setSpeakingKey(null);
      setSpeechStarted(false);
      setErrorKey(null);
      return;
    }

    const attempt = ++attemptRef.current;
    setSpeechStarted(false);
    if (!tts.isSupported) {
      setSpeakingKey(null);
      setErrorKey(key);
      return;
    }

    setSpeakingKey(key);
    setErrorKey(null);

    try {
      await tts.speak(expression.text, { languageTag, rate: 1, onStart: () => {
        if (attemptRef.current === attempt) setSpeechStarted(true);
      } });
    } catch (error) {
      if (attemptRef.current === attempt && speechCapabilityErrorCode(error, "tts-failed") !== "tts-cancelled") setErrorKey(key);
    } finally {
      if (attemptRef.current === attempt) { setSpeakingKey(null); setSpeechStarted(false); }
    }
  }, [languageTag, speakingKey, tts]);

  const statusMessage = speakingKey
    ? `${speechStarted ? "正在朗读" : "正在准备朗读"}：${expressions.find((expression) => expression.stableKey === speakingKey)?.text ?? "表达"}`
    : errorKey
      ? "暂时无法朗读；你仍可以直接阅读或进入实战。"
      : null;

  return (
    <>
      {statusMessage ? <p className="scenario-expression-status" role="status">{statusMessage}</p> : null}
      <div className="scenario-expression-grid">
        {expressions.map((expression) => {
          const goals = goalsByExpression[expression.stableKey] ?? [];
          const isSpeaking = speakingKey === expression.stableKey;

          return (
            <article key={expression.stableKey}>
              <div className="scenario-expression-grid__body">
                <strong lang="es">{expression.text}</strong>
                <span className="scenario-expression-grid__translation">{expression.translation}</span>
                <small>{expression.communicativeIntent}</small>
                {goals.length > 0 ? (
                  <div className="scenario-expression-goals" aria-label="对应沟通目标">
                    <span className="scenario-expression-goals__label">对应目标</span>
                    {goals.map((goal) => (
                      <span className="scenario-expression-goal" key={`${expression.stableKey}:${goal.position}`}>
                        目标 {goal.position + 1} · {goal.prompt}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="scenario-expression-grid__actions">
                <button
                  type="button"
                  className="scenario-expression-play"
                  aria-label={`${isSpeaking ? "停止朗读" : "朗读表达"}：${expression.text}`}
                  aria-pressed={isSpeaking}
                  title={isSpeaking ? "停止朗读" : "试听西语表达"}
                  onClick={() => void speak(expression)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    {isSpeaking ? <path d="M8 7v10M16 7v10" /> : <path d="M5 10v4h4l5 4V6l-5 4H5zm12-1.5a5 5 0 0 1 0 7" />}
                  </svg>
                  <span>{isSpeaking ? "停止" : "试听"}</span>
                </button>
                {allowSave ? <SaveExpressionButton expressionKey={expression.stableKey} expressionText={expression.text} version={version} /> : null}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
