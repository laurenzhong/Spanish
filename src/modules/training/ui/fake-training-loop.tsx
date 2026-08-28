"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import contentBundle from "@/content/bundles/alpha-core-v1.json";
import {
  createTrainingState,
  transition,
  type TrainingEvent,
  type TrainingState,
  type TrainingTransition,
} from "@/src/modules/training/domain";
import { createFakeEvaluator } from "@/src/modules/training/fakes";
import {
  checkpointFromState,
  createBrowserTrainingCheckpointStore,
  restoreTrainingCheckpoint,
  serializeTrainingCheckpoint,
  type TrainingCheckpointStore,
} from "@/src/modules/training/checkpoints";
import {
  createBrowserAudioRecorder,
  speechCapabilityErrorCode,
  type BrowserAudioRecorder,
} from "@/src/modules/providers/speech";
import {
  createBrowserTextToSpeech,
  type BrowserTextToSpeech,
} from "@/src/modules/providers/tts";
import type { LearningActivityRecorder } from "@/src/modules/profile/activity";
import type { ArticleTransferTask } from "@/src/modules/content/domain";

const practiceExpressions = contentBundle.expressions.slice(0, 4);
const evaluator = createFakeEvaluator();

type LoopState = Readonly<{
  expressionIndex: number;
  variantIndex: number;
  transition: TrainingTransition;
}>;

type LoopEvent =
  | TrainingEvent
  | Readonly<{ type: "load-expression"; expressionIndex: number }>
  | Readonly<{
      type: "restore-checkpoint";
      expressionIndex: number;
      state: TrainingState;
    }>;

export type TrainingAudioCapabilities = Readonly<{
  recorder: Pick<BrowserAudioRecorder, "start" | "stop" | "cancel">;
  textToSpeech: Pick<BrowserTextToSpeech, "isSupported" | "speak" | "stop">;
}>;

function expressionFor(expressionIndex: number, variantIndex: number) {
  const base = practiceExpressions[expressionIndex] ?? practiceExpressions[0];
  const variant = variantIndex > 0 ? base.variants?.[variantIndex - 1] : undefined;
  if (!variant) return base;
  return {
    ...base,
    stableKey: `${base.stableKey}.variant.${variant.position}`,
    text: variant.text,
    communicativeIntent: variant.usageNotes,
  };
}

function startExpression(expressionIndex: number, variantIndex = 0): LoopState {
  const expression = expressionFor(expressionIndex, variantIndex);
  const loaded = transition(createTrainingState(), {
    type: "content-loaded",
    contentKey: expression.stableKey,
    goalKey: expression.goalKey,
  });

  return { expressionIndex, variantIndex, transition: loaded };
}

function loopReducer(state: LoopState, event: LoopEvent): LoopState {
  if (event.type === "load-expression") {
    return startExpression(event.expressionIndex);
  }

  if (event.type === "restore-checkpoint") {
    const contentKey = event.state.contentKey ?? "";
    const variantIndex = contentKey.includes(".variant.")
      ? Math.max(1, Number(contentKey.split(".variant.")[1]) + 1)
      : 0;
    return {
      expressionIndex: event.expressionIndex,
      variantIndex,
      transition: { state: event.state, effects: [] },
    };
  }

  const next = transition(state.transition.state, event);
  if (event.type === "variant-ready" && next.state.status === "presenting-input") {
    const base = practiceExpressions[state.expressionIndex] ?? practiceExpressions[0];
    const variantCount = base.variants?.length ?? 0;
    const variantIndex = variantCount === 0 ? 0 : (state.variantIndex % variantCount) + 1;
    const expression = expressionFor(state.expressionIndex, variantIndex);
    return {
      expressionIndex: state.expressionIndex,
      variantIndex,
      transition: {
        ...next,
        state: { ...next.state, contentKey: expression.stableKey },
      },
    };
  }

  return {
    ...state,
    transition: next,
  };
}

function initialLoopState(): LoopState {
  return startExpression(0);
}

function statusLabel(state: TrainingState): string {
  switch (state.status) {
    case "presenting-input":
      return "先听一遍";
    case "awaiting-output":
      return "轮到你了";
    case "recording":
      return "正在记录你的回答";
    case "transcribing":
      return "正在整理回答";
    case "evaluating":
      return "正在看这句话完成了什么";
    case "showing-feedback":
      return "这一轮完成了";
    case "transitioning":
      return "准备下一种说法";
    case "completed":
      return "这句已完成";
    case "recoverable-error":
      return "这次没有顺利完成";
    case "loading-context":
      return "正在准备内容";
  }
}

function formatRecordingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

const trainingHints: Record<string, readonly string[]> = {
  "start.como-va-todo": [
    "先决定你想表达的近况：好、一般、忙，还是有点累。",
    "可以先说 bien、regular 或 cansado，再补一句 gracias 或今天的情况。",
    "句式骨架：近况 + gracias。Hoy + 一个简单原因。",
  ],
  "relationship.como-se-llama": [
    "先确认你是在礼貌询问对方姓名。",
    "可以用 cómo te llamas，或在回答时用 me llamo / soy。",
    "句式骨架：Me llamo + 名字；再用 ¿Y tú? 把对话交回去。",
  ],
  "relationship.me-gusta-viajar": [
    "先说一个你愿意分享的兴趣或活动。",
    "可以用 me gusta、me encanta 或 disfruto + 活动。",
    "句式骨架：Me gusta + 活动 + y + 一个具体对象。",
  ],
  "need.necesito-ayuda": [
    "先明确你需要对方做什么。",
    "可以用 necesito、podrías 或 por favor 让请求更清楚。",
    "句式骨架：Necesito + 帮助内容；再补 por favor。",
  ],
};

function hintFor(expressionKey: string, level: number): string | null {
  const baseKey = expressionKey.split(".variant.", 1)[0] ?? expressionKey;
  return trainingHints[baseKey]?.[level - 1] ?? null;
}

function useTrainingEffects(
  current: LoopState,
  dispatch: Dispatch<LoopEvent>,
  store: TrainingCheckpointStore | null,
  enabled: boolean,
  audio: TrainingAudioCapabilities,
  setCapabilityNotice: Dispatch<SetStateAction<string | null>>,
) {
  useEffect(() => {
    if (!enabled) return;
    const cleanups: Array<() => void> = [];
    let active = true;
    let recordingStop: Promise<boolean> | null = null;

    for (const effect of current.transition.effects) {
      if (effect.type === "save-breakpoint" && store) {
        const checkpoint = checkpointFromState(current.transition.state);
        if (checkpoint) {
          void store.write(serializeTrainingCheckpoint(checkpoint));
        }
      }

      if (effect.type === "play-input") {
        if (!audio.textToSpeech.isSupported) {
          setCapabilityNotice(
            "浏览器暂不支持朗读，已保留文字输入。你可以直接阅读这句内容。",
          );
          const timer = window.setTimeout(
            () => active && dispatch({ type: "input-playback-completed" }),
            220,
          );
          cleanups.push(() => window.clearTimeout(timer));
        } else {
          const expressionText = expressionFor(current.expressionIndex, current.variantIndex).text;
          void audio.textToSpeech
            .speak(expressionText, { languageTag: "es-ES", rate: 0.9 })
            .then(() => {
              if (active) dispatch({ type: "input-playback-completed" });
            })
            .catch((error: unknown) => {
              if (active) {
                dispatch({
                  type: "input-playback-failed",
                  errorCode: speechCapabilityErrorCode(error, "tts-failed"),
                });
              }
            });
          cleanups.push(() => audio.textToSpeech.stop());
        }
      }

      if (effect.type === "start-recording") {
        void audio.recorder.start().catch((error: unknown) => {
          if (!active) return;
          setCapabilityNotice("麦克风暂时不可用，已切换为文字回答。");
          dispatch({
            type: "recording-start-failed",
            generationId: effect.generationId,
            errorCode: speechCapabilityErrorCode(error, "recording-failed"),
          });
        });
      }

      if (effect.type === "stop-recording") {
        recordingStop = audio.recorder
          .stop()
          .then(() => true)
          .catch((error: unknown) => {
            if (active && current.transition.state.status === "transcribing") {
              dispatch({
                type: "transcription-failed",
                generationId: effect.generationId,
                errorCode: speechCapabilityErrorCode(error, "recording-failed"),
              });
            }
            return false;
          });
      }

      if (effect.type === "prepare-variant") {
        const timer = window.setTimeout(
          () => dispatch({ type: "variant-ready" }),
          180,
        );
        cleanups.push(() => window.clearTimeout(timer));
      }

      if (effect.type === "transcribe") {
        const simulatedTranscript = expressionFor(current.expressionIndex, current.variantIndex).text;
        void (recordingStop ?? Promise.resolve(true)).then((success) => {
          if (!active || !success) return;
          const timer = window.setTimeout(
            () =>
              active &&
              dispatch({
                type: "transcription-succeeded",
                generationId: effect.generationId,
                transcript: simulatedTranscript,
                confidence: 0.96,
              }),
            180,
          );
          cleanups.push(() => window.clearTimeout(timer));
        });
      }

      if (effect.type === "evaluate") {
        const controller = new AbortController();
        const transcript = current.transition.state.transcript ?? "";
        const expressionKey = current.transition.state.contentKey ?? "";
        void evaluator
          .evaluate(
            {
              expressionKey,
              generationId: effect.generationId,
              outputMode: effect.outputMode,
              text: transcript,
            },
            controller.signal,
          )
          .then((result) => dispatch(result))
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            dispatch({
              type: "evaluation-failed",
              generationId: effect.generationId,
              errorCode: "fake-evaluator-failed",
            });
          });
        cleanups.push(() => controller.abort());
      }
    }

    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [audio, current, dispatch, enabled, setCapabilityNotice, store]);
}

type FakeTrainingLoopProps = Readonly<{
  activityRecorder?: LearningActivityRecorder;
  userId?: string;
  audio?: TrainingAudioCapabilities;
  articleTransfer?: ArticleTransferTask;
}>;

export function FakeTrainingLoop({
  activityRecorder,
  userId = "local-user",
  audio: providedAudio,
  articleTransfer,
}: FakeTrainingLoopProps) {
  const [current, dispatch] = useReducer(loopReducer, undefined, initialLoopState);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const state = current.transition.state;
  const checkpointStore = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : createBrowserTrainingCheckpointStore(userId),
    [userId],
  );
  const audio = useMemo<TrainingAudioCapabilities>(
    () =>
      providedAudio ?? {
        recorder: createBrowserAudioRecorder(),
        textToSpeech: createBrowserTextToSpeech(),
      },
    [providedAudio],
  );
  const expression = expressionFor(current.expressionIndex, current.variantIndex);
  const isProcessing =
    state.status === "transcribing" || state.status === "evaluating";

  useEffect(() => {
    if (!hydrated || !activityRecorder) return;
    activityRecorder.start();
    return () => activityRecorder.stop();
  }, [activityRecorder, hydrated]);

  useEffect(() => {
    if (state.status !== "recording") return;

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    if (!checkpointStore) return;
    let active = true;
    void restoreTrainingCheckpoint(checkpointStore, {
      contentBundleKey: "alpha.core",
      contentBundleVersion: 1,
    }).then((restoredState) => {
      if (!active) return;
      if (restoredState) {
        const expressionIndex = Math.max(
          0,
          practiceExpressions.findIndex((expression) =>
            restoredState.contentKey?.startsWith(expression.stableKey),
          ),
        );
        dispatch({
          type: "restore-checkpoint",
          expressionIndex,
          state: restoredState,
        });
        setRestored(true);
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [checkpointStore]);

  useTrainingEffects(
    current,
    dispatch,
    checkpointStore,
    hydrated,
    audio,
    setCapabilityNotice,
  );

  useEffect(() => {
    return () => {
      void audio.recorder.cancel();
      audio.textToSpeech.stop();
    };
  }, [audio]);

  function submitTyping() {
    setCapabilityNotice(null);
    dispatch({ type: "submit-typing", text: draft });
    setDraft("");
  }

  function startRecording() {
    setRecordingSeconds(0);
    dispatch({ type: "start-recording" });
  }

  function moveToNextExpression() {
    const nextIndex = (current.expressionIndex + 1) % practiceExpressions.length;
    setDraft("");
    async function clearAndLoad() {
      await checkpointStore?.clear();
      dispatch({ type: "load-expression", expressionIndex: nextIndex });
    }
    void clearAndLoad();
  }

  const activeTimelineKey =
    state.status === "presenting-input"
      ? "listen"
      : state.status === "transitioning" || state.status === "completed"
        ? "vary"
        : "express";
  const trainingTimeline = [
    {
      key: "listen",
      label: "听懂情境",
      detail: "听清语气和关键信息。",
      status: activeTimelineKey === "listen" ? "current" : "completed",
    },
    {
      key: "express",
      label: "自己表达",
      detail: "完整说完，再结束这一轮。",
      status: activeTimelineKey === "express" ? "current" : activeTimelineKey === "vary" ? "completed" : "locked",
    },
    {
      key: "vary",
      label: "换一种说法",
      detail: "完成当前步骤后解锁，保留真实交际意图。",
      status: activeTimelineKey === "vary" ? "current" : "locked",
    },
  ] as const;

  const evidenceStrengthLabel = {
    none: "尚未形成证据",
    weak: "轻量交际证据",
    moderate: "中等交际证据",
    strong: "明确交际证据",
  } as const;

  const evidenceSummary =
    state.status === "recoverable-error"
      ? {
          label: "无负面能力记录",
          detail: "技术步骤未完成，本轮不会改变你的能力画像。",
        }
      : state.outputMode === "typing"
        ? {
            label: "文字路径",
            detail: "文字回答只记录交际任务结果，不进入发音、语流或口头反应证据。",
          }
        : state.evaluation
          ? {
              label: state.evaluation.contextualSuccess
                ? evidenceStrengthLabel[state.evaluation.evidenceStrength]
                : "仍需一次完整表达",
              detail: state.evaluation.contextualSuccess
                ? "已确认对方可以接住这次表达。"
                : "这次还没有完成沟通任务，可以换一种说法再试。",
            }
          : {
              label: "等待本轮完成",
              detail: "完成完整表达后，才会显示已确认的沟通结果。",
            };

  return (
    <div
      className="training-loop"
      data-testid="training-loop"
      data-status={state.status}
      data-hydrated={hydrated}
      data-restored={restored}
    >
      <header className="page-header page-header--simple training-loop__header">
        <div>
          <p className="eyebrow">表达练习</p>
          <h1>把一句话说到对方能接住</h1>
        </div>
        <div
          className="training-loop__counter"
          role="progressbar"
          aria-label={`第 ${current.expressionIndex + 1} 句，共 4 句`}
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={current.expressionIndex + 1}
        >
          <span>当前句</span>
          <strong>{current.expressionIndex + 1} / 4</strong>
        </div>
      </header>

      {restored ? (
        <p className="training-loop__restore-status" role="status">
          已恢复上次稳定进度
        </p>
      ) : null}

      {capabilityNotice ? (
        <p className="training-loop__capability-notice" role="status">
          {capabilityNotice}
        </p>
      ) : null}

      <div className="training-loop__layout">
        <div className="training-loop__primary-column">
          <nav
            className="training-loop__timeline"
            aria-label="训练任务时间线"
            data-testid="training-timeline"
          >
            <div className="training-loop__timeline-heading">
              <span>本轮任务</span>
              <span>{current.variantIndex > 0 ? "变式练习" : "沟通表达"}</span>
            </div>
            <ol>
              {trainingTimeline.map((node) => (
                <li
                  className={`training-loop__timeline-node training-loop__timeline-node--${node.status}`}
                  data-status={node.status}
                  key={node.key}
                  aria-current={node.status === "current" ? "step" : undefined}
                >
                  <span className="training-loop__timeline-marker" aria-hidden="true">
                    {node.status === "completed" ? "✓" : node.status === "current" ? "•" : ""}
                  </span>
                  <div>
                    <strong>{node.label}</strong>
                    <span>{node.status === "completed" ? "已完成" : node.status === "current" ? "当前步骤" : "完成当前步骤后解锁"}</span>
                    <p>{node.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </nav>

          {articleTransfer ? (
            <aside className="training-loop__article-context" data-testid="article-transfer-context">
              <p className="eyebrow eyebrow--accent">来自阅读</p>
              <strong>{articleTransfer.label}</strong>
              <p>{articleTransfer.prompt}</p>
              <small>只有你主动用声音回答时，才会进入口语评估。</small>
            </aside>
          ) : null}

          <section className="training-loop__context" aria-labelledby="training-expression">
            <div className="training-loop__status" aria-live="polite">
              <span className="training-loop__status-dot" aria-hidden="true" />
              {statusLabel(state)}
            </div>
            <p className="eyebrow eyebrow--accent">
              {current.variantIndex > 0 ? "变式情境" : expression.goalKey}
            </p>
            <h2 id="training-expression">{expression.text}</h2>
            <p className="training-loop__translation">{expression.translations["zh-CN"]}</p>
            <p className="training-loop__intent">{expression.communicativeIntent["zh-CN"]}</p>
            <div
              className="training-loop__audio-line"
              data-playing={state.status === "presenting-input"}
              aria-label="西班牙语输入音频"
            >
              <span className="training-loop__audio-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M5 10v4h3l4 4V6l-4 4H5Z" />
                  <path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" />
                </svg>
              </span>
              <span className="training-loop__audio-bars" aria-hidden="true">
                <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
              </span>
              <span className="training-loop__audio-label">
                {state.status === "presenting-input" ? "正在播放" : "已听过一遍"}
              </span>
            </div>
          </section>

          <section className="training-loop__workbench" aria-label="训练操作">
        <div className="training-loop__progress">
          <div className="training-loop__progress-copy">
            <span className="training-loop__progress-label">本轮节奏</span>
            <strong>{state.outputMode === "typing" ? "文字回答" : "口语回答"}</strong>
          </div>
          <span className="training-loop__progress-hint">提示 {state.hintLevel}/3</span>
        </div>

        {state.status === "presenting-input" ? (
          <p className="training-loop__instruction">先听输入，听完后用自己的话回应。</p>
        ) : null}

        {state.status === "awaiting-output" ? (
          <div className="training-loop__output-choice">
            <button
              className="training-loop__primary training-loop__voice-action"
              onClick={startRecording}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="8" y="3" width="8" height="13" rx="4" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
              </svg>
              <span>开始录音</span>
              <span className="training-loop__button-note" aria-hidden="true">用声音回答</span>
            </button>
            <button
              className="training-loop__secondary training-loop__typing-action"
              onClick={() => {
                setCapabilityNotice(null);
                dispatch({ type: "switch-to-silent" });
              }}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M5 5.5h14v13H5zM8 9h8M8 12h5M8 15h8" />
              </svg>
              <span>用文字回答</span>
              <span className="training-loop__button-note" aria-hidden="true">安静环境</span>
            </button>
          </div>
        ) : null}

        {state.status === "awaiting-output" && state.outputMode === "typing" ? (
          <div className="training-loop__composer">
            <label htmlFor="training-draft">写下你的回应</label>
            <textarea
              id="training-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="例如：¿Qué tal todo?"
              rows={3}
            />
            <div className="training-loop__composer-actions">
              <button
                className="training-loop__primary"
                disabled={!draft.trim()}
                onClick={submitTyping}
                type="button"
              >
                提交文字回答
              </button>
              <button
                className="training-loop__secondary training-loop__composer-voice"
                onClick={() => {
                  setDraft("");
                  startRecording();
                }}
                type="button"
              >
                改用语音录音
              </button>
            </div>
          </div>
        ) : null}

        {state.status === "recording" ? (
          <div className="training-loop__recording" aria-live="polite">
            <div className="training-loop__recording-head">
              <div className="training-loop__recording-state">
                <span className="training-loop__recording-mark" aria-hidden="true" />
                <span>正在听你说</span>
              </div>
              <time dateTime={`PT${recordingSeconds}S`} aria-label={`已录音 ${formatRecordingTime(recordingSeconds)}`}>
                {formatRecordingTime(recordingSeconds)}
              </time>
            </div>
            <div className="training-loop__recording-waveform" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <p>完整说完，再结束这一轮。</p>
            <div className="training-loop__recording-actions">
              <button
                className="training-loop__primary"
                onClick={() =>
                  dispatch({
                    type: "stop-recording",
                    generationId: state.generationId,
                  })
                }
                type="button"
              >
                完成录音
              </button>
              <button
                className="training-loop__cancel"
                onClick={() =>
                  dispatch({
                    type: "cancel-recording",
                    generationId: state.generationId,
                  })
                }
                type="button"
              >
                取消，改用文字
              </button>
            </div>
          </div>
        ) : null}

        {isProcessing ? (
          <p className="training-loop__instruction" aria-live="polite">
            {state.status === "transcribing" ? "正在整理你的声音……" : "正在给出这轮反馈……"}
          </p>
        ) : null}

        {state.status === "showing-feedback" && state.evaluation ? (
          <div className="training-loop__feedback" role="status">
            <p className="eyebrow eyebrow--accent">这轮反馈</p>
            <div className="training-loop__feedback-result">
              <span className="training-loop__feedback-mark" aria-hidden="true">
                {state.evaluation.contextualSuccess ? "✓" : "!"}
              </span>
              <div>
                <span className="training-loop__feedback-label">沟通结果</span>
                <h3>
                  {state.evaluation.contextualSuccess
                    ? "对方可以接住你的意思"
                    : "这次还没有完成沟通任务"}
                </h3>
              </div>
            </div>
            <p className="training-loop__feedback-summary">
              {state.evaluation.contextualSuccess
                ? "自然的相近表达也算成功。"
                : "意思还差一点，再给自己一次完整表达的机会。"}
            </p>
            <div className="training-loop__feedback-next">
              <span>下一步</span>
              <strong>
                {state.evaluation.contextualSuccess
                  ? "换一个信息，再说一次"
                  : "换一种说法，完成同一个目的"}
              </strong>
            </div>
            <div className="training-loop__feedback-actions">
              <button
                className="training-loop__secondary"
                onClick={() => dispatch({ type: "enter-variant" })}
                type="button"
              >
                练习变式
              </button>
              <button
                className="training-loop__primary"
                onClick={() => dispatch({ type: "complete-task" })}
                type="button"
              >
                完成这句
              </button>
            </div>
          </div>
        ) : null}

        {state.status === "transitioning" ? (
          <p className="training-loop__instruction" aria-live="polite">换一个信息，再完成同一个沟通目的。</p>
        ) : null}

        {state.status === "completed" ? (
          <div className="training-loop__feedback" role="status">
            <p className="eyebrow eyebrow--accent">已保存</p>
            <div className="training-loop__feedback-result">
              <span className="training-loop__feedback-mark" aria-hidden="true">✓</span>
              <div>
                <span className="training-loop__feedback-label">本句完成</span>
                <h3>这句练习完成了</h3>
              </div>
            </div>
            <p className="training-loop__feedback-summary">完成一次任务不会直接改变能力画像，之后还会用陌生变体复核。</p>
            <button className="training-loop__primary" onClick={moveToNextExpression} type="button">
              下一句
            </button>
          </div>
        ) : null}

        {state.status === "recoverable-error" && state.error ? (
          <div className="training-loop__error" role="alert">
            <div className="training-loop__feedback-result">
              <span className="training-loop__feedback-mark" aria-hidden="true">!</span>
              <div>
                <span className="training-loop__feedback-label">需要再试一次</span>
                <h3>这次技术步骤没有完成</h3>
              </div>
            </div>
            <p>没有产生负面能力记录，你可以回到当前句重新尝试。</p>
            <button className="training-loop__primary" onClick={() => dispatch({ type: "retry" })} type="button">
              再试一次
            </button>
          </div>
        ) : null}

        {state.status === "awaiting-output" ? (
          <div className="training-loop__hints">
            <div className="training-loop__hints-head">
              <span>需要一点支撑？</span>
              <span>{state.hintLevel === 0 ? "按需打开" : `已打开 ${state.hintLevel}/3`}</span>
            </div>
            <div className="training-loop__hint-drawer">
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  className={level <= state.hintLevel ? "is-active" : ""}
                  aria-pressed={level <= state.hintLevel}
                  onClick={() => dispatch({ type: "request-hint", level: level as 1 | 2 | 3 })}
                  type="button"
                >
                  <span className="training-loop__hint-index">0{level}</span>
                  <span>提示 {level}</span>
                  <span className="training-loop__hint-state" aria-hidden="true">{level <= state.hintLevel ? "已开" : ""}</span>
                </button>
              ))}
            </div>
            {state.hintLevel > 0 && hintFor(expression.stableKey, state.hintLevel) ? (
              <aside className="training-loop__hint-content" data-testid="training-hint-content" role="status">
                <strong>提示 {state.hintLevel}</strong>
                <p>{hintFor(expression.stableKey, state.hintLevel)}</p>
              </aside>
            ) : null}
          </div>
        ) : null}
          </section>
        </div>

        <aside
          className="training-loop__detail-rail"
          aria-label="训练详情"
          data-testid="training-detail-rail"
        >
          <div className="training-loop__detail-heading">
            <p className="eyebrow eyebrow--accent">当前详情</p>
            <h2>把注意力放在沟通上</h2>
          </div>
          <div className="training-loop__detail-section">
            <span className="training-loop__detail-label">输出方式</span>
            <strong>{state.outputMode === "typing" ? "文字回答" : "口语回答"}</strong>
            <p>{state.outputMode === "typing" ? "安静环境下完成，不计入口语证据。" : "完整说完后再结束，保留真实口头反应。"}</p>
          </div>
          <div className="training-loop__detail-section">
            <span className="training-loop__detail-label">提示级别</span>
            <strong>{state.hintLevel === 0 ? "未打开" : `提示 ${state.hintLevel} / 3`}</strong>
            <p>{state.hintLevel === 0 ? "需要时再打开，不会打断当前表达。" : "提示已记录在本轮进度中。"}</p>
          </div>
          <div className="training-loop__detail-section" data-testid="training-evidence-summary">
            <span className="training-loop__detail-label">证据说明</span>
            <strong>{evidenceSummary.label}</strong>
            <p>{evidenceSummary.detail}</p>
          </div>
          <div className="training-loop__detail-section training-loop__detail-section--privacy">
            <span aria-hidden="true">⌁</span>
            <p><strong>录音隐私</strong>普通录音评估完成后删除。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
